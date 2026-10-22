import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { deleteLiveKitRoom, listRoomIdentities } from "../../../../lib/livekit";
import { endCallRoom, logCallEvent, LIVE_STATUSES } from "../../../../lib/calls";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";

/**
 * Hang up.
 *
 * A one-to-one call ends for both people. A group call only loses the person
 * hanging up: it carries on for everyone else, who can be rejoined from the
 * chat, and ends when the last person leaves. `ended` in the response tells the
 * client which of the two happened.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = { id: session.user.id, name: session.user.name };

  try {
    const callRoom = await prisma.callRoom.findUnique({
      where: { id: params.id },
      include: { participants: true },
    });

    if (!callRoom) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    // Only a participant may end the call
    const isParticipant = callRoom.participants.some((p) => p.userId === me.id);
    if (!isParticipant) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }

    const isLive = (LIVE_STATUSES as readonly string[]).includes(callRoom.status);

    if (!callRoom.groupId) {
      if (isLive) {
        await prisma.callRoom.update({
          where: { id: params.id },
          data: { status: "ENDED", endedAt: new Date() },
        });
      }
      await deleteLiveKitRoom(callRoom.livekitRoom);
      return NextResponse.json({ message: "Call ended", ended: true }, { status: 200 });
    }

    // Already over (someone else was the last to leave): nothing more to do
    if (!isLive) {
      return NextResponse.json({ message: "Call ended", ended: true }, { status: 200 });
    }

    await prisma.callParticipant.updateMany({
      where: { callId: params.id, userId: me.id },
      data: { leftAt: new Date() },
    });

    // Ask the media server, not the database, who is still connected. The
    // client disconnects just before calling this, so it may still be listed.
    const others = (await listRoomIdentities(callRoom.livekitRoom)).filter((id) => id !== me.id);

    if (others.length === 0) {
      await endCallRoom(callRoom, me);
      return NextResponse.json({ message: "Call ended", ended: true }, { status: 200 });
    }

    await logCallEvent(callRoom.groupId, me, "left");
    return NextResponse.json(
      { message: "Left the call", ended: false, remaining: others.length },
      { status: 200 },
    );
  } catch (error) {
    console.error("End call error:", error);
    return NextResponse.json({ error: "Failed to end call" }, { status: 500 });
  }
}
