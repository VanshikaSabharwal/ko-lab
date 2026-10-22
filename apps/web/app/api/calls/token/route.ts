import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { createLiveKitToken } from "../../../lib/livekit";
import { isGroupMember } from "../../../lib/apiAuth";
import { LIVE_STATUSES } from "../../../lib/calls";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";

/**
 * A fresh media token for a call you are already part of (tokens are
 * short-lived, so a long call or a reconnect needs a new one).
 *
 * This used to sign a token for whatever room name it was given, so any
 * signed-in user who learned a room's name could listen in on that call. The
 * room must now belong to a call that is still going, and the caller must
 * belong to that call.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { roomName, identity } = await req.json();
  if (!roomName || !identity || typeof roomName !== "string") {
    return NextResponse.json({ error: "roomName and identity required" }, { status: 400 });
  }

  if (identity !== session.user.id) {
    return NextResponse.json({ error: "Identity mismatch" }, { status: 403 });
  }

  try {
    const callRoom = await prisma.callRoom.findUnique({
      where: { livekitRoom: roomName },
      select: {
        status: true,
        groupId: true,
        participants: { where: { userId: session.user.id }, select: { id: true } },
      },
    });

    // The same answer for "no such room" and "not your call": a stranger
    // learns nothing about which room names exist.
    const refuse = () => NextResponse.json({ error: "Not part of this call" }, { status: 403 });
    if (!callRoom) return refuse();

    const invited = callRoom.participants.length > 0;
    // Any current member may be on a group's call, rung or not
    const member = callRoom.groupId ? await isGroupMember(callRoom.groupId, session.user.id) : false;
    // Someone removed from the group loses the call with it, even if they were rung
    if (callRoom.groupId ? !member : !invited) return refuse();

    if (!(LIVE_STATUSES as readonly string[]).includes(callRoom.status)) {
      return NextResponse.json({ error: "That call has ended" }, { status: 410 });
    }

    const token = await createLiveKitToken(identity, roomName, true, session.user.name ?? undefined);
    return NextResponse.json({ token }, { status: 200 });
  } catch (error) {
    console.error("Token generation error:", error);
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
}
