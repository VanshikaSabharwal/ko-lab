// @vitest-environment node
/**
 * Resolving a conflicted change request against a fake GitHub: what counts as
 * a conflict, what merges on its own, and the merge commit that's written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@octokit/rest", () => ({
  // The author's own token gets its own client; here it's the same fake
  Octokit: class {
    constructor() {
      return fake;
    }
  },
}));

import {
  commitResolution,
  findConflicts,
  ResolveError,
} from "../../app/lib/changeRequestConflicts";
import type { RepoContext } from "../../app/lib/vcs";

const BRANCH = "cr/asha/1";
const BRANCH_HEAD = "branch-sha";
const MAIN_HEAD = "main-sha";
const MERGE_BASE = "base-sha";

/** The repo's files at each of the three commits (missing = file absent). */
let files: Record<string, Record<string, string>>;
/** What each side changed since they split, as GitHub's compare reports it. */
let ours: { filename: string; status: string; sha?: string; previous_filename?: string }[];
let theirs: { filename: string }[];

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

const fake = {
  rest: {
    git: {
      getRef: vi.fn(async () => ({ data: { object: { sha: BRANCH_HEAD } } })),
      getCommit: vi.fn(async () => ({ data: { tree: { sha: "main-tree" } } })),
      createTree: vi.fn(async () => ({ data: { sha: "new-tree" } })),
      createCommit: vi.fn(async () => ({ data: { sha: "merge-commit" } })),
      updateRef: vi.fn(async () => ({})),
    },
    repos: {
      compareCommits: vi.fn(async ({ base }: { base: string }) =>
        base === MAIN_HEAD
          ? { data: { merge_base_commit: { sha: MERGE_BASE }, files: ours } }
          : { data: { merge_base_commit: { sha: MERGE_BASE }, files: theirs } },
      ),
      getContent: vi.fn(async ({ path, ref }: { path: string; ref: string }) => {
        const content = files[ref]?.[path];
        if (content === undefined) throw Object.assign(new Error("Not Found"), { status: 404 });
        return { data: { type: "file", encoding: "base64", content: b64(content), sha: `${ref}:${path}` } };
      }),
    },
  },
};

const ctx = {
  octokit: fake,
  owner: "o",
  repo: "r",
  defaultBranch: "main",
  headSha: MAIN_HEAD,
} as unknown as RepoContext;

const seen = { branchHead: BRANCH_HEAD, mainHead: MAIN_HEAD };
const author = { name: "Asha", email: "asha@users.noreply.github.com" };

beforeEach(() => {
  vi.clearAllMocks();
  files = {
    [MERGE_BASE]: { "app.js": "a\nb\nc", "shared.js": "1\n2\n3\n4\n5", "old.txt": "keep me" },
    [BRANCH_HEAD]: { "app.js": "a\nB-mine\nc", "shared.js": "1\nmine\n3\n4\n5" },
    [MAIN_HEAD]: { "app.js": "a\nB-main\nc", "shared.js": "1\n2\n3\n4\nmain", "old.txt": "changed on main" },
  };
  ours = [
    { filename: "app.js", status: "modified", sha: "blob-app" },
    { filename: "shared.js", status: "modified", sha: "blob-shared" },
    { filename: "only-mine.js", status: "added", sha: "blob-new" },
    { filename: "old.txt", status: "removed" },
  ];
  theirs = [{ filename: "app.js" }, { filename: "shared.js" }, { filename: "old.txt" }];
});

describe("findConflicts", () => {
  it("lists only what both sides changed in incompatible ways", async () => {
    const report = await findConflicts(ctx, BRANCH);

    expect(report.branchHead).toBe(BRANCH_HEAD);
    expect(report.mainHead).toBe(MAIN_HEAD);
    expect(report.files.map((f) => f.path)).toEqual(["app.js", "old.txt"]);
    // shared.js: different lines on each side, so it merged on its own
  });

  it("shows a line conflict with both versions", async () => {
    const [app] = (await findConflicts(ctx, BRANCH)).files;
    expect(app).toEqual({
      path: "app.js",
      kind: "text",
      regions: [
        { type: "ok", lines: ["a"] },
        { type: "conflict", mine: ["B-mine"], base: ["b"], theirs: ["B-main"] },
        { type: "ok", lines: ["c"] },
      ],
    });
  });

  it("asks which side to keep when one side deleted a file the other changed", async () => {
    const old = (await findConflicts(ctx, BRANCH)).files[1];
    expect(old).toMatchObject({ kind: "whole", reason: "deleted-by-you", mine: null, theirs: "changed on main" });
  });

  it("doesn't send binary content to the browser", async () => {
    files[BRANCH_HEAD]!["app.js"] = "PNG\u0000mine";
    files[MAIN_HEAD]!["app.js"] = "PNG\u0000main";
    const [app] = (await findConflicts(ctx, BRANCH)).files;
    expect(app).toMatchObject({ kind: "whole", reason: "binary", mine: null, theirs: null });
  });

  it("says so when the branch is gone", async () => {
    fake.rest.git.getRef.mockRejectedValueOnce(Object.assign(new Error("nf"), { status: 404 }));
    await expect(findConflicts(ctx, BRANCH)).rejects.toMatchObject({ status: 410, code: "BRANCH_GONE" });
  });
});

describe("commitResolution", () => {
  const resolutions = [
    { path: "app.js", content: "a\nB-mine\nc" },
    { path: "old.txt", keep: "theirs" as const },
  ];

  it("writes a merge commit of the branch and main with the author's decisions", async () => {
    const result = await commitResolution({ ctx, branchName: BRANCH, seen, resolutions, author, authorToken: null });

    expect(result).toMatchObject({ commitSha: "merge-commit", mainHead: MAIN_HEAD });

    const { base_tree, tree } = (fake.rest.git.createTree.mock.calls[0] as unknown[])[0] as any;
    expect(base_tree).toBe("main-tree");
    expect(tree).toEqual(
      expect.arrayContaining([
        // Only the branch touched it: its version, by blob id
        { path: "only-mine.js", mode: "100644", type: "blob", sha: "blob-new" },
        // Both touched different lines: merged here
        { path: "shared.js", mode: "100644", type: "blob", content: "1\nmine\n3\n4\nmain" },
        // Decided by the author
        { path: "app.js", mode: "100644", type: "blob", content: "a\nB-mine\nc" },
        { path: "old.txt", mode: "100644", type: "blob", sha: `${MAIN_HEAD}:old.txt` },
      ]),
    );
    expect(tree).toHaveLength(4);

    expect(fake.rest.git.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ parents: [BRANCH_HEAD, MAIN_HEAD], tree: "new-tree", author }),
    );
    // Moves the branch forward; never rewrites it
    expect(fake.rest.git.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: `heads/${BRANCH}`, sha: "merge-commit", force: false }),
    );
  });

  it("can keep a file deleted", async () => {
    await commitResolution({
      ctx,
      branchName: BRANCH,
      seen,
      resolutions: [resolutions[0]!, { path: "old.txt", keep: "mine" }],
      author,
      authorToken: null,
    });
    const { tree } = (fake.rest.git.createTree.mock.calls[0] as unknown[])[0] as any;
    expect(tree).toContainEqual({ path: "old.txt", mode: "100644", type: "blob", sha: null });
  });

  it("refuses when main moved since the author looked", async () => {
    await expect(
      commitResolution({
        ctx,
        branchName: BRANCH,
        seen: { ...seen, mainHead: "older-main" },
        resolutions,
        author,
        authorToken: null,
      }),
    ).rejects.toMatchObject({ status: 409, code: "STALE" });
    expect(fake.rest.git.createCommit).not.toHaveBeenCalled();
  });

  it("refuses a resolution that leaves a conflict undecided", async () => {
    await expect(
      commitResolution({ ctx, branchName: BRANCH, seen, resolutions: [resolutions[0]!], author, authorToken: null }),
    ).rejects.toMatchObject({ status: 400, code: "INCOMPLETE" });
    expect(fake.rest.git.createCommit).not.toHaveBeenCalled();
  });

  it("won't let the browser change files that weren't in conflict", async () => {
    await expect(
      commitResolution({
        ctx,
        branchName: BRANCH,
        seen,
        resolutions: [...resolutions, { path: "only-mine.js", content: "sneaky" }],
        author,
        authorToken: null,
      }),
    ).rejects.toBeInstanceOf(ResolveError);
    expect(fake.rest.git.createCommit).not.toHaveBeenCalled();
  });

  it("needs a side chosen for a whole-file conflict", async () => {
    await expect(
      commitResolution({
        ctx,
        branchName: BRANCH,
        seen,
        resolutions: [resolutions[0]!, { path: "old.txt", content: "text instead of a side" }],
        author,
        authorToken: null,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
