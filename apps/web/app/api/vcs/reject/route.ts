import { NextResponse } from "next/server";
import { getSessionUser, unauthorized } from "../../../lib/apiAuth";
import { rejectChangeRequest } from "../../../lib/changeRequests";

// POST — owner rejects a change request: close the PR, delete the branch,
// mark REJECTED, and notify the author. Body: { changeRequestId, reason? }
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { changeRequestId, reason } = await req.json();
  if (!changeRequestId) {
    return NextResponse.json({ error: "changeRequestId is required" }, { status: 400 });
  }

  const outcome = await rejectChangeRequest(changeRequestId, me.id, reason);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus });
  }
  return NextResponse.json({ status: "REJECTED" });
}
