import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../../lib/apiAuth";
import { isFullyExpired, newToken, previewState } from "../../../lib/livePreview";
import { SHARE_DURATIONS_MINUTES } from "../../../lib/livePreviewConfig";

function originOf(req: Request): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(req.url).origin;
}

/**
 * Create (or extend) a public link to the caller's live preview. Only the
 * preview's author can share it, which the per-user lookup guarantees.
 */
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { groupId, minutes } = await req.json().catch(() => ({}));
  if (typeof groupId !== "string" || !SHARE_DURATIONS_MINUTES.includes(minutes)) {
    return NextResponse.json(
      { error: `groupId and minutes (${SHARE_DURATIONS_MINUTES.join(", ")}) are required` },
      { status: 400 },
    );
  }
  if (!(await isGroupMember(groupId, me.id))) return forbidden("Not a member of this group");

  const preview = await prisma.livePreview.findUnique({
    where: { groupId_userId: { groupId, userId: me.id } },
  });
  if (!preview || isFullyExpired(preview)) {
    return NextResponse.json({ error: "Make the site live before sharing it" }, { status: 409 });
  }

  const now = new Date();
  const stillShared = preview.shareToken && preview.shareExpiresAt && preview.shareExpiresAt > now;
  const updated = await prisma.livePreview.update({
    where: { id: preview.id },
    data: {
      // Extending a live share keeps its URL, so people who have it aren't cut off
      shareToken: stillShared ? preview.shareToken : newToken(),
      shareExpiresAt: new Date(now.getTime() + minutes * 60_000),
    },
  });
  return NextResponse.json({ preview: previewState(originOf(req), updated) });
}

/** Stop sharing. The private link is unaffected. */
export async function DELETE(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const groupId = new URL(req.url).searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ error: "groupId is required" }, { status: 400 });

  const preview = await prisma.livePreview.findUnique({
    where: { groupId_userId: { groupId, userId: me.id } },
  });
  if (!preview) return NextResponse.json({ preview: null });

  const updated = await prisma.livePreview.update({
    where: { id: preview.id },
    data: { shareToken: null, shareExpiresAt: null },
  });
  return NextResponse.json({
    preview: isFullyExpired(updated) ? null : previewState(originOf(req), updated),
  });
}
