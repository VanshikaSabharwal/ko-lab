import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { getSessionUser, unauthorized, forbidden, requireCodeAccess } from "../../../lib/apiAuth";
import { getRepoContext, resolveAuthor } from "../../../lib/vcs";
import { commitResolution, findConflicts, ResolveError, type Resolution } from "../../../lib/changeRequestConflicts";
import { deleteDraft, draftContentFor } from "../../../lib/draftStore";

// Resolving a change request that conflicts with main.
//   GET  ?changeRequestId=…  → what conflicts, line by line
//   POST { changeRequestId, seen, resolutions } → commit the decisions
// The author resolves their own change request; the owner may resolve any.

type CrFile = { path: string; content?: string | null; deleted?: boolean };

async function loadCr(changeRequestId: string | null, userId: string) {
  if (!changeRequestId) {
    return { error: NextResponse.json({ error: "changeRequestId is required" }, { status: 400 }) };
  }
  const cr = await prisma.changeRequest.findUnique({
    where: { id: changeRequestId },
    select: {
      id: true,
      groupId: true,
      authorId: true,
      title: true,
      branchName: true,
      prNumber: true,
      status: true,
      files: true,
      group: { select: { ownerId: true } },
    },
  });
  if (!cr) return { error: NextResponse.json({ error: "Change request not found" }, { status: 404 }) };

  const isOwner = cr.group.ownerId === userId;
  if (!isOwner) {
    if (cr.authorId !== userId) return { error: forbidden("Only the author or the group owner can resolve this") };
    // An author who has since lost code access can't push to the branch
    const gate = await requireCodeAccess(cr.groupId, userId);
    if (!gate.ok) return { error: gate.res };
  }
  if (cr.status !== "CONFLICT") {
    return {
      error: NextResponse.json(
        { error: `This change request is ${cr.status.toLowerCase()}, not in conflict` },
        { status: 400 },
      ),
    };
  }
  return { cr };
}

function failure(err: unknown, fallback: string) {
  if (err instanceof ResolveError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error(fallback, err);
  return NextResponse.json({ error: (err as Error)?.message || fallback }, { status: 502 });
}

export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const loaded = await loadCr(new URL(req.url).searchParams.get("changeRequestId"), me.id);
  if (loaded.error) return loaded.error;
  const { cr } = loaded;

  try {
    const ctx = await getRepoContext(cr.groupId);
    const report = await findConflicts(ctx, cr.branchName);
    return NextResponse.json({ title: cr.title, branchName: cr.branchName, ...report });
  } catch (err) {
    return failure(err, "Couldn't work out the conflicts");
  }
}

export async function POST(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const loaded = await loadCr(body.changeRequestId ?? null, me.id);
  if (loaded.error) return loaded.error;
  const { cr } = loaded;

  const seen = body.seen;
  const resolutions = body.resolutions as Resolution[] | undefined;
  if (!seen?.branchHead || !seen?.mainHead || !Array.isArray(resolutions)) {
    return NextResponse.json({ error: "seen and resolutions are required" }, { status: 400 });
  }

  try {
    const ctx = await getRepoContext(cr.groupId);
    const author = await resolveAuthor(me.id);
    const result = await commitResolution({
      ctx,
      branchName: cr.branchName,
      seen,
      resolutions,
      author: { name: author.name, email: author.email },
      authorToken: author.token,
    });

    // A conflict found at submission never got a pull request: open it now
    let prNumber = cr.prNumber;
    let prUrl: string | null = null;
    if (!prNumber) {
      const pr = await ctx.octokit.rest.pulls.create({
        owner: ctx.owner,
        repo: ctx.repo,
        base: ctx.defaultBranch,
        head: cr.branchName,
        title: cr.title,
        body: `Change request by **${author.name}** via Ko-Lab (conflicts resolved in Ko-Lab).`,
      });
      prNumber = pr.data.number;
      prUrl = pr.data.html_url;
    }

    // The review screen's copy of the files shows what will now be merged
    const files = ((cr.files as CrFile[] | null) ?? []).map((f) => {
      const settled = result.resolved.find((r) => r.path === f.path);
      return settled ? { path: f.path, content: settled.content, deleted: settled.content === null } : f;
    });

    await prisma.changeRequest.update({
      where: { id: cr.id },
      data: {
        status: "OPEN",
        baseSha: result.mainHead,
        files,
        ...(prUrl ? { prNumber, prUrl } : {}),
      },
    });

    await releaseSubmittedDrafts(cr.groupId, cr.authorId, (cr.files as CrFile[] | null) ?? []);

    return NextResponse.json({ status: "OPEN", prNumber, prUrl, commitSha: result.commitSha });
  } catch (err) {
    return failure(err, "Couldn't save the resolution");
  }
}

/**
 * A change request that conflicted when it was submitted left the author's
 * drafts in place (there was no pull request to hold them yet). Now it's open,
 * clear the drafts it carried, but only those still exactly as submitted: an
 * edit made since is new work, not part of this change request.
 */
async function releaseSubmittedDrafts(groupId: string, authorId: string, submitted: CrFile[]) {
  const rows = await prisma.modifiedFiles.findMany({
    where: { groupId, userId: authorId, path: { in: submitted.map((f) => f.path) } },
    select: { id: true, path: true, content: true, deleted: true },
  });
  for (const row of rows) {
    const sent = submitted.find((f) => f.path === row.path)!;
    const unchanged = row.deleted
      ? !!sent.deleted
      : !sent.deleted && (await draftContentFor(groupId, authorId, row.path, row.content)) === sent.content;
    if (!unchanged) continue;
    await prisma.modifiedFiles.delete({ where: { id: row.id } });
    await deleteDraft(groupId, authorId, row.path).catch(() => {});
  }
}
