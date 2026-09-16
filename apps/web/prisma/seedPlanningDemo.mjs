/**
 * Demo planning data for one group, so the four Planning views have something
 * to render.
 *
 * Scoped to a single groupId and idempotent: rerunning replaces the demo rows
 * it created rather than stacking duplicates. Only touches planning tables and
 * the group's description — never users, members or repo data.
 *
 *   node prisma/seedPlanningDemo.mjs <groupId>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GROUP_ID = process.argv[2];
if (!GROUP_ID) {
  console.error("Usage: node prisma/seedPlanningDemo.mjs <groupId>");
  process.exit(1);
}

/** Marks rows this script owns, so a rerun can clear exactly those. */
const TAG = "[demo]";

/** Midday UTC, matching the API's convention so dates never slip a day. */
const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return new Date(`${d.toISOString().slice(0, 10)}T12:00:00Z`);
};

const COLUMNS = [
  { title: "Backlog", color: "#a78bfa" },
  { title: "In Progress", color: "#60a5fa" },
  { title: "Review", color: "#fbbf24" },
  { title: "Done", color: "#34d399" },
];

const MILESTONES = [
  { title: "v1 Launch", startDate: day(-20), dueDate: day(10) },
  { title: "Beta Release", startDate: day(-5), dueDate: day(28), done: false },
  { title: "Design System", startDate: day(-30), dueDate: day(-2), done: true },
];

// column index, milestone index, and a flow position so the Workflow view opens
// as a readable left-to-right pipeline rather than a stack.
const TASKS = [
  { t: "Set up CI pipeline",        c: 3, m: 2, p: "HIGH",   start: -30, due: -18, x: 40,  y: 40,  a: 1 },
  { t: "Design tokens + palette",   c: 3, m: 2, p: "MEDIUM", start: -28, due: -12, x: 40,  y: 190, a: 1 },
  { t: "Auth flow (OAuth)",         c: 3, m: 0, p: "HIGH",   start: -16, due: -4,  x: 320, y: 40,  a: 2 },
  { t: "Workspace shell + sidebar", c: 1, m: 0, p: "HIGH",   start: -6,  due: 4,   x: 320, y: 190, a: 2 },
  { t: "Kanban drag and drop",      c: 1, m: 0, p: "MEDIUM", start: -3,  due: 7,   x: 600, y: 40,  a: 1 },
  { t: "Gantt timeline scaling",    c: 2, m: 0, p: "MEDIUM", start: -1,  due: 6,   x: 600, y: 190, a: 1 },
  { t: "Task dependencies graph",   c: 1, m: 1, p: "HIGH",   start: 0,   due: 12,  x: 880, y: 40,  a: 2 },
  { t: "Realtime presence",         c: 0, m: 1, p: "LOW",    start: 3,   due: 18,  x: 880, y: 190, a: 0 },
  // Deliberately overdue and unassigned — exercises the red due-date styling
  // and the empty avatar stack.
  { t: "Mobile responsive audit",   c: 0, m: 1, p: "HIGH",   start: -8,  due: -1,  x: 1160, y: 40, a: 0 },
  { t: "Write API docs",            c: 0, m: null, p: null,  start: null, due: null, x: 1160, y: 190, a: 0 },
];

/** blocker index → dependent index. Acyclic, and a diamond around 3→{4,5}→6. */
const EDGES = [
  [0, 2],
  [1, 3],
  [2, 3],
  [3, 4],
  [3, 5],
  [4, 6],
  [5, 6],
  [6, 8],
];

async function main() {
  const group = await prisma.group.findUnique({
    where: { id: GROUP_ID },
    select: { id: true, groupName: true, ownerId: true },
  });
  if (!group) throw new Error(`No group with id ${GROUP_ID}`);

  console.log(`Seeding demo planning data into "${group.groupName}"`);

  // Assignees must be real members (or the owner), matching the API's own rule.
  const memberRows = await prisma.groupMember.findMany({
    where: { groupId: GROUP_ID },
    select: { userId: true },
  });
  const userIds = Array.from(new Set([group.ownerId, ...memberRows.map((m) => m.userId)]));
  console.log(`  ${userIds.length} assignable user(s)`);

  // ── Clear previous demo rows ────────────────────────────────────────────
  // Tasks and dependencies cascade from the columns, so deleting the tagged
  // columns is enough. Untagged columns the user made by hand are left alone.
  const oldCols = await prisma.planningColumn.findMany({
    where: { groupId: GROUP_ID, title: { endsWith: TAG } },
    select: { id: true },
  });
  if (oldCols.length) {
    await prisma.planningColumn.deleteMany({
      where: { id: { in: oldCols.map((c) => c.id) } },
    });
    console.log(`  cleared ${oldCols.length} previous demo column(s)`);
  }
  await prisma.planningMilestone.deleteMany({
    where: { groupId: GROUP_ID, title: { endsWith: TAG } },
  });

  // ── Columns ─────────────────────────────────────────────────────────────
  const columnIds = [];
  for (let i = 0; i < COLUMNS.length; i++) {
    const col = await prisma.planningColumn.create({
      data: {
        groupId: GROUP_ID,
        title: `${COLUMNS[i].title} ${TAG}`,
        color: COLUMNS[i].color,
        // Well past any hand-made column so the demo sits to the right of it.
        position: 10000 + i * 1000,
      },
      select: { id: true },
    });
    columnIds.push(col.id);
  }

  // ── Milestones ──────────────────────────────────────────────────────────
  const milestoneIds = [];
  for (const m of MILESTONES) {
    const row = await prisma.planningMilestone.create({
      data: {
        groupId: GROUP_ID,
        title: `${m.title} ${TAG}`,
        startDate: m.startDate,
        dueDate: m.dueDate,
        done: Boolean(m.done),
      },
      select: { id: true },
    });
    milestoneIds.push(row.id);
  }

  // ── Tasks ───────────────────────────────────────────────────────────────
  const taskIds = [];
  for (let i = 0; i < TASKS.length; i++) {
    const t = TASKS[i];
    const assignees = userIds.slice(0, Math.min(t.a, userIds.length));
    const row = await prisma.planningTask.create({
      data: {
        groupId: GROUP_ID,
        columnId: columnIds[t.c],
        title: t.t,
        description:
          "Demo task created by seedPlanningDemo.mjs — safe to delete.",
        position: i * 1000,
        startDate: t.start === null ? null : day(t.start),
        dueDate: t.due === null ? null : day(t.due),
        priority: t.p,
        milestoneId: t.m === null ? null : milestoneIds[t.m],
        flowX: t.x,
        flowY: t.y,
        ...(assignees.length > 0 && {
          assignees: { create: assignees.map((userId) => ({ userId })) },
        }),
      },
      select: { id: true },
    });
    taskIds.push(row.id);
  }

  // ── Dependencies ────────────────────────────────────────────────────────
  for (const [from, to] of EDGES) {
    await prisma.planningTaskDependency.create({
      data: {
        groupId: GROUP_ID,
        blockerId: taskIds[from],
        dependentId: taskIds[to],
      },
    });
  }

  // ── Group details for the panel ─────────────────────────────────────────
  await prisma.group.update({
    where: { id: GROUP_ID },
    data: {
      description:
        "Collaborative coding workspace with realtime editing, Kanban planning, and dependency-aware milestones. Demo description — edit or clear it any time.",
    },
  });

  console.log(
    `  created ${columnIds.length} columns, ${milestoneIds.length} milestones, ` +
      `${taskIds.length} tasks, ${EDGES.length} dependencies`,
  );
  console.log(`\nOpen: /workspace/${GROUP_ID}/planning`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
