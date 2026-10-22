import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { createLiveKitToken } from "../../../../lib/livekit";
import { logCallEvent } from "../../../../lib/calls";
import { isGroupMember } from "../../../../lib/apiAuth";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const callRoom = await prisma.callRoom.findUnique({
      where: { id: params.id },
      include: { participants: true },
    });

    if (!callRoom) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }

    const isParticipant = callRoom.participants.some((p) => p.userId === session.user.id);
    if (!isParticipant) {
      return NextResponse.json({ error: "Not a participant" }, { status: 403 });
    }

    // Being rung isn't enough on its own: someone removed from the group since
    // then no longer belongs on its call
    if (callRoom.groupId && !(await isGroupMember(callRoom.groupId, session.user.id))) {
      return NextResponse.json({ error: "Not a member of this group" }, { status: 403 });
    }

    await prisma.callRoom.update({
      where: { id: params.id },
      data: { status: "ONGOING" },
    });

    await prisma.callParticipant.updateMany({
      where: { callId: params.id, userId: session.user.id },
      data: { joinedAt: new Date(), leftAt: null },
    });

    if (callRoom.groupId) {
      await logCallEvent(callRoom.groupId, { id: session.user.id, name: session.user.name }, "joined");
    }

    const token = await createLiveKitToken(session.user.id, callRoom.livekitRoom, true, session.user.name ?? undefined);

    return NextResponse.json({
      token,
      roomName: callRoom.livekitRoom,
      callId: callRoom.id,
    }, { status: 200 });
  } catch (error) {
    console.error("Accept call error:", error);
    return NextResponse.json({ error: "Failed to accept call" }, { status: 500 });
  }
}
