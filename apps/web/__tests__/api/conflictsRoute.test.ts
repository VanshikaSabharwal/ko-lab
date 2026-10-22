// @vitest-environment node
/**
 * The resolve-conflicts endpoint: who may resolve, and what happens to the
 * change request and the author's drafts afterwards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prisma = vi.hoisted(() => ({
  changeRequest: { findUnique: vi.fn(), update: vi.fn() },
  modifiedFiles: { findMany: vi.fn(), delete: vi.fn() },
}));
vi.mock("../../app/lib/prisma", () => ({ default: prisma }));

const session = vi.hoisted(() => ({ user: { id: "author" } as { id: string } | null, codeAccess: true }));
vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(async () => session.user),
  unauthorized: () => new Response(null, { status: 401 }),
  forbidden: (m: string) => new Response(JSON.stringify({ error: m }), { status: 403 }),
  requireCodeAccess: vi.fn(async () =>
    session.codeAccess ? { ok: true } : { ok: false, res: new Response(null, { status: 403 }) },
  ),
}));

const pullsCreate = vi.hoisted(() => vi.fn());
vi.mock("../../app/lib/vcs", () => ({
  getRepoContext: vi.fn(async () => ({
    owner: "o",
    repo: "r",
    defaultBranch: "main",
    octokit: { rest: { pulls: { create: pullsCreate } } },
  })),
  resolveAuthor: vi.fn(async () => ({ name: "Asha", email: "a@x", token: null })),
}));

const conflicts = vi.hoisted(() => ({ findConflicts: vi.fn(), commitResolution: vi.fn() }));
vi.mock("../../app/lib/changeRequestConflicts", async () => {
  const actual = await vi.importActual<object>("../../app/lib/changeRequestConflicts");
  return { ...actual, ...conflicts };
});

const drafts = vi.hoisted(() => ({ deleteDraft: vi.fn(async () => {}), draftContentFor: vi.fn() }));
vi.mock("../../app/lib/draftStore", () => drafts);

import { GET, POST } from "../../app/api/vcs/conflicts/route";

function cr(over: Record<string, unknown> = {}) {
  return {
    id: "cr1",
    groupId: "g1",
    authorId: "author",
    title: "Fix header",
    branchName: "cr/asha/1",
    prNumber: null,
    status: "CONFLICT",
    files: [
      { path: "app.js", content: "submitted" },
      { path: "other.js", content: "submitted other" },
    ],
    group: { ownerId: "owner" },
    ...over,
  };
}

const get = () => GET(new Request("http://x/api/vcs/conflicts?changeRequestId=cr1"));
const post = (body: Record<string, unknown> = {}) =>
  POST(
    new Request("http://x/api/vcs/conflicts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changeRequestId: "cr1",
        seen: { branchHead: "b", mainHead: "m" },
        resolutions: [{ path: "app.js", content: "resolved" }],
        ...body,
      }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  session.user = { id: "author" };
  session.codeAccess = true;
  prisma.changeRequest.findUnique.mockResolvedValue(cr());
  prisma.modifiedFiles.findMany.mockResolvedValue([]);
  conflicts.findConflicts.mockResolvedValue({ branchHead: "b", mainHead: "m", mainBranch: "main", files: [] });
  conflicts.commitResolution.mockResolvedValue({
    commitSha: "c",
    mainHead: "m",
    resolved: [{ path: "app.js", content: "resolved" }],
  });
  pullsCreate.mockResolvedValue({ data: { number: 7, html_url: "https://github.com/o/r/pull/7" } });
});

describe("who can resolve", () => {
  it("the author", async () => {
    expect((await get()).status).toBe(200);
  });

  it("the group owner, for anyone's change request", async () => {
    session.user = { id: "owner" };
    expect((await get()).status).toBe(200);
  });

  it("not another member", async () => {
    session.user = { id: "someone-else" };
    expect((await get()).status).toBe(403);
    expect(conflicts.findConflicts).not.toHaveBeenCalled();
  });

  it("not an author who has lost code access", async () => {
    session.codeAccess = false;
    expect((await post()).status).toBe(403);
    expect(conflicts.commitResolution).not.toHaveBeenCalled();
  });

  it("only while it's actually in conflict", async () => {
    prisma.changeRequest.findUnique.mockResolvedValue(cr({ status: "OPEN" }));
    expect((await post()).status).toBe(400);
  });
});

describe("after resolving", () => {
  it("reopens the change request, opening the pull request it never got", async () => {
    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "OPEN", prNumber: 7 });
    expect(pullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ base: "main", head: "cr/asha/1", title: "Fix header" }),
    );
    expect(prisma.changeRequest.update).toHaveBeenCalledWith({
      where: { id: "cr1" },
      data: expect.objectContaining({
        status: "OPEN",
        baseSha: "m",
        prNumber: 7,
        prUrl: "https://github.com/o/r/pull/7",
        // The review copy shows the resolved text
        files: [
          { path: "app.js", content: "resolved", deleted: false },
          { path: "other.js", content: "submitted other" },
        ],
      }),
    });
  });

  it("keeps the existing pull request when there is one", async () => {
    prisma.changeRequest.findUnique.mockResolvedValue(cr({ prNumber: 3 }));
    const body = await (await post()).json();
    expect(body.prNumber).toBe(3);
    expect(pullsCreate).not.toHaveBeenCalled();
  });

  it("clears the drafts it carried, but not ones edited since", async () => {
    prisma.modifiedFiles.findMany.mockResolvedValue([
      { id: "d1", path: "app.js", content: null, deleted: false },
      { id: "d2", path: "other.js", content: null, deleted: false },
    ]);
    drafts.draftContentFor.mockImplementation(async (_g: string, _u: string, path: string) =>
      path === "app.js" ? "submitted" : "edited after submitting",
    );

    await post();

    expect(prisma.modifiedFiles.delete).toHaveBeenCalledTimes(1);
    expect(prisma.modifiedFiles.delete).toHaveBeenCalledWith({ where: { id: "d1" } });
    expect(drafts.deleteDraft).toHaveBeenCalledWith("g1", "author", "app.js");
  });

  it("passes on a 'main moved, reload' answer", async () => {
    const { ResolveError } = await import("../../app/lib/changeRequestConflicts");
    conflicts.commitResolution.mockRejectedValue(new ResolveError("moved", 409, "STALE"));

    const res = await post();

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("STALE");
    expect(prisma.changeRequest.update).not.toHaveBeenCalled();
  });
});
