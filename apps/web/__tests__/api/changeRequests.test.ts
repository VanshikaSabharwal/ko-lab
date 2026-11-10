/**
 * Merge/reject, shared by /api/vcs/merge, /api/vcs/reject and the assistant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: {
    changeRequest: { findUnique: vi.fn(), update: vi.fn() },
    group: { findUnique: vi.fn() },
    notifications: { create: vi.fn() },
    rejectedCr: { create: vi.fn() },
  },
}));
vi.mock("../../app/lib/pushClient", () => ({ pushToUsers: vi.fn(async () => 1) }));

const { octokit } = vi.hoisted(() => ({
  octokit: {
    rest: {
      pulls: { get: vi.fn(), merge: vi.fn(), update: vi.fn() },
      git: { deleteRef: vi.fn() },
    },
  },
}));
vi.mock("../../app/lib/vcs", () => ({
  getRepoContext: vi.fn(async () => ({ octokit, owner: "o", repo: "r" })),
}));

import prisma from "../../app/lib/prisma";
import { pushToUsers } from "../../app/lib/pushClient";
import { mergeChangeRequest, rejectChangeRequest } from "../../app/lib/changeRequests";

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<string, Record<string, Mock>> & {
  changeRequest: Record<"findUnique" | "update", Mock>;
  group: Record<"findUnique", Mock>;
  notifications: Record<"create", Mock>;
  rejectedCr: Record<"create", Mock>;
};

const OPEN_CR = {
  id: "cr1",
  groupId: "g1",
  branchName: "feature",
  prNumber: 7,
  status: "OPEN",
  title: "Add email validation",
  authorId: "alice",
  author: { name: "Alice" },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.changeRequest.findUnique.mockResolvedValue(OPEN_CR);
  db.group.findUnique.mockResolvedValue({
    ownerId: "owner",
    ownerName: "Olivia",
    groupName: "Anime Website",
    githubRepo: "anime",
  });
  octokit.rest.pulls.get.mockResolvedValue({ data: { mergeable: true } });
  octokit.rest.pulls.merge.mockResolvedValue({});
  octokit.rest.pulls.update.mockResolvedValue({});
  octokit.rest.git.deleteRef.mockResolvedValue({});
});

describe("mergeChangeRequest", () => {
  it("refuses anyone but the owner, before touching GitHub", async () => {
    const outcome = await mergeChangeRequest("cr1", "alice");
    expect(outcome).toEqual({
      ok: false,
      httpStatus: 403,
      error: "Only the group owner can merge change requests",
    });
    expect(octokit.rest.pulls.merge).not.toHaveBeenCalled();
  });

  it("merges, marks MERGED, and tells the author", async () => {
    const outcome = await mergeChangeRequest("cr1", "owner");
    expect(outcome).toEqual({ ok: true, status: "MERGED", title: "Add email validation" });
    expect(db.changeRequest.update).toHaveBeenCalledWith({ where: { id: "cr1" }, data: { status: "MERGED" } });
    expect(db.notifications.create.mock.calls[0]![0].data).toMatchObject({
      recipientId: "alice",
      type: "CR_MERGED",
    });
    expect(pushToUsers).toHaveBeenCalledWith(["alice"], expect.objectContaining({ notificationType: "CR_MERGED" }));
  });

  it("marks a conflicting PR CONFLICT instead of merging", async () => {
    octokit.rest.pulls.get.mockResolvedValue({ data: { mergeable: false } });
    const outcome = await mergeChangeRequest("cr1", "owner");
    expect(outcome).toMatchObject({ ok: false, httpStatus: 409, status: "CONFLICT" });
    expect(octokit.rest.pulls.merge).not.toHaveBeenCalled();
  });

  it("won't merge a CR that isn't open", async () => {
    db.changeRequest.findUnique.mockResolvedValue({ ...OPEN_CR, status: "REJECTED" });
    const outcome = await mergeChangeRequest("cr1", "owner");
    expect(outcome).toMatchObject({ ok: false, httpStatus: 400 });
  });
});

describe("rejectChangeRequest", () => {
  it("closes the PR, marks REJECTED, and passes the reason to the author", async () => {
    const outcome = await rejectChangeRequest("cr1", "owner", "  Please add tests ");
    expect(outcome).toEqual({ ok: true, status: "REJECTED", title: "Add email validation" });
    expect(octokit.rest.pulls.update).toHaveBeenCalledWith(expect.objectContaining({ state: "closed" }));
    expect(db.rejectedCr.create.mock.calls[0]![0].data).toMatchObject({
      userId: "alice",
      message: "Please add tests",
    });
  });

  it("refuses anyone but the owner", async () => {
    const outcome = await rejectChangeRequest("cr1", "alice");
    expect(outcome).toMatchObject({ ok: false, httpStatus: 403 });
    expect(db.changeRequest.update).not.toHaveBeenCalled();
  });
});
