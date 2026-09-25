import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { createLiveKitToken, ensureLiveKitRoom } from "../../../lib/livekit";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { signRingTicket } from "../../../lib/ringTicket";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { type, targetId, groupId } = await req.json();

  if (!type || (!targetId && !groupId)) {
    return NextResponse.json({ error: "type and targetId or groupId required" }, { status: 400 });
  }

  if (!["AUDIO", "VIDEO", "GROUP"].includes(type)) {
    return NextResponse.json({ error: "Invalid call type" }, { status: 400 });
  }

  try {
    const roomName = `call-${crypto.randomUUID()}`;

    // For a group call, every member is a potential participant. Resolving them
    // here means the ring is addressed to the group's actual roster rather than
    // to whoever happens to have a WebSocket room joined — previously a group
    // offer reached nobody unless the recipient was already sitting on the
    // group chat page.
    let inviteeIds: string[] = [];
    if (groupId) {
      const group = await prisma.group.findUnique({
        where: { id: groupId },
        select: { ownerId: true, members: { select: { userId: true } } },
      });
      if (!group) {
        return NextResponse.json({ error: "Group not found" }, { status: 404 });
      }
      const everyone = new Set<string>([
        group.ownerId,
        ...group.members.map((m) => m.userId),
      ]);
      // Only people in the group may start its call
      if (!everyone.has(session.user.id)) {
        return NextResponse.json({ error: "Not a member of this group" }, { status: 403 });
      }
      // The caller is added separately below.
      everyone.delete(session.user.id);
      inviteeIds = [...everyone];

      if (inviteeIds.length === 0) {
        return NextResponse.json(
          { error: "No one else is in this group to call" },
          { status: 400 },
        );
      }
    } else if (targetId) {
      // 1:1 calls are friends-only: the target must be an accepted friend
      const friendship = await prisma.friendship.findFirst({
        where: {
          status: "accepted",
          OR: [
            { senderId: session.user.id, receiverId: targetId },
            { senderId: targetId, receiverId: session.user.id },
          ],
        },
        select: { id: true },
      });
      if (!friendship) {
        return NextResponse.json(
          { error: "You can only call people on your friend list" },
          { status: 403 },
        );
      }
      inviteeIds = [targetId];
    }

    await ensureLiveKitRoom(roomName);

    const callRoom = await prisma.callRoom.create({
      data: {
        livekitRoom: roomName,
        type: type as any,
        status: "RINGING",
        initiatorId: session.user.id,
        groupId: groupId || null,
        participants: {
          create: [
            { userId: session.user.id },
            ...inviteeIds.map((userId) => ({ userId })),
          ],
        },
      },
      include: {
        participants: true,
      },
    });

    const token = await createLiveKitToken(session.user.id, roomName, true, session.user.name ?? undefined);

    // The socket server rings exactly these invitees and only with this
    // ticket, so the membership/friend checks above can't be skipped by
    // sending a call_offer straight to the socket.
    const ringTicket = signRingTicket({
      callerId: session.user.id,
      callId: callRoom.id,
      roomName,
      groupId: groupId || null,
      invitees: inviteeIds,
    });

    return NextResponse.json({
      callRoom,
      token,
      roomName,
      ringTicket,
    }, { status: 201 });
  } catch (error) {
    console.error("Call initiation error:", error);
    return NextResponse.json({ error: "Failed to initiate call" }, { status: 500 });
  }
}
