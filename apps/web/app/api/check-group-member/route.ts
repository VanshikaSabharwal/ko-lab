import prisma from "../../lib/prisma";
import { getSessionUser, isGroupMember, unauthorized } from "../../lib/apiAuth";

export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  // Parse the query parameters
  const { searchParams } = new URL(req.url);
  const group = searchParams.get("group");
  // Validate request parameters
  if (!group) {
    return new Response(
      JSON.stringify({ error: "Invalid request parameters." }),
      { status: 400 },
    );
  }

  try {
    // Only the id matters here. Loading the whole row made this fail whenever
    // a Group column was missing from the database (e.g. a migration not yet
    // applied), and the chat read that failure as "not a member".
    const groupExists = await prisma.group.findUnique({
      where: { id: group },
      select: { id: true },
    });

    // If the group doesn't exist, return an error
    if (!groupExists) {
      return new Response(JSON.stringify({ error: "Group not found." }), {
        status: 404,
      });
    }

    // The owner has no GroupMember row, so a members-only check said "no" to them
    const isMember = await isGroupMember(group, me.id);

    // Return true or false based on membership
    return new Response(JSON.stringify({ exists: isMember }), { status: 200 });
  } catch (error) {
    console.error("Error checking group membership:", error);
    return new Response(JSON.stringify({ error: "Internal server error." }), {
      status: 500,
    });
  }
}
