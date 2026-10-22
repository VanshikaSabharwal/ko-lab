/**
 * Discarding a draft removes the caller's own stored text and row, and never
 * touches a staged deletion or anyone else's draft.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(),
  requireCodeAccess: vi.fn(),
  unauthorized: () => new Response(null, { status: 401 }),
}));

const { deleteMany } = vi.hoisted(() => ({ deleteMany: vi.fn() }));
vi.mock("../../app/lib/prisma", () => ({
  default: { modifiedFiles: { deleteMany } },
}));

vi.mock("../../app/lib/draftStore", () => ({
  writeDraft: vi.fn(),
  deleteDraft: vi.fn(),
  draftContentFor: vi.fn(),
}));

import { DELETE } from "../../app/api/modified-files/route";
import { getSessionUser, requireCodeAccess } from "../../app/lib/apiAuth";
import { deleteDraft } from "../../app/lib/draftStore";

const discard = (body: object) =>
  DELETE(
    new Request("http://localhost:3000/api/modified-files", {
      method: "DELETE",
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
  (requireCodeAccess as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
  deleteMany.mockResolvedValue({ count: 1 });
});

describe("DELETE /api/modified-files", () => {
  it("removes the caller's draft text and row", async () => {
    const res = await discard({ path: "src/new.js", group: "g1" });

    expect(res.status).toBe(200);
    expect(deleteDraft).toHaveBeenCalledWith("g1", "u1", "src/new.js");
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", groupId: "g1", path: "src/new.js", deleted: false },
    });
  });

  it("refuses someone without code access, leaving the draft alone", async () => {
    (requireCodeAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      res: new Response(null, { status: 403 }),
    });

    const res = await discard({ path: "a.js", group: "g1" });

    expect(res.status).toBe(403);
    expect(deleteDraft).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller", async () => {
    (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await discard({ path: "a.js", group: "g1" })).status).toBe(401);
  });

  it("needs both a path and a group", async () => {
    expect((await discard({ group: "g1" })).status).toBe(400);
  });
});
