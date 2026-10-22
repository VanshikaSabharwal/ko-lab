// @vitest-environment node
/**
 * Saving a workspace board says which version it was made from, and is
 * refused if someone else saved since. Saves used to overwrite unconditionally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prisma = vi.hoisted(() => ({
  workspaceBoard: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
}));
vi.mock("../../app/lib/prisma", () => ({ default: prisma }));
vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(async () => ({ id: "u1" })),
  isGroupMember: vi.fn(async () => true),
  unauthorized: () => new Response(null, { status: 401 }),
  forbidden: (m: string) => new Response(JSON.stringify({ error: m }), { status: 403 }),
}));

import { PUT } from "../../app/api/workspace/[groupId]/[type]/route";

const params = { params: { groupId: "g1", type: "ui-design" } };
const content = { nodes: [{ id: "a" }], edges: [] };
const VERSION = "2026-10-15T10:00:00.000Z";

const save = (body: Record<string, unknown>) =>
  PUT(
    new Request("http://x/api/workspace/g1/ui-design", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, ...body }),
    }),
    params,
  );

beforeEach(() => {
  vi.clearAllMocks();
  prisma.workspaceBoard.updateMany.mockResolvedValue({ count: 1 });
});

describe("saving a board", () => {
  it("writes only if the board is still the version the browser started from", async () => {
    const res = await save({ baseUpdatedAt: VERSION });

    expect(res.status).toBe(200);
    expect(prisma.workspaceBoard.updateMany).toHaveBeenCalledWith({
      where: { groupId: "g1", type: "UI_DESIGN", updatedAt: new Date(VERSION) },
      data: { content, updatedAt: expect.any(Date) },
    });
    // The new version comes back for the next save to build on
    const body = await res.json();
    expect(body.updatedAt).not.toBe(VERSION);
  });

  it("refuses, with the current board, when someone saved in between", async () => {
    prisma.workspaceBoard.updateMany.mockResolvedValue({ count: 0 });
    const theirs = { nodes: [{ id: "b" }], edges: [] };
    prisma.workspaceBoard.findUnique.mockResolvedValue({ content: theirs, updatedAt: new Date("2026-10-15T10:00:05Z") });

    const res = await save({ baseUpdatedAt: VERSION });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.content).toEqual(theirs);
    expect(body.updatedAt).toBe("2026-10-15T10:00:05.000Z");
  });

  it("creates a board that doesn't exist yet", async () => {
    prisma.workspaceBoard.create.mockResolvedValue({ content, updatedAt: new Date(VERSION) });
    const res = await save({ baseUpdatedAt: null });
    expect(res.status).toBe(200);
    expect(prisma.workspaceBoard.create).toHaveBeenCalledWith({ data: { groupId: "g1", type: "UI_DESIGN", content } });
  });

  it("refuses to create one that someone else created first", async () => {
    prisma.workspaceBoard.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    prisma.workspaceBoard.findUnique.mockResolvedValue({ content, updatedAt: new Date(VERSION) });
    expect((await save({ baseUpdatedAt: null })).status).toBe(409);
  });

  it("rejects a version that isn't a date", async () => {
    expect((await save({ baseUpdatedAt: "yesterday" })).status).toBe(400);
    expect(prisma.workspaceBoard.updateMany).not.toHaveBeenCalled();
  });

  it("still accepts a save without a version, from an older page", async () => {
    prisma.workspaceBoard.upsert.mockResolvedValue({ content, updatedAt: new Date(VERSION) });
    expect((await save({})).status).toBe(200);
    expect(prisma.workspaceBoard.upsert).toHaveBeenCalled();
  });
});
