import { NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../lib/apiAuth";
import { resolveBranch } from "../../lib/gitClient";
import {
  PreviewError,
  deletePreviewObjects,
  isFullyExpired,
  newToken,
  previewState,
  publishSnapshot,
  sweepExpiredPreviews,
  updateSnapshotFile,
} from "../../lib/livePreview";
import { PRIVATE_PREVIEW_MINUTES } from "../../lib/livePreviewConfig";

// Copying a site file by file from the git service can take a while.
export const maxDuration = 60;

function originOf(req: Request): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, "") || new URL(req.url).origin;
}

async function gate(groupId: unknown) {
  const me = await getSessionUser();
  if (!me) return { res: unauthorized() } as const;
  if (typeof groupId !== "string" || !groupId) {
    return { res: NextResponse.json({ error: "groupId is required" }, { status: 400 }) } as const;
  }
  if (!(await isGroupMember(groupId, me.id))) return { res: forbidden("Not a member of this group") } as const;
  return { me, groupId } as const;
}

/** The signed-in user's preview for this group, or null. */
export async function GET(req: Request) {
  const g = await gate(new URL(req.url).searchParams.get("groupId"));
  if ("res" in g) return g.res;

  const preview = await prisma.livePreview.findUnique({
    where: { groupId_userId: { groupId: g.groupId, userId: g.me.id } },
  });
  if (!preview || isFullyExpired(preview)) return NextResponse.json({ preview: null });
  return NextResponse.json({ preview: previewState(originOf(req), preview) });
}

/**
 * Make it live: snapshot the branch (+ drafts and the open file's unsaved
 * text) and (re)start the private link's 30-minute clock. A link that is still
 * live keeps its URL.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const g = await gate(body.groupId);
  if ("res" in g) return g.res;

  const unsaved =
    typeof body.unsaved?.path === "string" && typeof body.unsaved?.content === "string"
      ? { path: body.unsaved.path as string, content: body.unsaved.content as string }
      : undefined;

  await sweepExpiredPreviews().catch((e) => console.error("Preview sweep failed:", e));

  const branch = await resolveBranch(g.groupId, typeof body.branch === "string" ? body.branch : null);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PRIVATE_PREVIEW_MINUTES * 60_000);

  const existing = await prisma.livePreview.findUnique({
    where: { groupId_userId: { groupId: g.groupId, userId: g.me.id } },
  });
  const preview =
    existing ??
    (await prisma.livePreview.create({
      data: { groupId: g.groupId, userId: g.me.id, branch, rootDir: "", token: newToken(), expiresAt },
    }));

  try {
    const { rootDir } = await publishSnapshot({
      previewId: preview.id,
      groupId: g.groupId,
      userId: g.me.id,
      branch,
      unsaved,
    });
    const updated = await prisma.livePreview.update({
      where: { id: preview.id },
      data: {
        branch,
        rootDir,
        expiresAt,
        // An expired private link doesn't come back to life with the new deploy
        ...(existing && existing.expiresAt <= now ? { token: newToken() } : {}),
      },
    });
    return NextResponse.json({ preview: previewState(originOf(req), updated) });
  } catch (err) {
    if (!existing) {
      await deletePreviewObjects(preview.id).catch(() => {});
      await prisma.livePreview.delete({ where: { id: preview.id } }).catch(() => {});
    }
    if (err instanceof PreviewError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("Make it live failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't make the site live" },
      { status: 500 },
    );
  }
}

/** Auto-update on save: push one saved file into the live snapshot. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const g = await gate(body.groupId);
  if ("res" in g) return g.res;
  if (typeof body.path !== "string" || typeof body.content !== "string") {
    return NextResponse.json({ error: "path and content are required" }, { status: 400 });
  }

  const preview = await prisma.livePreview.findUnique({
    where: { groupId_userId: { groupId: g.groupId, userId: g.me.id } },
  });
  if (!preview || isFullyExpired(preview)) return NextResponse.json({ updated: false });

  const updated = await updateSnapshotFile(preview.id, preview.rootDir, body.path, body.content);
  return NextResponse.json({ updated });
}

/** Take the site down now, share link included. */
export async function DELETE(req: Request) {
  const g = await gate(new URL(req.url).searchParams.get("groupId"));
  if ("res" in g) return g.res;

  const preview = await prisma.livePreview.findUnique({
    where: { groupId_userId: { groupId: g.groupId, userId: g.me.id } },
  });
  if (preview) {
    await deletePreviewObjects(preview.id);
    await prisma.livePreview.delete({ where: { id: preview.id } });
  }
  return NextResponse.json({ ok: true });
}
