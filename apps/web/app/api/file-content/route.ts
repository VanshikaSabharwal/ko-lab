import { NextResponse } from "next/server";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../lib/apiAuth";
import { readFile, resolveBranch } from "../../lib/gitClient";
import prisma from "../../lib/prisma";
import { draftContentFor } from "../../lib/draftStore";

// Past this the editor turns off highlighting and linting (same tier as the
// git service's).
const HEAVY_BYTES = 1024 * 1024;

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

    // Looked up together: most files have no draft, so waiting on the draft
    // check before reading the repo would slow every open for nothing.
    const [draft, repo] = await Promise.all([
      prisma.modifiedFiles.findUnique({
        where: { userId_groupId_path: { userId: me.id, groupId, path: filePath } },
        select: { deleted: true, content: true },
      }),
      resolveBranch(groupId, ref)
        .then(async (branch) => ({ branch, data: await readFile(groupId, branch, filePath) }))
        // A file the caller created isn't in the repo; that only matters if
        // there turns out to be no draft either.
        .catch((error: unknown) => ({ error })),
    ]);

    // The caller's own saved draft wins over the repo, so their edits are
    // still there after a reload. Drafts are per user: nobody else sees them
    // until the change request is merged.
    if (draft && !draft.deleted) {
      const text = await draftContentFor(groupId, me.id, filePath, draft.content);
      if (text !== null) {
        const size = Buffer.byteLength(text);
        return NextResponse.json(
          {
            content: text,
            size,
            name: String(filePath).split("/").pop() ?? "",
            heavy: size > HEAVY_BYTES,
            draft: true,
          },
          { status: 200 },
        );
      }
    }

    if ("error" in repo) throw repo.error;
    const { branch, data } = repo;

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