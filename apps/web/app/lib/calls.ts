import prisma from "./prisma";
import { deleteLiveKitRoom, listRoomIdentities } from "./livekit";
import { callEventMessage, type CallEvent } from "./systemMessages";

// Group calls outlive any one person: you can leave and come back while others
// carry on. These helpers answer "is this call still going, and who's on it?"
// for the routes that end, decline, find and rejoin calls, and write the call's
// history into the group's chat.

/**
 * How long a call may sit with nobody connected before it counts as over.
 * Covers the caller's first seconds (ringing, nobody has picked up yet) and a
 * lone participant reloading their page.
 */
export const EMPTY_CALL_GRACE_MS = 45_000;

export const LIVE_STATUSES = ["RINGING", "ONGOING"] as const;

interface Actor {
  id: string;
  name?: string | null;
}

/**
 * Add a line to the group's chat: "Asha started a call", "Call ended · 12 min".
 * Best-effort: a call must never fail because its log line couldn't be written.
 */
export async function logCallEvent(
  groupId: string,
  actor: Actor,
  action: CallEvent["action"],
  durationMs?: number,
): Promise<void> {
  const actorName = actor.name || "Someone";
  try {
    await prisma.groupMessage.create({
      data: {
        groupId,
        // Attributed to the person who did it: senderId is a real foreign key
        senderId: actor.id,
        senderName: actorName,
        message: callEventMessage({ action, actorId: actor.id, actorName, durationMs }),
      },
    });
  } catch (error) {
    console.error("Failed to log call event:", error);
  }
}

/** Close a call for good, and say so in the group's chat. */
export async function endCallRoom(
  call: { id: string; livekitRoom: string; groupId: string | null; startedAt: Date },
  actor: Actor,
) {
  // Only the first caller to get here logs it: two people leaving at once
  // would otherwise both write "Call ended".
  const { count } = await prisma.callRoom.updateMany({
    where: { id: call.id, status: { in: [...LIVE_STATUSES] } },
    data: { status: "ENDED", endedAt: new Date() },
  });
  await deleteLiveKitRoom(call.livekitRoom);
  if (count > 0 && call.groupId) {
    await logCallEvent(call.groupId, actor, "ended", Date.now() - call.startedAt.getTime());
  }
}

export interface OngoingCall {
  callId: string;
  type: string;
  startedAt: string;
  /** People connected right now. */
  participants: { id: string; name: string | null; image: string | null }[];
}

/**
 * The group's call that can still be joined, or null.
 *
 * A call the database thinks is live but whose room has been empty past the
 * grace period is closed here. Nothing else would notice it: the "everyone
 * left" webhook can't reach a development machine, and can be missed anywhere.
 */
export async function findOngoingGroupCall(groupId: string): Promise<OngoingCall | null> {
  const calls = await prisma.callRoom.findMany({
    where: { groupId, status: { in: [...LIVE_STATUSES] } },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      livekitRoom: true,
      groupId: true,
      type: true,
      startedAt: true,
      initiatorId: true,
      initiator: { select: { name: true } },
      participants: { select: { leftAt: true } },
    },
  });

  let live: OngoingCall | null = null;
  for (const call of calls) {
    const identities: string[] = live ? [] : await listRoomIdentities(call.livekitRoom);

    if (!live && identities.length > 0) {
      const users: OngoingCall["participants"] = await prisma.user.findMany({
        where: { id: { in: identities } },
        select: { id: true, name: true, image: true },
      });
      live = {
        callId: call.id,
        type: call.type,
        startedAt: call.startedAt.toISOString(),
        participants: users,
      };
      continue;
    }

    // Empty (or an older call than the live one). Recent activity gets the
    // benefit of the doubt; anything else is finished.
    const lastActivity = Math.max(
      call.startedAt.getTime(),
      ...call.participants.map((p) => p.leftAt?.getTime() ?? 0),
    );
    if (live || Date.now() - lastActivity > EMPTY_CALL_GRACE_MS) {
      await endCallRoom(call, { id: call.initiatorId, name: call.initiator.name });
    }
  }
  return live;
}
