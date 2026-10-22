import { NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../lib/apiAuth";
import { listFiles, resolveBranch, GitServiceError } from "../../lib/gitClient";

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
    const [allFiles, drafts] = await Promise.all([
      listFiles(groupId, branch),
      prisma.modifiedFiles.findMany({
        where: { groupId, userId: me.id, deleted: false },
        select: { name: true, path: true },
      }),
    ]);

    // Files the caller created and saved exist only as drafts until their
    // change request is merged, so the clone doesn't list them.
    const inRepo = new Set(allFiles.map((f) => f.path));
    const draftOnly = drafts
      .filter((d) => !inRepo.has(d.path))
      .map((d) => ({ name: d.name, path: d.path, size: 0, type: "file", draft: true }));

    return NextResponse.json([...allFiles, ...draftOnly], { status: 200 });
  } catch (err) {
    if (err instanceof GitServiceError && err.code === "GITHUB_AUTH_EXPIRED") {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
    }
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
