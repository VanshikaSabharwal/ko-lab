import { NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { getSessionUser, unauthorized, requireCodeAccess } from "../../lib/apiAuth";
import { writeDraft, draftContentFor } from "../../lib/draftStore";

export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { name, path, content, group, baseSha } = await req.json();

  // `content` must be a string but may be empty (a file can legitimately be
  // cleared). Only the draft metadata is stored here.
  if (!name || !path || typeof content !== "string" || !group) {
    return NextResponse.json(
      { Error: "Missing required fields" },
      { status: 400 },
    );
  }

  // Drafts are the input to a change request branch, so saving one requires the
  // same code access as submitting. Without this, any signed-in user could
  // write drafts into a group they have no access to.
  const gate = await requireCodeAccess(group, me.id);
  if (!gate.ok) return gate.res;

  try {
    // Content is written straight to the user's draft objects in S3/R2. The DB
    // row is metadata only, so write the store first: readers source text from
    // it, and a DB hiccup after a successful write still leaves the newest text
    // in place.
    await writeDraft(group, me.id, path, content);

    const modifiedFile = await prisma.modifiedFiles.upsert({
      where: {
        userId_groupId_path: {
          userId: me.id,
          groupId: group,
          path,
        },
      },
      update: {
        name,
        // Saving after a staged deletion cancels the deletion — the file is
        // back in the workspace with new content.
        deleted: false,
        updatedAt: new Date(),
        modifiedById: me.id,
        // baseSha intentionally omitted — keep the sha from the first save so
        // the CR branch stays anchored to what the author originally saw.
      },
      create: {
        name,
        path,
        content: null,
        userId: me.id,
        modifiedById: me.id,
        groupId: group,
        baseSha: baseSha ?? null,
      },
    });

    return NextResponse.json(modifiedFile, { status: 200 });
  } catch (error) {
    console.error("Error saving file: ", error);
    return NextResponse.json({ Error: "Failed to save file" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { searchParams } = new URL(req.url);
  const group = searchParams.get("group");

  if (!group) {
    return NextResponse.json({ Error: "Group required" }, { status: 400 });
  }

  try {
    const modifiedFiles = await prisma.modifiedFiles.findMany({
      where: {
        groupId: group,
        OR: [{ userId: me.id }, { group: { ownerId: me.id } }],
      },
      orderBy: { createdAt: "asc" },
    });

    // Hydrate the visible text from each author's draft clone (legacy DB rows
    // fall back to stored content). Deleted drafts have no content to show.
    const hydrated = await Promise.all(
      modifiedFiles.map(async (f) => ({
        ...f,
        content: f.deleted
          ? null
          : await draftContentFor(group, f.userId, f.path, f.content),
      })),
    );

    return NextResponse.json(hydrated, { status: 200 });
  } catch (error) {
    console.error("Error fetching files: ", error);
    return NextResponse.json(
      { Error: "Failed to fetch files" },
      { status: 500 },
    );
  }
}