import { NextRequest, NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../lib/auth";

// Reads the session/headers, so it is per-request. Without this Next tries
// to prerender it at build time and logs a dynamic-server-usage error.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ senderId: user.id }, { receiverId: user.id }],
      status: "accepted",
    },
    include: {
      sender: { select: { id: true, name: true, phone: true, image: true } },
      receiver: { select: { id: true, name: true, phone: true, image: true } },
    },
  });

  const friends = friendships.map((f) => {
    const friend = f.senderId === user.id ? f.receiver : f.sender;
    return { id: friend.id, name: friend.name, phone: friend.phone, image: friend.image };
  });

  return NextResponse.json({ friends });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ error: "Phone required" }, { status: 400 });

  const [currentUser, friendUser] = await Promise.all([
    prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } }),
    prisma.user.findFirst({ where: { phone }, select: { id: true, name: true, phone: true } }),
  ]);

  if (!currentUser || !friendUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (currentUser.id === friendUser.id) {
    return NextResponse.json({ error: "Cannot add yourself" }, { status: 400 });
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { senderId: currentUser.id, receiverId: friendUser.id },
        { senderId: friendUser.id, receiverId: currentUser.id },
      ],
    },
  });

  if (existing) {
    if (existing.status === "accepted") {
      return NextResponse.json({ message: "Already friends", friend: friendUser });
    }
    await prisma.friendship.update({ where: { id: existing.id }, data: { status: "accepted" } });
    return NextResponse.json({ message: "Friend added", friend: friendUser });
  }

  await prisma.friendship.create({
    data: { senderId: currentUser.id, receiverId: friendUser.id, status: "accepted" },
  });

  return NextResponse.json({ message: "Friend added", friend: friendUser });
}
