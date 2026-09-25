// @vitest-environment node
// Under jsdom, Request.formData() hands back Node's File while the global File
// is jsdom's, so the route's `instanceof File` check would never match.
/**
 * Group photo upload.
 *
 * Only the owner may change it, matching the rest of the group's details, and
 * uploads are held to the same type/size rules as profile photos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: { group: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(),
  unauthorized: () => new Response(null, { status: 401 }),
  forbidden: (message: string) =>
    new Response(JSON.stringify({ error: message }), { status: 403 }),
}));

vi.mock("../../app/lib/s3", () => ({
  uploadGroupImage: vi.fn(),
  ALLOWED_IMAGE_TYPES: ["image/png", "image/jpeg", "image/webp"],
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
}));

import { POST, DELETE } from "../../app/api/groups/[groupId]/image/route";
import prisma from "../../app/lib/prisma";
import { getSessionUser } from "../../app/lib/apiAuth";
import { uploadGroupImage } from "../../app/lib/s3";

const params = { params: { groupId: "g1" } };
const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function upload(file?: File) {
  const form = new FormData();
  if (file) form.append("file", file);
  return POST(
    new Request("http://localhost/api/groups/g1/image", { method: "POST", body: form }) as any,
    params,
  );
}

const png = (bytes = 10) => new File([new Uint8Array(bytes)], "photo.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  mocked(getSessionUser).mockResolvedValue({ id: "owner" });
  mocked(prisma.group.findUnique).mockResolvedValue({ ownerId: "owner" });
  mocked(uploadGroupImage).mockResolvedValue("https://cdn.example/group-images/g1/x.png");
});

describe("POST /api/groups/[groupId]/image", () => {
  it("uploads the photo and saves its URL on the group", async () => {
    const res = await upload(png());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: "https://cdn.example/group-images/g1/x.png" });
    expect(uploadGroupImage).toHaveBeenCalledWith("g1", expect.any(Buffer), "image/png");
    expect(prisma.group.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { image: "https://cdn.example/group-images/g1/x.png" },
    });
  });

  it("refuses members who aren't the owner", async () => {
    mocked(getSessionUser).mockResolvedValue({ id: "member" });

    expect((await upload(png())).status).toBe(403);
    expect(uploadGroupImage).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types", async () => {
    const gif = new File([new Uint8Array(10)], "a.gif", { type: "image/gif" });

    expect((await upload(gif)).status).toBe(400);
    expect(uploadGroupImage).not.toHaveBeenCalled();
  });

  it("rejects files over 5MB", async () => {
    expect((await upload(png(5 * 1024 * 1024 + 1))).status).toBe(400);
    expect(uploadGroupImage).not.toHaveBeenCalled();
  });

  it("404s for a group that doesn't exist", async () => {
    mocked(prisma.group.findUnique).mockResolvedValue(null);

    expect((await upload(png())).status).toBe(404);
  });
});

describe("DELETE /api/groups/[groupId]/image", () => {
  it("clears the owner's group photo", async () => {
    const res = await DELETE(new Request("http://localhost") as any, params);

    expect(res.status).toBe(200);
    expect(prisma.group.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { image: null },
    });
  });

  it("refuses members who aren't the owner", async () => {
    mocked(getSessionUser).mockResolvedValue({ id: "member" });

    expect((await DELETE(new Request("http://localhost") as any, params)).status).toBe(403);
    expect(prisma.group.update).not.toHaveBeenCalled();
  });
});
