import { NextResponse } from "next/server";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../lib/apiAuth";
import { listFiles, resolveBranch } from "../../lib/gitClient";

export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("group");
  const ref = searchParams.get("ref"); // optional branch; defaults to repo default

  if (!groupId) {
    return NextResponse.json(
      { error: "Group ID is required" },
      { status: 400 },
    );
  }

  if (!(await isGroupMember(groupId, me.id))) {
    return forbidden("Not a member of this group");
  }

  try {
    const branch = await resolveBranch(groupId, ref);
    const allFiles = await listFiles(groupId, branch);
    return NextResponse.json(allFiles, { status: 200 });
  } catch (err) {
    console.error("Error listing files via git service: ", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch group or GitHub repository",
      },
      { status: 500 },
    );
  }
}