/**
 * Photo uploads against real (LocalStack) storage.
 *
 * The API tests replace storage with a stand-in that always succeeds, so they
 * can't notice a link that points at the wrong place. Here each upload is
 * fetched back through the URL the app handed out.
 */
import { describe, it, expect } from "vitest";
import { uploadAvatar, uploadGroupImage, uploadDesignImage } from "../../app/lib/s3";
import { ENDPOINT, IMAGE_BUCKET } from "./config";

// A real 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function download(url: string) {
  const res = await fetch(url);
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    bytes: Buffer.from(await res.arrayBuffer()),
  };
}

describe("image uploads", () => {
  it.each([
    ["profile photo", uploadAvatar, "avatars/user-1/"],
    ["group photo", uploadGroupImage, "group-images/user-1/"],
    ["design-board picture", uploadDesignImage, "design-images/user-1/"],
  ] as const)("a %s can be loaded back from its link, unchanged", async (_name, upload, folder) => {
    const url = await upload("user-1", PNG, "image/png");

    expect(url.startsWith(`${ENDPOINT}/${IMAGE_BUCKET}/${folder}`)).toBe(true);
    expect(url.endsWith(".png")).toBe(true);

    const got = await download(url);
    expect(got.status).toBe(200);
    expect(got.type).toBe("image/png");
    expect(got.bytes.equals(PNG)).toBe(true);
  });

  it("gives each file type its own extension and content type", async () => {
    const jpg = await uploadAvatar("user-2", Buffer.from("jpeg-bytes"), "image/jpeg");
    const webp = await uploadAvatar("user-2", Buffer.from("webp-bytes"), "image/webp");

    expect(jpg.endsWith(".jpg")).toBe(true);
    expect(webp.endsWith(".webp")).toBe(true);
    expect((await download(jpg)).type).toBe("image/jpeg");
    expect((await download(webp)).type).toBe("image/webp");
  });

  it("keeps the old photo reachable when a new one is uploaded", async () => {
    // Each upload gets a fresh name, so a link already saved elsewhere (an
    // open chat, a design board) doesn't break or silently change.
    const first = await uploadAvatar("user-3", Buffer.from("first"), "image/png");
    const second = await uploadAvatar("user-3", Buffer.from("second"), "image/png");

    expect(second).not.toBe(first);
    expect((await download(first)).bytes.toString()).toBe("first");
    expect((await download(second)).bytes.toString()).toBe("second");
  });
});
