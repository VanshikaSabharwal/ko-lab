/**
 * The group list sent to the browser.
 *
 * This route used to `include` members, which made Prisma return every group
 * column — so each member's browser received the owner's githubAccessToken
 * and sshKey. It must now pick only the fields the chat list renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: { group: { findMany: vi.fn() } },
}));

vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(),
  unauthorized: () => new Response(null, { status: 401 }),
}));

import { GET } from "../../app/api/my-groups/route";
import prisma from "../../app/lib/prisma";
import { getSessionUser } from "../../app/lib/apiAuth";

const findMany = prisma.group.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "me" });
  findMany.mockResolvedValue([
    { id: "g1", groupName: "Test", githubRepo: "repo", ownerName: "owner", image: null },
  ]);
});

describe("GET /api/my-groups", () => {
  it("asks Prisma for an explicit field list, never whole rows", async () => {
    await GET();
    const args = findMany.mock.calls[0]![0];

    expect(args.include).toBeUndefined();
    expect(args.select).toBeDefined();
    expect(args.select.githubAccessToken).toBeUndefined();
    expect(args.select.sshKey).toBeUndefined();
  });

  it("still returns the fields the chat list renders", async () => {
    const res = await GET();
    const { groups } = await res.json();

    expect(groups[0]).toEqual({
      id: "g1",
      groupName: "Test",
      githubRepo: "repo",
      ownerName: "owner",
      image: null,
    });
  });
});
