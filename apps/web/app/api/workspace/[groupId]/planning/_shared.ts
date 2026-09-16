import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "../../../../lib/prisma";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../../../lib/apiAuth";

/**
 * Shared pieces for the planning routes: one auth guard, one serializer, and
 * the position arithmetic — so ordering and date handling can't drift between
 * endpoints.
 */

export const POSITION_STEP = 1000;

export const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);

/** Dates cross the wire as YYYY-MM-DD; the DB stores DateTime. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((v) => Number.isFinite(Date.parse(`${v}T12:00:00Z`)), "Not a real date");

/** Midday UTC, so a date never lands on the previous day in a western tz. */
export function toDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export function toISO(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

export function badRequest(error: unknown) {
  return NextResponse.json({ error }, { status: 400 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

/**
 * Every planning route starts here: authenticate, then confirm the caller
 * belongs to the group. Returns either a response to send back, or the user.
 */
export async function requireGroupAccess(groupId: string) {
  const me = await getSessionUser();
  if (!me) return { error: unauthorized() as NextResponse };
  if (!(await isGroupMember(groupId, me.id))) {
    return { error: forbidden("Not a member of this group") as NextResponse };
  }
  return { userId: me.id };
}

/**
 * Confirms a row belongs to the group named in the URL. Without this a member
 * of group A could pass group A's id and group B's task id and edit B's data.
 */
export async function assertTaskInGroup(taskId: string, groupId: string) {
  const task = await prisma.planningTask.findUnique({
    where: { id: taskId },
    select: { id: true, groupId: true },
  });
  return task && task.groupId === groupId ? task : null;
}

export async function assertColumnInGroup(columnId: string, groupId: string) {
  const column = await prisma.planningColumn.findUnique({
    where: { id: columnId },
    select: { id: true, groupId: true },
  });
  return column && column.groupId === groupId ? column : null;
}

export async function assertMilestoneInGroup(milestoneId: string, groupId: string) {
  const milestone = await prisma.planningMilestone.findUnique({
    where: { id: milestoneId },
    select: { id: true, groupId: true },
  });
  return milestone && milestone.groupId === groupId ? milestone : null;
}

/**
 * Drops ids that aren't members (or the owner) of the group, so a task can
 * never reference a user with no access to the board it lives on.
 */
export async function filterToGroupMembers(groupId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const unique = Array.from(new Set(userIds));
  const [members, group] = await Promise.all([
    prisma.groupMember.findMany({
      where: { groupId, userId: { in: unique } },
      select: { userId: true },
    }),
    // The owner has no GroupMember row of their own.
    prisma.group.findUnique({ where: { id: groupId }, select: { ownerId: true } }),
  ]);
  const allowed = new Set(members.map((m) => m.userId));
  if (group?.ownerId) allowed.add(group.ownerId);
  return unique.filter((id) => allowed.has(id));
}

/** Next position at the end of a column (or the board, for columns). */
export async function nextTaskPosition(columnId: string): Promise<number> {
  const last = await prisma.planningTask.findFirst({
    where: { columnId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -POSITION_STEP) + POSITION_STEP;
}

export async function nextColumnPosition(groupId: string): Promise<number> {
  const last = await prisma.planningColumn.findFirst({
    where: { groupId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -POSITION_STEP) + POSITION_STEP;
}

// ── Serialization ───────────────────────────────────────────────────────
// Prisma hands back Date objects; the client works in date strings. Convert
// here and nowhere else, so no component ever receives a Date.

export interface SerializedTask {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  startDate: string | null;
  dueDate: string | null;
  color: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | null;
  milestoneId: string | null;
  assigneeIds: string[];
  /** Workflow canvas coordinates. Null until the task is first dragged. */
  flowX: number | null;
  flowY: number | null;
}

type TaskRow = {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  startDate: Date | null;
  dueDate: Date | null;
  color: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | null;
  milestoneId: string | null;
  assignees?: { userId: string }[];
  flowX: number | null;
  flowY: number | null;
};

export function serializeTask(task: TaskRow): SerializedTask {
  return {
    id: task.id,
    columnId: task.columnId,
    title: task.title,
    description: task.description,
    position: task.position,
    startDate: toISO(task.startDate),
    dueDate: toISO(task.dueDate),
    color: task.color,
    priority: task.priority,
    milestoneId: task.milestoneId,
    assigneeIds: (task.assignees ?? []).map((a) => a.userId),
    flowX: task.flowX,
    flowY: task.flowY,
  };
}

export interface SerializedMilestone {
  id: string;
  title: string;
  startDate: string | null;
  dueDate: string;
  done: boolean;
}

export function serializeMilestone(m: {
  id: string;
  title: string;
  startDate: Date | null;
  dueDate: Date;
  done: boolean;
}): SerializedMilestone {
  return {
    id: m.id,
    title: m.title,
    startDate: toISO(m.startDate),
    dueDate: toISO(m.dueDate)!,
    done: m.done,
  };
}

/** Task shape with assignees, reused by every route that returns a task. */
export const TASK_SELECT = {
  id: true,
  columnId: true,
  title: true,
  description: true,
  position: true,
  startDate: true,
  dueDate: true,
  color: true,
  priority: true,
  milestoneId: true,
  assignees: { select: { userId: true } },
  flowX: true,
  flowY: true,
} as const;

// ── Dependencies ────────────────────────────────────────────────────────

export interface SerializedDependency {
  id: string;
  blockerId: string;
  dependentId: string;
}

/**
 * Would adding blocker→dependent close a loop?
 *
 * Walks the existing edges forward from `dependentId`: if `blockerId` is
 * reachable, then blocker already depends (transitively) on dependent, and the
 * new edge would make each side wait for the other. Rejected at the API rather
 * than tolerated, because the Workflow layout and any later schedule ordering
 * both assume an acyclic graph and would not terminate on one.
 */
export function wouldCreateCycle(
  edges: { blockerId: string; dependentId: string }[],
  blockerId: string,
  dependentId: string,
): boolean {
  // blocker -> [dependents]
  const next = new Map<string, string[]>();
  for (const e of edges) {
    const list = next.get(e.blockerId);
    if (list) list.push(e.dependentId);
    else next.set(e.blockerId, [e.dependentId]);
  }

  const seen = new Set<string>();
  const stack = [dependentId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === blockerId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of next.get(id) ?? []) {
      if (!seen.has(child)) stack.push(child);
    }
  }
  return false;
}
