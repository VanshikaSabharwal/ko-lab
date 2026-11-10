import { NextResponse } from "next/server";
import { getSessionUser, unauthorized } from "../../../lib/apiAuth";
import { mergeChangeRequest } from "../../../lib/changeRequests";

// POST — owner approves a change request: squash-merge the PR, delete the
// branch, mark the CR MERGED. Body: { changeRequestId }
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { changeRequestId } = await req.json();
  if (!changeRequestId) {
    return NextResponse.json({ error: "changeRequestId is required" }, { status: 400 });
  }

  const outcome = await mergeChangeRequest(changeRequestId, me.id);
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, ...(outcome.status && { status: outcome.status }) },
      { status: outcome.httpStatus },
    );
  }
  return NextResponse.json({ status: "MERGED" });
}
