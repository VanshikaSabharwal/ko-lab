import { NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "../../lib/apiAuth";
import { recordMemberInvited } from "../../lib/memberEvents";

export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { userId, groupId } = await req.json();

  if (!userId || !groupId) {
    return NextResponse.json(
      { error: "User ID and Group ID are required" },
      { status: 400 },
    );
  }

  try {
    // Check if the group exists
    const groupExists = await prisma.group.findUnique({
      where: { id: groupId },
    });

    if (!groupExists) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Only the group owner may add other users; anyone may add themselves
    if (userId !== me.id && groupExists.ownerId !== me.id) {
      return forbidden("Only the group owner can add other members");
    }

    // The owner is recorded on Group.ownerId, not as a GroupMember row, so the
    // membership check below cannot see them. Without this an owner could add
    // themselves and end up both owner and member — duplicated in the roster,
    // and double-counted anywhere members are listed or rung for a call.
    if (userId === groupExists.ownerId) {
      return NextResponse.json(
        { error: "The group owner is already in this group" },
        { status: 400 },
      );
    }

    // Check if the user is already a member of the group
    const existingMember = await prisma.groupMember.findFirst({
      where: {
        userId,
        groupId,
      },
    });

    if (existingMember) {
      return NextResponse.json(
        { error: "User is already a member of the group" },
        { status: 400 },
      );
    }

    // Add user to the group
    await prisma.groupMember.create({
      data: {
        userId,
        groupId,
        role: "MEMBER", // Default role as per your schema
      },
    });

    // Tell the new member, and announce it in the group chat. Adding someone
    // used to be completely silent — no notification, nothing in the thread.
    const [actor, invitee] = await Promise.all([
      prisma.user.findUnique({ where: { id: me.id }, select: { name: true, email: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    ]);
    await recordMemberInvited({
      groupId,
      actorId: me.id,
      actorName: actor?.name || actor?.email || "Someone",
      inviteeId: userId,
      inviteeName: invitee?.name || invitee?.email || "A new member",
    });

    return NextResponse.json(
      { success: true, message: "User added to the group" },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error adding user to group:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
