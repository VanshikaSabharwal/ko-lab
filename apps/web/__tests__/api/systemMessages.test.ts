import { describe, expect, it } from "vitest";
import {
  memberAddedMessage,
  systemMessageText,
  SYSTEM_MESSAGE_PREFIX,
} from "../../app/lib/systemMessages";

/**
 * Membership lines are phrased for whoever reads them: the actor sees "You
 * added…", the new member sees "…added you", everyone else sees both names.
 */
describe("systemMessageText", () => {
  const added = memberAddedMessage({
    actorId: "owner-1",
    actorName: "Vanshika Sabharwal",
    inviteeId: "member-1",
    inviteeName: "Neelam Sabharwal",
  });

  it("uses names for a bystander", () => {
    expect(systemMessageText(added, { viewerId: "someone-else" })).toBe(
      "Vanshika Sabharwal added Neelam Sabharwal to the group",
    );
  });

  it("says 'You added' to the person who added them", () => {
    expect(systemMessageText(added, { viewerId: "owner-1" })).toBe(
      "You added Neelam Sabharwal to the group",
    );
  });

  it("says 'added you' to the new member", () => {
    expect(systemMessageText(added, { viewerId: "member-1" })).toBe(
      "Vanshika Sabharwal added you to the group",
    );
  });

  it("tells apart two accounts with the same display name", () => {
    const sameName = memberAddedMessage({
      actorId: "owner-1",
      actorName: "Vanshika Sabharwal",
      inviteeId: "second-account",
      inviteeName: "Vanshika Sabharwal",
    });
    expect(systemMessageText(sameName, { viewerId: "owner-1" })).toBe(
      "You added Vanshika Sabharwal to the group",
    );
    expect(systemMessageText(sameName, { viewerId: "second-account" })).toBe(
      "Vanshika Sabharwal added you to the group",
    );
  });

  it("reads a self-add (joining by link) as joining", () => {
    const joined = memberAddedMessage({
      actorId: "member-1",
      actorName: "Neelam Sabharwal",
      inviteeId: "member-1",
      inviteeName: "Neelam Sabharwal",
    });
    expect(systemMessageText(joined, { viewerId: "member-1" })).toBe("You joined the group");
    expect(systemMessageText(joined, { viewerId: "owner-1" })).toBe("Neelam Sabharwal joined the group");
  });

  it("handles an invite to someone without an account", () => {
    const invited = memberAddedMessage({
      actorId: "owner-1",
      actorName: "Vanshika Sabharwal",
      inviteeId: null,
      inviteeName: "+919000000000",
    });
    expect(systemMessageText(invited, { viewerId: "owner-1" })).toBe(
      "You added +919000000000 to the group",
    );
  });

  describe("older plain-text messages", () => {
    const legacy = `${SYSTEM_MESSAGE_PREFIX}Vanshika Sabharwal added Neelam Sabharwal to the group`;

    it("recognises the actor from the row's sender", () => {
      expect(systemMessageText(legacy, { viewerId: "owner-1", senderId: "owner-1" })).toBe(
        "You added Neelam Sabharwal to the group",
      );
    });

    it("never guesses 'you' for the added person from a name", () => {
      expect(systemMessageText(legacy, { viewerId: "member-1", senderId: "owner-1" })).toBe(
        "Vanshika Sabharwal added Neelam Sabharwal to the group",
      );
    });
  });
});
