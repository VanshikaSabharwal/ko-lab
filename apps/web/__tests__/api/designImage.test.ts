// @vitest-environment node
// Under jsdom, Request.formData() hands back Node's File while the global File
// is jsdom's, so the route's `instanceof File` check would never match.
/**
 * Picture upload for the UI/UX design board.
 *
 * Any group member may upload (the same people who can edit the board), held
 * to the same type/size rules as profile and group photos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({ default: {} }));

vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(),
  isGroupMember: vi.fn(),
  unauthorized: () => new Response(null, { status: 401 }),
  forbidden: (message: string) =>
    new Response(JSON.stringify({ error: message }), { status: 403 }),
}));

vi.mock("../../app/lib/s3", () => ({
  uploadDesignImage: vi.fn(),
  ALLOWED_IMAGE_TYPES: ["image/png", "image/jpeg", "image/webp"],
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
}));

import { POST } from "../../app/api/workspace/[groupId]/design-image/route";
import { getSessionUser, isGroupMember } from "../../app/lib/apiAuth";
import { uploadDesignImage } from "../../app/lib/s3";

const params = { params: { groupId: "g1" } };
const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function upload(file?: File) {
  const form = new FormData();
  if (file) form.append("file", file);
  return POST(
    new Request("http://localhost/api/workspace/g1/design-image", { method: "POST", body: form }) as any,
    params,
  );
}

const png = (bytes = 10) => new File([new Uint8Array(bytes)], "hero.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  mocked(getSessionUser).mockResolvedValue({ id: "member" });
  mocked(isGroupMember).mockResolvedValue(true);
  mocked(uploadDesignImage).mockResolvedValue("https://cdn.example/design-images/g1/x.png");
});

describe("POST /api/workspace/[groupId]/design-image", () => {
  it("uploads the picture under the group and returns its URL", async () => {
    const res = await upload(png());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://cdn.example/design-images/g1/x.png" });
    expect(mocked(uploadDesignImage).mock.calls[0]![0]).toBe("g1");
    expect(mocked(uploadDesignImage).mock.calls[0]![2]).toBe("image/png");
  });

  it("rejects an anonymous caller", async () => {
    mocked(getSessionUser).mockResolvedValue(null);
    const res = await upload(png());
    expect(res.status).toBe(401);
    expect(uploadDesignImage).not.toHaveBeenCalled();
  });

  it("rejects someone who isn't in the group", async () => {
    mocked(isGroupMember).mockResolvedValue(false);
    const res = await upload(png());
    expect(res.status).toBe(403);
    expect(uploadDesignImage).not.toHaveBeenCalled();
  });

  it("rejects a request with no file", async () => {
    const res = await upload();
    expect(res.status).toBe(400);
  });

  it("rejects non-image files", async () => {
    const res = await upload(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
    expect(res.status).toBe(400);
    expect(uploadDesignImage).not.toHaveBeenCalled();
  });

  it("rejects files over 5 MB", async () => {
    const res = await upload(png(5 * 1024 * 1024 + 1));
    expect(res.status).toBe(400);
    expect(uploadDesignImage).not.toHaveBeenCalled();
  });

  it("reports a storage failure", async () => {
    mocked(uploadDesignImage).mockRejectedValue(new Error("bucket down"));
    const res = await upload(png());
    expect(res.status).toBe(500);
  });
});
