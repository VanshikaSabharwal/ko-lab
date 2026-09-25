import { NextResponse } from "next/server";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../lib/apiAuth";
import { resolveBranch } from "../../lib/gitClient";
import { collectWorkspaceFiles } from "../../lib/workspaceFiles";

// Files for the in-browser terminal (WebContainer): the branch plus the
// caller's drafts. One request instead of one per file, because the API rate
// limit (120/min) would stall a mid-sized repo. Files past the inline budget
// are listed without content and fetched one by one with ?path=, keeping the
// response under Vercel's body limit.

export const maxDuration = 60;

const INLINE_BUDGET_BYTES = 3 * 1024 * 1024;
const MAX_FILES = 3_000;
const CONCURRENCY = 8;

/** Never mounted: installed fresh by npm inside the container. */
const skip = (path: string) => path.split("/").includes("node_modules");

export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  if (!(await isGroupMember(groupId, me.id))) return forbidden("Not a member of this group");

  try {
    const branch = await resolveBranch(groupId, searchParams.get("branch"));
    const files = (await collectWorkspaceFiles({ groupId, userId: me.id, branch })).filter(
      (f) => !skip(f.path),
    );

    const single = searchParams.get("path");
    if (single) {
      const file = files.find((f) => f.path === single);
      if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });
      return new Response(new Uint8Array(await file.read()), {
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" },
      });
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `This repo has ${files.length} files, more than the terminal can load (${MAX_FILES}).` },
        { status: 413 },
      );
    }

    // Smallest first, so the budget covers as many files as possible
    const queue = [...files].sort((a, b) => a.size - b.size);
    const out: { path: string; base64?: string }[] = [];
    let budget = INLINE_BUDGET_BYTES;
    const work = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        if (f.size > budget) {
          out.push({ path: f.path });
          continue;
        }
        budget -= f.size;
        const bytes = await f.read();
        out.push({ path: f.path, base64: bytes.toString("base64") });
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));

    return NextResponse.json({ branch, files: out }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("Workspace snapshot failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load the project files" },
      { status: 500 },
    );
  }
}
