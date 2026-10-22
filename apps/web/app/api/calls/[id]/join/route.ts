import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { createLiveKitToken, ensureLiveKitRoom } from "../../../../lib/livekit";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../../../lib/apiAuth";
import { logCallEvent, LIVE_STATUSES } from "../../../../lib/calls";

/**
 * Join a group call that's already going: coming back after leaving, joining
 * after missing the ring, or as someone added to the group since it started.
 * Any current member may; being on the original ring list isn't required.
 */
export async function PUT(_req: Request, { params }: { params: { id: string } }) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  try {
    const callRoom = await prisma.callRoom.findUnique({
      where: { id: params.id },
      select: { id: true, livekitRoom: true, groupId: true, status: true, type: true },
    });

    if (!callRoom || !callRoom.groupId) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }
    if (!(await isGroupMember(callRoom.groupId, me.id))) {
      return forbidden("Not a member of this group");
    }
    if (!(LIVE_STATUSES as readonly string[]).includes(callRoom.status)) {
      return NextResponse.json({ error: "That call has ended" }, { status: 410 });
    }

    await prisma.callParticipant.upsert({
      where: { callId_userId: { callId: callRoom.id, userId: me.id } },
      update: { joinedAt: new Date(), leftAt: null },
      create: { callId: callRoom.id, userId: me.id, joinedAt: new Date() },
    });
    await prisma.callRoom.update({ where: { id: callRoom.id }, data: { status: "ONGOING" } });

    // The media server drops a room that has sat empty; the call is still
    // live as far as the group is concerned, so bring it back
    await ensureLiveKitRoom(callRoom.livekitRoom);
    const token = await createLiveKitToken(me.id, callRoom.livekitRoom, true, me.name ?? undefined);

    await logCallEvent(callRoom.groupId, me, "joined");

    return NextResponse.json(
      {
        token,
        roomName: callRoom.livekitRoom,
        callId: callRoom.id,
        groupId: callRoom.groupId,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Join call error:", error);
    return NextResponse.json({ error: "Failed to join the call" }, { status: 500 });
  }
}
