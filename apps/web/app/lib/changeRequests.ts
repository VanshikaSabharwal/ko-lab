import prisma from "./prisma";
import { getRepoContext } from "./vcs";
import { pushToUsers } from "./pushClient";

/**
 * Approving and rejecting change requests, shared by the review page's routes
 * (/api/vcs/merge, /api/vcs/reject) and the assistant, so both go through the
 * same owner check and the same GitHub steps.
 */

export type ChangeRequestOutcome =
  | { ok: true; status: "MERGED" | "REJECTED"; title: string }
  | { ok: false; httpStatus: number; error: string; status?: "CONFLICT" };

async function loadForReview(changeRequestId: string, actorId: string, verb: "merge" | "reject") {
  const cr = await prisma.changeRequest.findUnique({
    where: { id: changeRequestId },
    select: {
      id: true,
      groupId: true,
      branchName: true,
      prNumber: true,
      status: true,
      title: true,
      authorId: true,
      author: { select: { name: true } },
    },
  });
  if (!cr) return { error: { ok: false, httpStatus: 404, error: "Change request not found" } as const };

  const group = await prisma.group.findUnique({
    where: { id: cr.groupId },
    select: { ownerId: true, ownerName: true, groupName: true, githubRepo: true },
  });
  if (!group) return { error: { ok: false, httpStatus: 404, error: "Group not found" } as const };
  if (group.ownerId !== actorId) {
    return {
      error: {
        ok: false,
        httpStatus: 403,
        error: `Only the group owner can ${verb} change requests`,
      } as const,
    };
  }
  return { cr, group };
}

/** Squash-merge the PR, delete the branch, mark the CR MERGED. Owner only. */
export async function mergeChangeRequest(
  changeRequestId: string,
  actorId: string,
): Promise<ChangeRequestOutcome> {
  const loaded = await loadForReview(changeRequestId, actorId, "merge");
  if (loaded.error) return loaded.error;
  const { cr, group } = loaded;

  if (cr.status !== "OPEN" || !cr.prNumber) {
    return { ok: false, httpStatus: 400, error: `Change request is ${cr.status}, not mergeable` };
  }

  let ctx;
  try {
    ctx = await getRepoContext(cr.groupId);
  } catch (err: any) {
    return { ok: false, httpStatus: 502, error: `Couldn't reach the repo: ${err.message}` };
  }

  // GitHub computes mergeability asynchronously — confirm it's settled & true
  try {
    const { data: pr } = await ctx.octokit.rest.pulls.get({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: cr.prNumber,
    });
    if (pr.mergeable === false) {
      await prisma.changeRequest.update({ where: { id: cr.id }, data: { status: "CONFLICT" } });
      return {
        ok: false,
        httpStatus: 409,
        error: "This change request now conflicts with main and can't be merged.",
        status: "CONFLICT",
      };
    }
  } catch {
    /* if we can't read it, let the merge attempt surface the error */
  }

  try {
    await ctx.octokit.rest.pulls.merge({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: cr.prNumber,
      merge_method: "squash",
    });
  } catch (err: any) {
    if (err.status === 405 || err.status === 409) {
      await prisma.changeRequest.update({ where: { id: cr.id }, data: { status: "CONFLICT" } });
      return {
        ok: false,
        httpStatus: 409,
        error: "GitHub refused the merge (likely a conflict).",
        status: "CONFLICT",
      };
    }
    return { ok: false, httpStatus: 502, error: err.message || "Merge failed" };
  }

  // Delete the merged branch (best-effort)
  await ctx.octokit.rest.git
    .deleteRef({ owner: ctx.owner, repo: ctx.repo, ref: `heads/${cr.branchName}` })
    .catch(() => {});

  await prisma.changeRequest.update({ where: { id: cr.id }, data: { status: "MERGED" } });

  // Rejections already reached the author (via RejectedCr); approvals were
  // silent, so the author only found out by looking.
  if (cr.authorId !== actorId) {
    const message = `Your change request "${cr.title}" was merged into ${group.groupName}`;
    try {
      await prisma.notifications.create({
        data: {
          recipientId: cr.authorId,
          type: "CR_MERGED",
          userId: actorId,
          userName: group.ownerName,
          groupId: cr.groupId,
          ownerId: group.ownerId,
          ownerName: group.ownerName,
          groupName: group.groupName,
          message,
        },
      });
      await pushToUsers([cr.authorId], {
        type: "notification",
        notificationType: "CR_MERGED",
        groupId: cr.groupId,
        groupName: group.groupName,
        message,
      });
    } catch (error) {
      // The merge already happened; a missing notification mustn't undo that
      console.error("Failed to notify CR author of merge:", error);
    }
  }

  return { ok: true, status: "MERGED", title: cr.title };
}

/** Close the PR, delete the branch, mark REJECTED, and tell the author. Owner only. */
export async function rejectChangeRequest(
  changeRequestId: string,
  actorId: string,
  reason?: string,
): Promise<ChangeRequestOutcome> {
  const loaded = await loadForReview(changeRequestId, actorId, "reject");
  if (loaded.error) return loaded.error;
  const { cr, group } = loaded;

  if (cr.status === "MERGED") {
    return { ok: false, httpStatus: 400, error: "Already merged" };
  }

  try {
    const ctx = await getRepoContext(cr.groupId);
    // Close the PR if one is open
    if (cr.prNumber) {
      await ctx.octokit.rest.pulls
        .update({ owner: ctx.owner, repo: ctx.repo, pull_number: cr.prNumber, state: "closed" })
        .catch(() => {});
    }
    // Delete the branch
    await ctx.octokit.rest.git
      .deleteRef({ owner: ctx.owner, repo: ctx.repo, ref: `heads/${cr.branchName}` })
      .catch(() => {});
  } catch (err: any) {
    // Non-fatal — still mark rejected in our DB
    console.error("Reject cleanup failed:", err.message);
  }

  await prisma.changeRequest.update({ where: { id: cr.id }, data: { status: "REJECTED" } });

  // Notify the author via the existing rejectedCr table
  await prisma.rejectedCr.create({
    data: {
      userId: cr.authorId,
      groupId: cr.groupId,
      groupName: group.githubRepo,
      userName: cr.author.name || "",
      message: reason?.trim() || `Your change request "${cr.title}" was rejected.`,
      createdAt: new Date(),
    },
  });

  return { ok: true, status: "REJECTED", title: cr.title };
}
