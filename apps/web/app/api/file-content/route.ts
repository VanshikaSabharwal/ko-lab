import { NextResponse } from "next/server";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../lib/apiAuth";
import { readFile, resolveBranch } from "../../lib/gitClient";

export async function POST(req: Request) {
  try {
    const me = await getSessionUser();
    if (!me) return unauthorized();

    const { groupId, filePath, ref } = await req.json();

    if (!groupId || !filePath) {
      return NextResponse.json(
        { error: "groupId and filePath are required" },
        { status: 400 },
      );
    }

    if (!(await isGroupMember(groupId, me.id))) {
      return forbidden("Not a member of this group");
    }

    const branch = await resolveBranch(groupId, ref);
    const data = await readFile(groupId, branch, filePath);

    // Images rendered by ImagePreview with the browser's session cookie: point
    // at the same-origin download route (which proxies the git service) so the
    // GitHub token never has to be exposed to the browser.
    if (data.binary && data.isImage) {
      const params = new URLSearchParams({ group: groupId, path: filePath });
      if (branch) params.set("ref", branch);
      data.downloadUrl = `/api/file-download?${params.toString()}`;
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error("Error fetching file content: ", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to fetch file content",
      },
      { status: 500 },
    );
  }
}