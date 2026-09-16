import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "../../../../../lib/prisma";
import {
  assertTaskInGroup,
  badRequest,
  notFound,
  requireGroupAccess,
  wouldCreateCycle,
  type SerializedDependency,
} from "../_shared";

/**
 * Task dependencies — the arrows in the Workflow view. "blocker must finish
 * before dependent starts".
 *
 * A join table rather than a column on PlanningTask, because a task can have
 * several blockers and block several others.
 */

const edgeBody = z.object({
  blockerId: z.string().min(1),
  dependentId: z.string().min(1),
});

function serialize(row: {
  id: string;
  blockerId: string;
  dependentId: string;
}): SerializedDependency {
  return { id: row.id, blockerId: row.blockerId, dependentId: row.dependentId };
}

type Params = { params: { groupId: string } };

export async function POST(req: Request, { params }: Params) {
  const { groupId } = params;

  const access = await requireGroupAccess(groupId);
  if (access.error) return access.error;

  const parsed = edgeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.errors);
  const { blockerId, dependentId } = parsed.data;

  if (blockerId === dependentId) {
    return badRequest("A task can't depend on itself");
  }

  // Both endpoints must belong to the group in the URL. The row carries its own
  // `groupId`, but nothing in the schema ties that column to the two tasks it
  // links — so without this check a member of group A could pass A's groupId
  // with two of group B's task ids and edit B's graph. groupId is taken from
  // the URL we just authorized, never from the body.
  const [blocker, dependent] = await Promise.all([
    assertTaskInGroup(blockerId, groupId),
    assertTaskInGroup(dependentId, groupId),
  ]);
  if (!blocker || !dependent) return notFound("Task not found");

  const existing = await prisma.planningTaskDependency.findMany({
    where: { groupId },
    select: { blockerId: true, dependentId: true },
  });

  if (wouldCreateCycle(existing, blockerId, dependentId)) {
    return badRequest("That would create a circular dependency");
  }

  // The unique index makes a repeat POST a no-op rather than a duplicate row;
  // upsert keeps it idempotent instead of surfacing a P2002 as a 500.
  const row = await prisma.planningTaskDependency.upsert({
    where: { blockerId_dependentId: { blockerId, dependentId } },
    create: { groupId, blockerId, dependentId },
    update: {},
    select: { id: true, blockerId: true, dependentId: true },
  });

  return NextResponse.json(serialize(row));
}

export async function DELETE(req: Request, { params }: Params) {
  const { groupId } = params;

  const access = await requireGroupAccess(groupId);
  if (access.error) return access.error;

  const url = new URL(req.url);
  const parsed = edgeBody.safeParse({
    blockerId: url.searchParams.get("blockerId") ?? "",
    dependentId: url.searchParams.get("dependentId") ?? "",
  });
  if (!parsed.success) return badRequest(parsed.error.errors);
  const { blockerId, dependentId } = parsed.data;

  // Scoped by groupId as well as the pair, so a caller can only delete edges
  // on their own board even if they know another group's task ids.
  const result = await prisma.planningTaskDependency.deleteMany({
    where: { groupId, blockerId, dependentId },
  });
  if (result.count === 0) return notFound("Dependency not found");

  return NextResponse.json({ blockerId, dependentId });
}
