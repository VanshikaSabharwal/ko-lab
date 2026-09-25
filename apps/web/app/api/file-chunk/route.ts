import { NextResponse } from "next/server";
import { getSessionUser, unauthorized } from "../../lib/apiAuth";
import { resolveRepoAccess, safeContentsPath, CHUNK_SIZE } from "../../lib/githubFiles";

/**
 * Serves one byte range of a file, for the virtualized large-file viewer.
 *
 * GitHub's Contents API honours HTTP Range when asked for raw media
 * (verified: it answers 206 with accept-ranges/content-range), so a 40 MB log
 * can be read a screen at a time instead of being pulled down whole. This is
 * what makes viewing large files possible at all — the Blobs API has no
 * partial-read mode, it returns the entire base64 blob or nothing.
 *
 * Ranges are byte offsets, not line numbers: line numbers can't be known
 * without reading everything before them, which is the cost being avoided. The
 * client works in bytes and this route snaps the returned text to newline
 * boundaries so no chunk starts or ends mid-line.
 */

/** Hard cap per request, so a crafted `length` can't pull the whole file. */
const MAX_CHUNK = CHUNK_SIZE * 4;

export async function POST(req: Request) {
  try {
    const me = await getSessionUser();
    if (!me) return unauthorized();

    const { groupId, filePath, ref, start, length } = await req.json();

    if (!groupId || !filePath || typeof start !== "number") {
      return NextResponse.json(
        { error: "groupId, filePath and start are required" },
        { status: 400 },
      );
    }

    const contentsPath = safeContentsPath(filePath);
    if (!contentsPath) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    const offset = Math.max(0, Math.floor(start));
    const size = Math.min(
      Math.max(1, Math.floor(length ?? CHUNK_SIZE)),
      MAX_CHUNK,
    );

    const resolved = await resolveRepoAccess(groupId, me.id);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { base, headers } = resolved.access;

    const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const end = offset + size - 1;

    const res = await fetch(`${base}/contents/${contentsPath}${refQuery}`, {
      headers: {
        ...headers,
        // Raw bytes, not the JSON envelope — the envelope can't be ranged
        // meaningfully since it's base64 of the whole file.
        Accept: "application/vnd.github.raw",
        Range: `bytes=${offset}-${end}`,
      },
    });

    // 206 = range honoured. 200 = server ignored Range and sent everything,
    // which is correct but wasteful; slice it so behaviour stays identical.
    if (res.status !== 206 && res.status !== 200) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        { error: body || res.statusText || "Failed to fetch chunk" },
        { status: res.status },
      );
    }

    const full = Buffer.from(await res.arrayBuffer());
    const buf = res.status === 200 ? full.subarray(offset, offset + size) : full;

    // Total size comes from Content-Range ("bytes 0-255/40000000") when the
    // range was honoured, else from the length actually delivered.
    const contentRange = res.headers.get("content-range");
    const total = contentRange
      ? Number(contentRange.split("/")[1]) || full.length
      : full.length;

    const chunkStart = offset;
    const chunkEnd = chunkStart + buf.length;

    // Trim partial lines at both edges so the viewer never renders half a line.
    // The offsets of what's kept are reported back, letting the client stitch
    // neighbouring chunks together without overlap or gaps.
    let sliceFrom = 0;
    let sliceTo = buf.length;

    if (chunkStart > 0) {
      const nl = buf.indexOf(0x0a);
      // No newline in the whole chunk means one very long line; keep it rather
      // than returning nothing.
      sliceFrom = nl === -1 ? 0 : nl + 1;
    }
    if (chunkEnd < total) {
      const nl = buf.lastIndexOf(0x0a);
      if (nl !== -1 && nl + 1 > sliceFrom) sliceTo = nl + 1;
    }

    const text = buf.subarray(sliceFrom, sliceTo).toString("utf-8");

    return NextResponse.json(
      {
        text,
        // Byte range the returned text actually covers.
        start: chunkStart + sliceFrom,
        end: chunkStart + sliceTo,
        total,
        // False when the server ignored Range — the client uses this to stop
        // requesting chunks it would only have to slice locally.
        ranged: res.status === 206,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("Error fetching file chunk: ", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch chunk" },
      { status: 500 },
    );
  }
}
