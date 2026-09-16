import { NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";
import {
  requireGroupAccess,
  serializeMilestone,
  serializeTask,
  TASK_SELECT,
} from "../_shared";

/**
 * The whole planning board in one round trip: columns with their tasks, plus
 * the group's milestones. `groupId` is denormalized onto tasks so this needs no
 * join through columns.
 */
export async function GET(_req: Request, { params }: { params: { groupId: string } }) {
  const { groupId } = params;

  const access = await requireGroupAccess(groupId);
  if (access.error) return access.error;

  const [columns, milestones, dependencies] = await Promise.all([
    prisma.planningColumn.findMany({
      where: { groupId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        title: true,
        position: true,
        color: true,
        tasks: { orderBy: { position: "asc" }, select: TASK_SELECT },
      },
    }),
    prisma.planningMilestone.findMany({
      where: { groupId },
      orderBy: { dueDate: "asc" },
      select: { id: true, title: true, startDate: true, dueDate: true, done: true },
    }),
    // The Workflow view's arrows. Scoped by the denormalized groupId, so this
    // needs no join through either task.
    prisma.planningTaskDependency.findMany({
      where: { groupId },
      select: { id: true, blockerId: true, dependentId: true },
    }),
  ]);

  return NextResponse.json({
    columns: columns.map((c) => ({
      id: c.id,
      title: c.title,
      position: c.position,
      color: c.color,
      taskIds: c.tasks.map((t) => t.id),
    })),
    tasks: columns.flatMap((c) => c.tasks.map(serializeTask)),
    milestones: milestones.map(serializeMilestone),
    dependencies,
  });
}
