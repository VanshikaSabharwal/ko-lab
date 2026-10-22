/**
 * The file list is the repo clone plus the caller's own draft-only files, and
 * it is where an expired GitHub token has to surface for the reconnect banner.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(),
  isGroupMember: vi.fn(),
  unauthorized: () => new Response(null, { status: 401 }),
  forbidden: () => new Response(null, { status: 403 }),
}));

vi.mock("../../app/lib/gitClient", () => {
  class GitServiceError extends Error {
    constructor(
      message: string,
      readonly code?: string,
    ) {
      super(message);
    }
  }
  return {
    GitServiceError,
    resolveBranch: vi.fn(async (_groupId: string, ref?: string | null) => ref ?? "main"),
    listFiles: vi.fn(),
  };
});

const { findDrafts } = vi.hoisted(() => ({ findDrafts: vi.fn() }));
vi.mock("../../app/lib/prisma", () => ({
  default: { modifiedFiles: { findMany: findDrafts } },
}));

import { GET } from "../../app/api/files/route";
import { getSessionUser, isGroupMember } from "../../app/lib/apiAuth";
import { listFiles, GitServiceError } from "../../app/lib/gitClient";

const get = () => GET(new Request("http://localhost:3000/api/files?group=g1"));

beforeEach(() => {
  vi.clearAllMocks();
  (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
  (isGroupMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (listFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
    { name: "a.js", path: "a.js", size: 3, type: "file" },
  ]);
  findDrafts.mockResolvedValue([]);
});

describe("GET /api/files", () => {
  it("adds files the caller saved that aren't in the repo yet", async () => {
    findDrafts.mockResolvedValue([
      { name: "a.js", path: "a.js" },
      { name: "new.js", path: "src/new.js" },
    ]);

    const body = await (await get()).json();

    expect(body.map((f: { path: string }) => f.path)).toEqual(["a.js", "src/new.js"]);
    expect(body[0].draft).toBeUndefined();
    expect(body[1].draft).toBe(true);
    expect(findDrafts.mock.calls[0]![0].where).toEqual({
      groupId: "g1",
      userId: "u1",
      deleted: false,
    });
  });

  it("reports an expired GitHub token with its code", async () => {
    (listFiles as ReturnType<typeof vi.fn>).mockRejectedValue(
      new GitServiceError("GitHub access expired — reconnect GitHub", "GITHUB_AUTH_EXPIRED"),
    );

    const res = await get();

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("GITHUB_AUTH_EXPIRED");
  });

  it("keeps other git failures as a 500 without the code", async () => {
    (listFiles as ReturnType<typeof vi.fn>).mockRejectedValue(new GitServiceError("boom"));

    const res = await get();

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBeUndefined();
  });
});
