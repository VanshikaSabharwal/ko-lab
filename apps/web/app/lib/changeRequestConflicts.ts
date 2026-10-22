import { Octokit } from "@octokit/rest";
import type { RepoContext } from "./vcs";
import { isText, mergeText, type MergeRegion } from "./mergeText";

// Settling a change request that conflicts with main, inside Ko-Lab.
//
// A conflicted change request keeps its branch on GitHub. Resolving it means
// merging the latest main into that branch: every change only one side made is
// kept automatically, and the author picks for the lines both sides changed.
// The result is a normal merge commit (parents: the branch and main), after
// which the change request is mergeable again.

/** Most files a change request can touch and still be resolved here. */
export const MAX_RESOLVE_FILES = 100;

type FileSide = string | null; // null: the file doesn't exist on that side

export type ConflictFile =
  | {
      path: string;
      /** Both sides changed the same lines of a text file. */
      kind: "text";
      regions: MergeRegion[];
    }
  | {
      path: string;
      /**
       * Can't be merged line by line: one side deleted it while the other
       * changed it, or it isn't text. The author keeps one side whole.
       */
      kind: "whole";
      reason: "deleted-by-you" | "deleted-on-main" | "binary";
      mine: FileSide;
      theirs: FileSide;
    };

export interface ConflictReport {
  branchHead: string;
  mainHead: string;
  mainBranch: string;
  files: ConflictFile[];
}

/** What the author decided for one conflicting file. */
export interface Resolution {
  path: string;
  /** The file's final text, null to delete it, or a side to keep whole. */
  content?: string | null;
  keep?: "mine" | "theirs";
}

/** A tree entry for the merge commit. */
type TreeEntry =
  | { path: string; mode: "100644"; type: "blob"; content: string }
  | { path: string; mode: "100644"; type: "blob"; sha: string | null };

export class ResolveError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

interface FileVersion {
  text: FileSide;
  /** Blob id, for keeping a binary file whole without downloading it again. */
  sha: string | null;
}

async function readFile(ctx: RepoContext, path: string, ref: string): Promise<FileVersion> {
  try {
    const { data } = await ctx.octokit.rest.repos.getContent({ owner: ctx.owner, repo: ctx.repo, path, ref });
    if (Array.isArray(data) || data.type !== "file") return { text: null, sha: null };
    // Files over 1 MB come back without content; treat them as binary
    if (!("content" in data) || data.encoding !== "base64") return { text: "\u0000", sha: data.sha };
    return { text: Buffer.from(data.content, "base64").toString("utf-8"), sha: data.sha };
  } catch (err: any) {
    if (err?.status === 404) return { text: null, sha: null };
    throw err;
  }
}

interface Analysis extends ConflictReport {
  /** Entries that merged on their own: committed as they are. */
  automatic: TreeEntry[];
  /** Blob ids of each side of a "whole file" conflict. */
  sides: Map<string, { mine: string | null; theirs: string | null }>;
  mainTree: string;
}

/**
 * Compare the change request's branch with the latest main and split what
 * changed into what merges on its own and what the author has to decide.
 */
async function analyse(ctx: RepoContext, branchName: string): Promise<Analysis> {
  const { octokit, owner, repo } = ctx;

  let branchHead: string;
  try {
    const { data } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branchName}` });
    branchHead = data.object.sha;
  } catch (err: any) {
    if (err?.status === 404) {
      throw new ResolveError("This change request's branch no longer exists on GitHub.", 410, "BRANCH_GONE");
    }
    throw err;
  }
  const mainHead = ctx.headSha;

  // Three-dot comparisons: each lists what one side changed since they split
  const [ours, theirs] = await Promise.all([
    octokit.rest.repos.compareCommits({ owner, repo, base: mainHead, head: branchHead }),
    octokit.rest.repos.compareCommits({ owner, repo, base: branchHead, head: mainHead }),
  ]);
  const mergeBase = ours.data.merge_base_commit.sha;
  const ourFiles = ours.data.files ?? [];
  const theirPaths = new Set((theirs.data.files ?? []).map((f) => f.filename));

  if (ourFiles.length > MAX_RESOLVE_FILES) {
    throw new ResolveError(
      `This change request touches ${ourFiles.length} files, more than can be resolved here (${MAX_RESOLVE_FILES}). Resolve it on GitHub.`,
      422,
      "TOO_LARGE",
    );
  }

  const automatic: TreeEntry[] = [];
  const files: ConflictFile[] = [];
  const sides = new Map<string, { mine: string | null; theirs: string | null }>();

  for (const file of ourFiles) {
    const path = file.filename;

    // Only this change request touched it: take its version as it is
    if (!theirPaths.has(path)) {
      automatic.push(
        file.status === "removed"
          ? { path, mode: "100644", type: "blob", sha: null }
          : { path, mode: "100644", type: "blob", sha: file.sha! },
      );
      // A rename also removes the old path
      if (file.status === "renamed" && file.previous_filename && !theirPaths.has(file.previous_filename)) {
        automatic.push({ path: file.previous_filename, mode: "100644", type: "blob", sha: null });
      }
      continue;
    }

    // Both sides touched it: three-way merge
    const [base, mine, latest] = await Promise.all([
      readFile(ctx, path, mergeBase),
      readFile(ctx, path, branchHead),
      readFile(ctx, path, mainHead),
    ]);

    if (mine.text === latest.text) continue; // the same change on both sides
    if (mine.text === null && latest.text === null) continue; // both deleted it

    const binary = !isText(base.text) || !isText(mine.text) || !isText(latest.text);
    if (mine.text === null || latest.text === null || binary) {
      sides.set(path, { mine: mine.sha, theirs: latest.sha });
      files.push({
        path,
        kind: "whole",
        reason: mine.text === null ? "deleted-by-you" : latest.text === null ? "deleted-on-main" : "binary",
        // Binary content isn't sent to the browser
        mine: binary ? null : mine.text,
        theirs: binary ? null : latest.text,
      });
      continue;
    }

    const merged = mergeText(base.text ?? "", mine.text, latest.text);
    if (merged.clean) {
      automatic.push({
        path,
        mode: "100644",
        type: "blob",
        content: merged.regions.flatMap((r) => (r.type === "ok" ? r.lines : [])).join("\n"),
      });
    } else {
      files.push({ path, kind: "text", regions: merged.regions });
    }
  }

  const { data: mainCommit } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: mainHead });

  return {
    branchHead,
    mainHead,
    mainBranch: ctx.defaultBranch,
    files,
    automatic,
    sides,
    mainTree: mainCommit.tree.sha,
  };
}

/** What conflicts, for the resolution screen. */
export async function findConflicts(ctx: RepoContext, branchName: string): Promise<ConflictReport> {
  const { branchHead, mainHead, mainBranch, files } = await analyse(ctx, branchName);
  return { branchHead, mainHead, mainBranch, files };
}

/**
 * Commit the author's decisions as a merge of main into the branch.
 *
 * Everything that merged on its own is recomputed here rather than taken from
 * the browser, and the browser may only decide the files that actually
 * conflict. If either side moved since the author looked, nothing is
 * committed: they reload and decide against what's there now.
 */
export async function commitResolution(params: {
  ctx: RepoContext;
  branchName: string;
  seen: { branchHead: string; mainHead: string };
  resolutions: Resolution[];
  author: { name: string; email: string };
  authorToken: string | null;
}): Promise<{ commitSha: string; mainHead: string; resolved: { path: string; content: string | null }[] }> {
  const { ctx, branchName, seen, resolutions, author, authorToken } = params;
  const analysis = await analyse(ctx, branchName);

  if (analysis.branchHead !== seen.branchHead || analysis.mainHead !== seen.mainHead) {
    throw new ResolveError(
      "The branch or main changed while you were resolving. Reload to see the latest conflicts.",
      409,
      "STALE",
    );
  }

  const needed = new Map(analysis.files.map((f) => [f.path, f]));
  const given = new Map(resolutions.map((r) => [r.path, r]));
  for (const path of given.keys()) {
    if (!needed.has(path)) throw new ResolveError(`${path} isn't one of the conflicting files.`, 400);
  }
  const missing = [...needed.keys()].filter((p) => !given.has(p));
  if (missing.length) {
    throw new ResolveError(`Still to resolve: ${missing.join(", ")}`, 400, "INCOMPLETE");
  }

  const decided: TreeEntry[] = [];
  const resolved: { path: string; content: string | null }[] = [];
  for (const [path, file] of needed) {
    const r = given.get(path)!;
    if (file.kind === "whole") {
      // Kept as one side, by blob id: nothing is re-uploaded or re-encoded
      if (r.keep !== "mine" && r.keep !== "theirs") {
        throw new ResolveError(`Choose which version of ${path} to keep.`, 400);
      }
      const sha = analysis.sides.get(path)![r.keep];
      decided.push({ path, mode: "100644", type: "blob", sha });
      resolved.push({ path, content: r.keep === "mine" ? file.mine : file.theirs });
    } else {
      if (typeof r.content !== "string") {
        throw new ResolveError(`${path} needs its resolved text.`, 400);
      }
      decided.push({ path, mode: "100644", type: "blob", content: r.content });
      resolved.push({ path, content: r.content });
    }
  }

  const { octokit, owner, repo } = ctx;
  // Under the author's own token when they've linked one, like the original commit
  const commitKit = authorToken ? new Octokit({ auth: authorToken }) : octokit;

  const { data: newTree } = await commitKit.rest.git.createTree({
    owner,
    repo,
    base_tree: analysis.mainTree,
    tree: [...analysis.automatic, ...decided],
  });
  const { data: commit } = await commitKit.rest.git.createCommit({
    owner,
    repo,
    message: `Merge ${analysis.mainBranch} into ${branchName}\n\nConflicts resolved in Ko-Lab.`,
    tree: newTree.sha,
    // Both parents: Git and GitHub then know the branch contains main
    parents: [analysis.branchHead, analysis.mainHead],
    author,
  });
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: commit.sha,
    force: false,
  });

  return { commitSha: commit.sha, mainHead: analysis.mainHead, resolved };
}
