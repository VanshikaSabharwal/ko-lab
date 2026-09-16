import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { getSessionUser, unauthorized, forbidden, requireCodeAccess } from "../../../lib/apiAuth";
import { getRepoContext, openChangeRequestBranch, resolveAuthor } from "../../../lib/vcs";
import { checkChangeRequestLimit } from "../../../lib/vcsLimits";
import { draftContentFor, clearDrafts, contentToPlain } from "../../../lib/draftStore";

// POST — a member submits their drafts as a change request:
// branch from baseSha → commit → merge default in → open PR.
// Body: { groupId, title }
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { groupId, title } = await req.json();
  if (!groupId || !title?.trim()) {
    return NextResponse.json({ error: "groupId and title are required" }, { status: 400 });
  }

  // Must be the owner or a member with active code access
  const gate = await requireCodeAccess(groupId, me.id);
  if (!gate.ok) return gate.res;

  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { ownerId: true } });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  // Free-tier limits
  const limit = await checkChangeRequestLimit(groupId, me.id);
  if (!limit.ok) {
    return NextResponse.json({ error: limit.reason, code: "LIMIT" }, { status: 429 });
  }

  // Gather this member's drafts (metadata only — content lives in the clone)
  const drafts = await prisma.modifiedFiles.findMany({
    where: { groupId, userId: me.id },
    select: { path: true, content: true, baseSha: true, deleted: true },
  });
  if (drafts.length === 0) {
    return NextResponse.json({ error: "No changes to submit" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await getRepoContext(groupId);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Couldn't reach the GitHub repo: ${err.message}` },
      { status: 502 },
    );
  }

  // Base the branch on what the author actually edited from; fall back to
  // current head only for legacy drafts saved before baseSha existed.
  const baseSha = drafts.find((d) => d.baseSha)?.baseSha || ctx.headSha;

  const author = await resolveAuthor(me.id);
  if (!author.username) {
    return forbidden("Connect GitHub before submitting a change request");
  }

  // cr/<username>/<n> — n increments per author per group
  const priorCount = await prisma.changeRequest.count({ where: { groupId, authorId: me.id } });
  const branchName = `cr/${author.username}/${priorCount + 1}`;

  try {
    // Pull the drafted text from the user's draft objects (legacy rows fall
    // back to stored content). Deleted drafts commit as a tree deletion.
    const files = await Promise.all(
      drafts.map(async (d): Promise<{ path: string; content: string; deleted?: boolean }> => {
        if (d.deleted) return { path: d.path, content: "", deleted: true };
        const content = await draftContentFor(groupId, me.id, d.path, d.content);
        if (content === null) {
          throw new Error(`Draft content is missing for ${d.path}`);
        }
        return { path: d.path, content };
      }),
    );

    const result = await openChangeRequestBranch({
      ctx,
      branchName,
      baseSha,
      files,
      commitMessage: title.trim(),
      author: { name: author.name, email: author.email },
      authorToken: author.token,
    });

    const cr = await prisma.changeRequest.create({
      data: {
        groupId,
        authorId: me.id,
        title: title.trim(),
        branchName: result.branchName,
        prNumber: result.prNumber || null,
        prUrl: result.prUrl || null,
        status: result.status,
        baseSha,
        files,
      },
    });

    // Notify the owner (reuse the existing notifications table)
    await prisma.notifications.create({
      data: {
        userId: me.id,
        groupId,
        ownerId: group.ownerId,
        ownerName: "",
        userName: author.name,
        groupName: "",
        message: `Change request: ${title.trim()}`,
        createdAt: new Date(),
      },
    });

    if (result.status === "CONFLICT") {
      return NextResponse.json(
        {
          changeRequestId: cr.id,
          status: "CONFLICT",
          message:
            "Your branch conflicts with the latest main. Pull the newest files into your draft and resubmit.",
        },
        { status: 409 },
      );
    }

    // Clean the member's drafts now they live on the branch
    await prisma.modifiedFiles.deleteMany({ where: { groupId, userId: me.id } });
    await clearDrafts(groupId, me.id);

    return NextResponse.json({
      changeRequestId: cr.id,
      status: cr.status,
      prNumber: cr.prNumber,
      prUrl: cr.prUrl,
      branchName: cr.branchName,
    });
  } catch (err: any) {
    console.error("CR submit failed:", err);
    // Best-effort cleanup of a half-created branch
    return NextResponse.json(
      { error: err.message || "Failed to create change request", code: err.status },
      { status: 502 },
    );
  }
}

// GET — list change requests for a group (owner sees all; members see their own)
// Query: ?groupId=...
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ error: "groupId is required" }, { status: 400 });

  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { ownerId: true } });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const isOwner = group.ownerId === me.id;
  const changeRequests = (await prisma.changeRequest.findMany({
    where: { groupId, ...(isOwner ? {} : { authorId: me.id }) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      branchName: true,
      prNumber: true,
      prUrl: true,
      status: true,
      files: true,
      createdAt: true,
      author: { select: { name: true, image: true } },
    },
  })).map((cr) => ({
    ...cr,
    // Legacy rows stored base64 file text; new ones store plain UTF-8. Decode
    // the legacy form so the review diff renders the same either way.
    files: (cr.files as { path: string; content?: string | null; deleted?: boolean }[] | null)?.map(
      (f) => ({ ...f, content: contentToPlain(f.content ?? null) }),
    ) ?? null,
  }));

  return NextResponse.json({ isOwner, changeRequests });
}
