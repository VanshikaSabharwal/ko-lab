import { NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { getSessionUser, unauthorized, requireCodeAccess } from "../../lib/apiAuth";
import { getDefaultHeadSha } from "../../lib/vcs";
import { resolveBranch } from "../../lib/gitClient";
import { deleteDraft, restoreDraft } from "../../lib/draftStore";

/**
 * Stage a file deletion.
 *
 * Nothing is removed from GitHub here. The deletion is recorded as a draft, so
 * it travels through the same change-request review as any edit and only takes
 * effect when an admin merges the CR. That keeps a destructive action
 * reviewable and revertable, and matches how every other change in the editor
 * already works.
 */
export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { name, path, group } = await req.json();
  if (!name || !path || !group) {
    return NextResponse.json({ error: "name, path and group are required" }, { status: 400 });
  }

  // Same gate as saving a draft — staging a deletion is an edit.
  const gate = await requireCodeAccess(group, me.id);
  if (!gate.ok) return gate.res;

  try {
    // Anchor the CR branch to the sha the author was looking at, matching the
    // save path. Only set on first write; an existing draft keeps its own.
    let baseSha: string | null = null;
    try {
      baseSha = (await getDefaultHeadSha(group)).headSha;
    } catch {
      // A missing sha isn't fatal — the CR flow falls back to the branch head.
    }

    // Drop the file from the user's draft clone so previews stop showing it.
    await deleteDraft(group, me.id, path);

    const staged = await prisma.modifiedFiles.upsert({
      where: { userId_groupId_path: { userId: me.id, groupId: group, path } },
      update: {
        deleted: true,
        content: null,
        updatedAt: new Date(),
        modifiedById: me.id,
      },
      create: {
        name,
        path,
        content: null,
        deleted: true,
        userId: me.id,
        groupId: group,
        modifiedById: me.id,
        baseSha,
      },
      select: { id: true, path: true, deleted: true },
    });

    return NextResponse.json({ staged }, { status: 201 });
  } catch (error) {
    console.error("Stage delete error:", error);
    return NextResponse.json({ error: "Failed to stage the deletion" }, { status: 500 });
  }
}

/** Un-stage a deletion the author changed their mind about. */
export async function DELETE(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { path, group } = await req.json();
  if (!path || !group) {
    return NextResponse.json({ error: "path and group are required" }, { status: 400 });
  }

  const gate = await requireCodeAccess(group, me.id);
  if (!gate.ok) return gate.res;

  // Put the original back into the draft clone so the draft workspace mirrors
  // the DB again.
  const branch = await resolveBranch(group);
  await restoreDraft(group, me.id, branch, path);

  // Only drop the row if it is a staged deletion — an edit draft at the same
  // path is real work and must not be discarded by an undo of something else.
  await prisma.modifiedFiles.deleteMany({
    where: { userId: me.id, groupId: group, path, deleted: true },
  });

  return NextResponse.json({ restored: true });
}