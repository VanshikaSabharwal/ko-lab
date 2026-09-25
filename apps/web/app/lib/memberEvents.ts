import prisma from "./prisma";
import { memberAddedMessage } from "./systemMessages";
import { pushToUsers } from "./pushClient";

/**
 * Notifications and chat system messages for membership changes.
 *
 * Three paths add a member — an owner adding one directly, a phone invite, and
 * a join link being redeemed — and each used to write nothing at all, which is
 * why inviting someone produced a WhatsApp link and total silence everywhere
 * else. Centralising it here keeps the three consistent.
 */

interface InvitedParams {
  groupId: string;
  /** Who performed the invite/add. */
  actorId: string;
  actorName: string;
  /** The user being added. Absent for a phone invite to a non-user. */
  inviteeId?: string | null;
  inviteeName: string;
}

/**
 * Record that someone was invited to, or added to, a group.
 *
 * Writes a notification addressed to the invitee (so it shows on their screen,
 * not just the owner's) and a system message in the group chat so the rest of
 * the group sees it in context. Both are best-effort: a failure here must not
 * fail the invite itself, which has already succeeded by this point.
 */
export async function recordMemberInvited({
  groupId,
  actorId,
  actorName,
  inviteeId,
  inviteeName,
}: InvitedParams): Promise<void> {
  try {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { groupName: true, ownerId: true, ownerName: true },
    });
    if (!group) return;

    const writes: Promise<unknown>[] = [];

    // Only when the invitee already has an account. A phone invite to someone
    // with no account has no userId to address — that case is picked up when
    // they redeem the link and become a member.
    if (inviteeId) {
      writes.push(
        prisma.notifications.create({
          data: {
            // recipientId is who sees it; ownerId stays the group owner so the
            // older owner-scoped queries are unaffected. Same convention as
            // the code-access notifications in githubCollaborator.ts.
            recipientId: inviteeId,
            type: "GROUP_INVITE",
            userId: inviteeId,
            groupId,
            userName: inviteeName,
            ownerId: group.ownerId,
            ownerName: group.ownerName,
            groupName: group.groupName,
            message: `${actorName} added you to ${group.groupName}`,
          },
        }),
      );
    }

    // Attributed to the actor rather than a synthetic account: senderId is a
    // real FK to User, and the actor is genuinely who performed this.
    writes.push(
      prisma.groupMessage.create({
        data: {
          groupId,
          senderId: actorId,
          senderName: actorName,
          message: memberAddedMessage({
            actorId,
            actorName,
            inviteeId: inviteeId ?? null,
            inviteeName,
          }),
        },
      }),
    );

    await Promise.all(writes);

    // Tell the invitee's open sockets, so the notification lands now rather
    // than whenever they next open the notifications page.
    if (inviteeId) {
      await pushToUsers([inviteeId], {
        type: "notification",
        notificationType: "GROUP_INVITE",
        groupId,
        groupName: group.groupName,
        message: `${actorName} added you to ${group.groupName}`,
      });
    }
  } catch (error) {
    // Deliberately swallowed: the membership change already happened, and
    // failing the request now would be worse than a missing notification.
    console.error("Failed to record member-invited event:", error);
  }
}

/**
 * Claim any pending invites for a user who has just signed up or joined.
 *
 * An invite is created before the invitee has an account, so there is nobody to
 * notify at the time. This links the invite to the now-existing user and
 * produces the notification that was deferred. The invite may have been
 * addressed to either the phone or the email, so both are matched.
 */
export async function claimPendingInvites(
  userId: string,
  phone: string | null | undefined,
  groupId: string,
  email?: string | null,
): Promise<void> {
  const identifiers = [
    ...(phone ? [{ phone }] : []),
    ...(email ? [{ email: email.trim().toLowerCase() }] : []),
  ];
  if (identifiers.length === 0) return;
  try {
    const invite = await prisma.invite.findFirst({
      where: { groupId, status: "pending", OR: identifiers },
      select: { id: true },
    });
    if (!invite) return;

    await prisma.invite.update({
      where: { id: invite.id },
      data: { status: "accepted" },
    });
  } catch (error) {
    console.error("Failed to claim pending invite:", error);
  }
}
