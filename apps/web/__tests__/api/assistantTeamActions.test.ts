/**
 * The assistant's group-level write tools: adding members, reviewing change
 * requests, posting and notifying. Each is limited to what the user could do
 * themselves — owner-only actions stay owner-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: {
    group: { findMany: vi.fn(), findFirst: vi.fn() },
    groupMember: { findMany: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
    changeRequest: { findMany: vi.fn(), findUnique: vi.fn() },
    groupMessage: { create: vi.fn() },
    notifications: { createMany: vi.fn() },
    assistantAction: { create: vi.fn(async () => ({ id: "act1" })) },
  },
}));
vi.mock("../../app/lib/pushClient", () => ({ pushToUsers: vi.fn(async () => 1) }));
vi.mock("../../app/lib/memberEvents", () => ({ recordMemberInvited: vi.fn() }));
vi.mock("../../app/lib/changeRequests", () => ({
  mergeChangeRequest: vi.fn(),
  rejectChangeRequest: vi.fn(),
}));
vi.mock("../../app/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "me" } })) }));

import prisma from "../../app/lib/prisma";
import { pushToUsers } from "../../app/lib/pushClient";
import { recordMemberInvited } from "../../app/lib/memberEvents";
import { mergeChangeRequest, rejectChangeRequest } from "../../app/lib/changeRequests";
import { executeAction, proposeAction } from "../../app/lib/assistantActions";

type Mock = ReturnType<typeof vi.fn>;
const db = prisma as unknown as Record<
  "group" | "groupMember" | "user" | "changeRequest" | "groupMessage" | "notifications" | "assistantAction",
  Record<"findMany" | "findFirst" | "findUnique" | "create" | "createMany", Mock>
>;

const OWNED = {
  id: "g1",
  groupName: "Anime Website",
  ownerId: "me",
  ownerName: "Vanshika",
  members: [{ userId: "alice", role: "MEMBER" }],
};
const JOINED = {
  id: "g2",
  groupName: "Blog",
  ownerId: "olivia",
  ownerName: "Olivia",
  members: [{ userId: "me", role: "MEMBER" }],
};

const PEOPLE = [
  { user: { id: "alice", name: "Alice", email: "alice@example.com" } },
  { user: { id: "me", name: "Vanshika", email: "v@example.com" } },
];

const ctx = { userId: "me", today: "2026-10-21", conversationId: null };

beforeEach(() => {
  vi.clearAllMocks();
  db.group.findMany.mockResolvedValue([OWNED, JOINED]);
  db.group.findFirst.mockResolvedValue(OWNED);
  db.groupMember.findMany.mockResolvedValue(PEOPLE);
  db.user.findUnique.mockResolvedValue({ name: "Vanshika", email: "v@example.com" });
});

describe("add_group_member", () => {
  it("looks people up by exact email, never by name", async () => {
    db.user.findFirst.mockResolvedValue({ id: "rahul", name: "Rahul", email: "rahul@example.com" });
    const action = await proposeAction(
      "add_group_member",
      { group: "Anime Website", person: "Rahul@Example.com" },
      ctx,
    );
    expect(db.user.findFirst.mock.calls[0]![0].where).toEqual({
      email: { equals: "Rahul@Example.com", mode: "insensitive" },
    });
    expect(action.preview.title).toBe("Add Rahul to Anime Website");
  });

  it("is owner-only, like the add-member route", async () => {
    await expect(
      proposeAction("add_group_member", { group: "Blog", person: "x@example.com" }, ctx),
    ).rejects.toThrow("Only the group owner can add members.");
    expect(db.user.findFirst).not.toHaveBeenCalled();
  });

  it("says when there's no such account", async () => {
    db.user.findFirst.mockResolvedValue(null);
    await expect(
      proposeAction("add_group_member", { group: "Anime Website", person: "+911234" }, ctx),
    ).rejects.toThrow(/no Ko-Lab account with the phone number "\+911234"/);
  });

  it("refuses someone already in the group", async () => {
    db.user.findFirst.mockResolvedValue({ id: "alice", name: "Alice", email: "alice@example.com" });
    await expect(
      proposeAction("add_group_member", { group: "Anime Website", person: "alice@example.com" }, ctx),
    ).rejects.toThrow("Alice is already in Anime Website.");
  });

  it("adds the member and records the invite on confirm", async () => {
    db.user.findUnique.mockResolvedValueOnce({ name: "Rahul", email: "rahul@example.com" });
    const result = await executeAction("add_group_member", { groupId: "g1", userId: "rahul" }, "me");
    expect(db.groupMember.create).toHaveBeenCalledWith({
      data: { groupId: "g1", userId: "rahul", role: "MEMBER" },
    });
    expect(recordMemberInvited).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "g1", actorId: "me", inviteeId: "rahul" }),
    );
    expect(result.message).toBe("Added Rahul to Anime Website.");
  });

  it("re-checks ownership at confirm time", async () => {
    db.group.findFirst.mockResolvedValue(JOINED);
    await expect(
      executeAction("add_group_member", { groupId: "g2", userId: "rahul" }, "me"),
    ).rejects.toThrow("Only the group owner can add members.");
    expect(db.groupMember.create).not.toHaveBeenCalled();
  });
});

describe("change requests", () => {
  const cr = (groupOwner: string) => ({
    id: "cr1",
    title: "Add email validation",
    author: { name: "Alice", email: "alice@example.com" },
    group: { id: "g1", groupName: "Anime Website", ownerId: groupOwner },
  });

  it("proposes a merge only for the group owner", async () => {
    db.changeRequest.findMany.mockResolvedValue([cr("me")]);
    const action = await proposeAction("merge_change_request", { change_request: "email" }, ctx);
    expect(action.preview.title).toBe('Merge change request "Add email validation"');
    expect(db.changeRequest.findMany.mock.calls[0]![0].where.status).toEqual({ in: ["OPEN"] });

    db.changeRequest.findMany.mockResolvedValue([cr("olivia")]);
    await expect(
      proposeAction("merge_change_request", { change_request: "email" }, ctx),
    ).rejects.toThrow("Only the group owner can merge change requests.");
  });

  it("carries the reason to the author when rejecting", async () => {
    db.changeRequest.findMany.mockResolvedValue([cr("me")]);
    const action = await proposeAction(
      "reject_change_request",
      { change_request: "Add email validation", reason: "Please add error handling" },
      ctx,
    );
    expect(action.preview.details).toContainEqual({
      label: "Message to author",
      value: "Please add error handling",
    });
    expect(db.assistantAction.create.mock.calls[0]![0].data.args).toEqual({
      changeRequestId: "cr1",
      reason: "Please add error handling",
    });
  });

  it("goes through the same merge code as the review page", async () => {
    (mergeChangeRequest as Mock).mockResolvedValue({ ok: true, status: "MERGED", title: "Add email validation" });
    db.changeRequest.findUnique.mockResolvedValue({ groupId: "g1" });
    const result = await executeAction("merge_change_request", { changeRequestId: "cr1" }, "me");
    expect(mergeChangeRequest).toHaveBeenCalledWith("cr1", "me");
    expect(result.message).toBe('Merged "Add email validation".');
  });

  it("surfaces a merge conflict as a failure", async () => {
    (rejectChangeRequest as Mock).mockResolvedValue({ ok: false, httpStatus: 400, error: "Already merged" });
    await expect(
      executeAction("reject_change_request", { changeRequestId: "cr1", reason: "x" }, "me"),
    ).rejects.toThrow("Already merged");
    expect(rejectChangeRequest).toHaveBeenCalledWith("cr1", "me", "x");
  });
});

describe("send_group_message", () => {
  it("lets any member post, as themselves, and pushes it to open chats", async () => {
    db.group.findFirst.mockResolvedValue({ ...JOINED, ownerId: "olivia" });
    db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "olivia"
        ? { id: "olivia", name: "Olivia", email: "o@example.com" }
        : { name: "Vanshika", email: "v@example.com" },
    );
    db.groupMessage.create.mockResolvedValue({ id: "m1", createdAt: new Date(1000) });

    await executeAction("send_group_message", { groupId: "g2", message: "API is ready for review" }, "me");

    expect(db.groupMessage.create.mock.calls[0]![0].data).toEqual({
      groupId: "g2",
      senderId: "me",
      senderName: "Vanshika",
      message: "API is ready for review",
    });
    expect(pushToUsers).toHaveBeenCalledWith(
      ["alice", "me", "olivia"],
      expect.objectContaining({ type: "group_message", groupId: "g2", content: "API is ready for review" }),
    );
  });

  it("rejects an empty message", async () => {
    await expect(
      proposeAction("send_group_message", { group: "Blog", message: "   " }, ctx),
    ).rejects.toThrow("The message is empty.");
  });
});

describe("notify_team", () => {
  it("is limited to the owner or an admin", async () => {
    await expect(
      proposeAction("notify_team", { group: "Blog", message: "Code review is done" }, ctx),
    ).rejects.toThrow("Only the group owner or an admin can notify the whole team.");
  });

  it("notifies everyone except the sender", async () => {
    const result = await executeAction("notify_team", { groupId: "g1", message: "Code review is done" }, "me");
    const rows = db.notifications.createMany.mock.calls[0]![0].data;
    expect(rows.map((r: { recipientId: string }) => r.recipientId)).toEqual(["alice"]);
    expect(rows[0]).toMatchObject({ type: "TEAM_NOTICE", message: "Vanshika (Anime Website): Code review is done" });
    expect(result.message).toBe("Notified 1 person in Anime Website.");
  });
});
