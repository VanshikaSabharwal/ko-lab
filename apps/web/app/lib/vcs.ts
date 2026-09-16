import { Octokit } from "@octokit/rest";
import prisma from "./prisma";
import { decrypt, extractRepoName } from "./encryption";
import { getLinkedGithub, getGithubUsername, hasRepoScope } from "./githubLink";

// A stored group GitHub token that GitHub rejected (expired / revoked).
// GitHub App user tokens expire ~8h by default, so this is the common cause.
export function isGitHubAuthError(err: any): boolean {
  const msg = err?.message || "";
  return (
    err?.status === 401 ||
    /bad credentials/i.test(msg) ||
    /token is invalid or expired/i.test(msg) ||
    /invalid or expired/i.test(msg)
  );
}

export interface RepoContext {
  octokit: Octokit; // authenticated with the OWNER token (always works for repo ops)
  owner: string;
  repo: string;
  defaultBranch: string;
  headSha: string;
}

/** Owner-token octokit + resolved default branch/head for a group's repo. */
export async function getRepoContext(groupId: string): Promise<RepoContext> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { githubRepo: true, ownerName: true, githubAccessToken: true },
  });
  if (!group) throw new Error("Group not found");

  let ownerToken: string;
  try {
    ownerToken = decrypt(group.githubAccessToken);
  } catch {
    ownerToken = group.githubAccessToken;
  }

  const octokit = new Octokit({ auth: ownerToken });
  const owner = group.ownerName;
  const repo = extractRepoName(group.githubRepo);

  const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch;

  const { data: branch } = await octokit.rest.repos.getBranch({ owner, repo, branch: defaultBranch });
  const headSha = branch.commit.sha;

  // Cache for cheap reads elsewhere (branch switcher, sync)
  await prisma.group.update({
    where: { id: groupId },
    data: { defaultBranch, headSha },
  });

  return { octokit, owner, repo, defaultBranch, headSha };
}

/** Current default-branch head sha only (used to stamp baseSha on first edit). */
export async function getDefaultHeadSha(groupId: string): Promise<{ defaultBranch: string; headSha: string }> {
  const ctx = await getRepoContext(groupId);
  return { defaultBranch: ctx.defaultBranch, headSha: ctx.headSha };
}

interface DraftFile {
  path: string;
  content: string; // plain UTF-8 (hydrated from the user's draft clone)
  /** Staged deletion — committed as a tree entry with a null sha. */
  deleted?: boolean;
}

export interface OpenCrResult {
  branchName: string;
  prNumber: number;
  prUrl: string;
  status: "OPEN" | "CONFLICT";
}

/**
 * The heart of the CR flow: cut a branch from the author's baseSha, commit
 * their drafts on it, merge the default branch in (GitHub 3-way merge), and
 * open a PR. A merge conflict short-circuits to CONFLICT before the PR.
 */
export async function openChangeRequestBranch(params: {
  ctx: RepoContext;
  branchName: string;
  baseSha: string; // commit the author started from
  files: DraftFile[];
  commitMessage: string;
  author: { name: string; email: string };
  authorToken: string | null; // member token if collaborator, else null → owner token + author field
}): Promise<OpenCrResult> {
  const { ctx, branchName, baseSha, files, commitMessage, author, authorToken } = params;
  const { octokit, owner, repo, defaultBranch } = ctx;

  // Commit under the member's own token when available (real authorship);
  // otherwise use the owner token but set the git author to the member.
  const commitKit = authorToken ? new Octokit({ auth: authorToken }) : octokit;

  // 1. Create the CR branch from the author's base commit
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });

  // 2. Build a tree from the drafts on top of baseSha, then commit
  const tree = await commitKit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseSha,
    // A null sha is how Git expresses "remove this path" in a tree. Sending
    // content instead would recreate the file, so deletions must omit it.
    tree: files.map((f) =>
      f.deleted
        ? {
            path: f.path,
            mode: "100644" as const,
            type: "blob" as const,
            sha: null,
          }
        : {
            path: f.path,
            mode: "100644" as const,
            type: "blob" as const,
            content: f.content,
          },
    ),
  });

  const commit = await commitKit.rest.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: tree.data.sha,
    parents: [baseSha],
    author: { name: author.name, email: author.email },
  });

  await commitKit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: commit.data.sha,
  });

  // 3. Merge the current default branch INTO the CR branch (3-way merge kills drift)
  try {
    await octokit.rest.repos.merge({
      owner,
      repo,
      base: branchName,
      head: defaultBranch,
      commit_message: `Merge ${defaultBranch} into ${branchName}`,
    });
  } catch (err: any) {
    if (err.status === 409) {
      // Conflict — leave the branch for the author to reconcile, no PR yet
      return { branchName, prNumber: 0, prUrl: "", status: "CONFLICT" };
    }
    if (err.status !== 204 && err.status !== 201) throw err;
    // 204 = nothing to merge (already up to date) — fine
  }

  // 4. Open the PR
  const pr = await octokit.rest.pulls.create({
    owner,
    repo,
    base: defaultBranch,
    head: branchName,
    title: commitMessage,
    body: `Change request by **${author.name}** via Ko-Lab.`,
  });

  return {
    branchName,
    prNumber: pr.data.number,
    prUrl: pr.data.html_url,
    status: "OPEN",
  };
}

/** Resolve the commit identity + token to use for a member's CR. */
export async function resolveAuthor(
  memberUserId: string,
): Promise<{ name: string; email: string; token: string | null; username: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: memberUserId },
    select: { name: true, email: true },
  });
  const username = await getGithubUsername(memberUserId);
  const linked = await getLinkedGithub(memberUserId);
  const token = linked?.accessToken && hasRepoScope(linked.scope) ? linked.accessToken : null;

  // Prefer a GitHub noreply email so the commit maps to their GitHub account
  const email = username
    ? `${username}@users.noreply.github.com`
    : user?.email || "noreply@ko-lab.app";

  return { name: user?.name || username || "Ko-Lab member", email, token, username };
}
