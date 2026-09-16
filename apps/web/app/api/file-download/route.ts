import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../lib/apiAuth";
import { NextResponse } from "next/server";
import { resolveBranch, readFileRawBuffer } from "../../lib/gitClient";
import { extensionOf } from "../../lib/githubFiles";

/**
 * Streams a file to the browser as an attachment (or for <img> preview).
 *
 * The browser can't talk to the git workspace service directly (it needs the
 * service-to-service bearer secret), so this route proxies the raw bytes from
 * it — keeping the GitHub token and the service secret server-side. `download`
 * attributes are also browser-ignored cross-origin, so bytes must come from
 * our own origin with Content-Disposition for the download link to work.
 *
 * GET rather than POST so the URL can be used directly as a link target.
 */
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("group");
  const filePath = searchParams.get("path");
  const ref = searchParams.get("ref");

  if (!groupId || !filePath) {
    return NextResponse.json(
      { error: "group and path are required" },
      { status: 400 },
    );
  }

  if (!(await isGroupMember(groupId, me.id))) {
    return forbidden("Not a member of this group");
  }

  const branch = await resolveBranch(groupId, ref);

  const buffer = await readFileRawBuffer(groupId, branch, filePath);

  const name = filePath.split("/").pop() || "download";
  // Quotes and backslashes would break out of the header's quoted string;
  // filename* carries the real UTF-8 name for anything non-ASCII.
  const asciiName = name.replace(/["\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": guessContentType(filePath),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(buffer.byteLength),
      // The URL carries a group id, not a token, but the bytes are private.
      "Cache-Control": "private, no-store",
    },
  });
}

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
  zip: "application/zip",
  json: "application/json",
};

function guessContentType(filePath: string): string {
  return CONTENT_TYPES[extensionOf(filePath)] ?? "application/octet-stream";
}