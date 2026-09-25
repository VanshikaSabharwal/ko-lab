/**
 * Notification routing.
 *
 * The original query filtered on ownerId alone, so anything addressed to a
 * member — "you were added to X" — was written and then shown to nobody but
 * the group owner. recipientId is now the address; ownerId remains the
 * fallback for rows written before it existed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: { notifications: { findMany: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(),
  unauthorized: () => new Response(null, { status: 401 }),
}));

import { GET, PATCH } from "../../app/api/notifications/route";
import prisma from "../../app/lib/prisma";
import { getSessionUser } from "../../app/lib/apiAuth";

beforeEach(() => {
  vi.clearAllMocks();
  (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "me" });
  (prisma.notifications.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

function whereClause() {
  return (prisma.notifications.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    .where;
}

describe("GET /api/notifications", () => {
  it("returns notifications addressed to the caller", async () => {
    await GET();
    expect(whereClause().OR).toContainEqual({ recipientId: "me" });
  });

  it("still shows legacy owner-scoped rows to the owner", async () => {
    await GET();
    // Rows written before recipientId existed carry null there.
    expect(whereClause().OR).toContainEqual({ recipientId: null, ownerId: "me" });
  });

  it("does not send an owner a copy of what they addressed to someone else", async () => {
    await GET();
    const ownerBranch = whereClause().OR.find(
      (c: Record<string, unknown>) => c.ownerId === "me",
    );
    // Constrained to recipientId: null, so a row aimed at a member does not
    // also land in the owner's list.
    expect(ownerBranch.recipientId).toBeNull();
  });

  it("selects the fields the UI needs to render a typed notification", async () => {
    await GET();
    const select = (prisma.notifications.findMany as ReturnType<typeof vi.fn>).mock
      .calls[0]![0].select;
    expect(select.type).toBe(true);
    expect(select.message).toBe(true);
    expect(select.id).toBe(true);
  });

  it("returns an empty list rather than an error when there is nothing", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.notifications).toEqual([]);
  });

  it("rejects an anonymous caller", async () => {
    (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

/**
 * Viewing notifications marks them read, so the unread badge stays cleared
 * after a reload instead of counting every notification ever received.
 */
describe("PATCH /api/notifications", () => {
  beforeEach(() => {
    (prisma.notifications.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });
  });

  function updateCall() {
    return (prisma.notifications.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  }

  it("marks only the caller's unread notifications as read", async () => {
    const res = await PATCH();
    expect(res.status).toBe(200);
    expect((await res.json()).marked).toBe(2);

    const { where, data } = updateCall();
    expect(where.readAt).toBeNull();
    expect(data.readAt).toBeInstanceOf(Date);
  });

  it("uses the same addressing as the list, so it can't clear someone else's", async () => {
    await PATCH();
    await GET();
    expect(updateCall().where.OR).toEqual(whereClause().OR);
  });

  it("rejects an anonymous caller", async () => {
    (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await PATCH();
    expect(res.status).toBe(401);
    expect(prisma.notifications.updateMany).not.toHaveBeenCalled();
  });
});
