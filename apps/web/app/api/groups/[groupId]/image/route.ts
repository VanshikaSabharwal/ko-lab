import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { getSessionUser, unauthorized, forbidden } from "../../../../lib/apiAuth";
import { uploadGroupImage, ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "../../../../lib/s3";

/**
 * The group's photo. Like the rest of the group's details, only the owner can
 * change it; members just see it.
 */

type Params = { params: { groupId: string } };

async function requireOwner(groupId: string) {
  const me = await getSessionUser();
  if (!me) return { error: unauthorized() };

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ownerId: true },
  });
  if (!group) {
    return { error: NextResponse.json({ error: "Group not found" }, { status: 404 }) };
  }
  if (group.ownerId !== me.id) {
    return { error: forbidden("Only the group owner can change the group photo") };
  }
  return { error: null };
}

export async function POST(req: NextRequest, { params }: Params) {
  const { groupId } = params;
  const { error } = await requireOwner(groupId);
  if (error) return error;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use PNG, JPEG, or WebP." },
      { status: 400 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "File too large. Max 5MB." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const image = await uploadGroupImage(groupId, buffer, file.type);

    await prisma.group.update({
      where: { id: groupId },
      data: { image },
    });

    return NextResponse.json({ image });
  } catch (err) {
    console.error("Group image upload failed:", err);
    return NextResponse.json({ error: "Failed to upload group photo" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { groupId } = params;
  const { error } = await requireOwner(groupId);
  if (error) return error;

  await prisma.group.update({
    where: { id: groupId },
    data: { image: null },
  });

  return NextResponse.json({ image: null });
}
