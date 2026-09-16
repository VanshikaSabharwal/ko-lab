import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "../../../../../../lib/prisma";
import {
  assertColumnInGroup,
  assertMilestoneInGroup,
  assertTaskInGroup,
  badRequest,
  filterToGroupMembers,
  isoDate,
  notFound,
  priorityEnum,
  requireGroupAccess,
  serializeTask,
  toDate,
  toISO,
  TASK_SELECT,
} from "../../_shared";

// Nullable fields distinguish "leave alone" (absent) from "clear" (null).
const patchTask = z
  .object({
    title: z.string().max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    columnId: z.string().min(1).optional(),
    position: z.number().int().optional(),
    startDate: isoDate.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    color: z.string().max(32).nullable().optional(),
    priority: priorityEnum.nullable().optional(),
    milestoneId: z.string().nullable().optional(),
    assigneeIds: z.array(z.string()).max(20).optional(),
    // Workflow canvas position. Finite-checked because JSON allows NaN through
    // some clients, and a NaN coordinate renders a node at an unreachable spot.
    flowX: z.number().finite().nullable().optional(),
    flowY: z.number().finite().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

type Params = { params: { groupId: string; taskId: string } };

export async function PATCH(req: Request, { params }: Params) {
  const { groupId, taskId } = params;

  const access = await requireGroupAccess(groupId);
  if (access.error) return access.error;

  if (!(await assertTaskInGroup(taskId, groupId))) return notFound("Task not found");

  const parsed = patchTask.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.errors);
  const body = parsed.data;

  // Moving between columns and reordering both land here, so one drag is one
  // request rather than a delete plus a create.
  if (body.columnId && !(await assertColumnInGroup(body.columnId, groupId))) {
    return notFound("Column not found");
  }
  if (body.milestoneId && !(await assertMilestoneInGroup(body.milestoneId, groupId))) {
    return notFound("Milestone not found");
  }

  // Validate the resulting range, not just the incoming fields — moving only
  // one end could otherwise leave a bar that ends before it starts.
  const current = await prisma.planningTask.findUnique({
    where: { id: taskId },
    select: { startDate: true, dueDate: true },
  });
  const nextStart =
    body.startDate === undefined ? toISO(current?.startDate ?? null) : body.startDate;
  const nextDue = body.dueDate === undefined ? toISO(current?.dueDate ?? null) : body.dueDate;
  if (nextStart && nextDue && nextStart > nextDue) {
    return badRequest("startDate must be on or before dueDate");
  }

  const task = await prisma.$transaction(async (tx) => {
    if (body.assigneeIds) {
      const allowed = await filterToGroupMembers(groupId, body.assigneeIds);
      // Replace the set wholesale — simpler than diffing, and the set is small.
      await tx.planningAssignee.deleteMany({ where: { taskId } });
      if (allowed.length) {
        await tx.planningAssignee.createMany({
          data: allowed.map((userId) => ({ taskId, userId })),
        });
      }
    }

    return tx.planningTask.update({
      where: { id: taskId },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.columnId !== undefined && { columnId: body.columnId }),
        ...(body.position !== undefined && { position: body.position }),
        ...(body.startDate !== undefined && {
          startDate: body.startDate ? toDate(body.startDate) : null,
        }),
        ...(body.dueDate !== undefined && {
          dueDate: body.dueDate ? toDate(body.dueDate) : null,
        }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.milestoneId !== undefined && { milestoneId: body.milestoneId }),
        ...(body.flowX !== undefined && { flowX: body.flowX }),
        ...(body.flowY !== undefined && { flowY: body.flowY }),
      },
      select: TASK_SELECT,
    });
  });

  return NextResponse.json(serializeTask(task));
}

export async function DELETE(_req: Request, { params }: Params) {
  const { groupId, taskId } = params;

  const access = await requireGroupAccess(groupId);
  if (access.error) return access.error;

  if (!(await assertTaskInGroup(taskId, groupId))) return notFound("Task not found");

  // Assignees cascade with the task.
  await prisma.planningTask.delete({ where: { id: taskId } });

  return NextResponse.json({ id: taskId });
}
