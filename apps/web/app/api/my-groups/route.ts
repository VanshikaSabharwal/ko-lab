import { NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { getSessionUser, unauthorized } from "../../lib/apiAuth";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  try {
    // Use findMany to fetch all groups the user is a part of or owns
    const groups = await prisma.group.findMany({
      where: {
        OR: [
          { ownerId: me.id },
          {
            members: {
              some: { userId: me.id },
            },
          },
        ],
      },
      // Only what the chat list renders. Never githubAccessToken or sshKey:
      // this response goes to every member's browser.
      select: {
        id: true,
        groupName: true,
        githubRepo: true,
        ownerName: true,
        image: true,
      },
    });

    // Check if groups are found
    if (!groups.length) {
      return NextResponse.json(
        { message: "No groups found for this user." },
        { status: 404 },
      );
    }

    return NextResponse.json({ groups }, { status: 200 });
  } catch (error) {
    console.error("Error checking group membership:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 },
    );
  }
}
