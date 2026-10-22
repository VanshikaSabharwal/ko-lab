import { NextRequest, NextResponse } from "next/server";
import { requireGroupAccess } from "../planning/_shared";
import { uploadDesignImage, ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "../../../../lib/s3";

/**
 * Upload a picture for an Image element on the UI/UX design board. Any group
 * member can, the same people who can edit the board. Returns the URL; the
 * board stores it on the element, so it syncs and saves like any other change.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { groupId: string } },
) {
  const { groupId } = params;
  const access = await requireGroupAccess(groupId);
  if (access.error) return access.error;

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
    const url = await uploadDesignImage(groupId, buffer, file.type);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("Design image upload failed:", err);
    return NextResponse.json({ error: "Failed to upload the image" }, { status: 500 });
  }
}
