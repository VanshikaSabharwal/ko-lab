import { NextResponse } from "next/server";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../../lib/apiAuth";
import { findOngoingGroupCall } from "../../../lib/calls";

/**
 * The group's call that can be joined right now, with who's on it. The group
 * chat asks this to offer "Join": to people who left, missed the ring, or
 * opened the chat after the call started.
 */
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const groupId = new URL(req.url).searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }
  if (!(await isGroupMember(groupId, me.id))) {
    return forbidden("Not a member of this group");
  }

  try {
    return NextResponse.json({ call: await findOngoingGroupCall(groupId) }, { status: 200 });
  } catch (error) {
    console.error("Active call lookup error:", error);
    return NextResponse.json({ error: "Failed to check for a call" }, { status: 500 });
  }
}
