import type { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { pushToUsers } from "./pushClient";
import { parseDueDate } from "./parseDate";
import { recordMemberInvited } from "./memberEvents";
import { mergeChangeRequest, rejectChangeRequest } from "./changeRequests";
import { findDoneColumn } from "../workspace/lib/boardProgress";
import { DEFAULT_COLUMNS, POSITION_STEP } from "../workspace/lib/planningBackfill";
import { nextTaskPosition, toDate } from "../api/workspace/[groupId]/planning/_shared";

/**
 * The assistant's write tools.
 *
 * Nothing here runs because the model asked. A write tool call only *proposes*
 * a change: the arguments are resolved and permission-checked, then stored as
 * a PENDING AssistantAction that the chat shows with Confirm / Cancel. The
 * change happens in `executeAction`, from the user's own click, after the
 * permission check is repeated — membership may have changed in between.
 *
 * The assistant always acts as the signed-in user and can never do more than
 * they could do on the board themselves.
 */

export const WRITE_TOOL_NAMES = [
  "create_task",
  "update_task",
  "close_task",
  "add_group_member",
  "merge_change_request",
  "reject_change_request",
  "send_group_message",
  "notify_team",
] as const;
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

export function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

/** A proposal left unconfirmed this long can no longer be confirmed. */
export const ACTION_TTL_MS = 30 * 60 * 1000;

/** Cap on proposals from one reply, so a confused model can't queue dozens. */
export const MAX_ACTIONS_PER_REPLY = 10;

const PRIORITY = { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] } as const;

export const writeTools = [
  {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Propose a new planning task in one of the user's groups. The user confirms it before it's created.",
      parameters: {
        type: "object",
        properties: {
          group: { type: "string", description: "Group name as the user said it, or its id" },
          title: { type: "string" },
          description: { type: "string" },
          priority: PRIORITY,
          due_date: {
            type: "string",
            description: "YYYY-MM-DD, or the user's words such as 'Friday' or 'in 2 weeks'",
          },
          assignees: {
            type: "array",
            items: { type: "string" },
            description: "Names or emails of group members; 'me' for the user",
          },
          column: { type: "string", description: "Board column name; defaults to the first column" },
        },
        required: ["group", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description:
        "Propose changes to an existing planning task: title, description, priority, due date, column, or assignees. The user confirms before anything changes.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task title as the user said it, or its id" },
          group: { type: "string", description: "Group name, to narrow down which task" },
          title: { type: "string", description: "New title" },
          description: { type: "string" },
          priority: PRIORITY,
          due_date: { type: "string", description: "New due date, or 'none' to clear it" },
          column: { type: "string", description: "Column to move the task to, e.g. 'In Progress'" },
          assignees: {
            type: "array",
            items: { type: "string" },
            description: "The full new list of assignees (replaces the current one)",
          },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_task",
      description:
        "Propose marking a planning task as done (moves it to the board's done column). The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task title as the user said it, or its id" },
          group: { type: "string", description: "Group name, to narrow down which task" },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_group_member",
      description:
        "Propose adding an existing Ko-Lab user to a group the user owns. The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          group: { type: "string", description: "Group name or id" },
          person: { type: "string", description: "The person's email address or phone number" },
        },
        required: ["group", "person"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "merge_change_request",
      description:
        "Propose approving and merging an open change request. Only the group owner can. The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          change_request: { type: "string", description: "Change request title or id" },
          group: { type: "string", description: "Group name, to narrow down which one" },
        },
        required: ["change_request"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_change_request",
      description:
        "Propose rejecting a change request (also used to ask the author for changes), with a message to the author. Only the group owner can. The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          change_request: { type: "string", description: "Change request title or id" },
          group: { type: "string", description: "Group name, to narrow down which one" },
          reason: { type: "string", description: "What the author should fix or why it was rejected" },
        },
        required: ["change_request"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_group_message",
      description:
        "Propose posting a message in a group's chat, sent as the user. The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          group: { type: "string", description: "Group name or id" },
          message: { type: "string", description: "The exact message to post" },
        },
        required: ["group", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notify_team",
      description:
        "Propose sending a notification to every member of a group. Only the owner or an admin can. The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          group: { type: "string", description: "Group name or id" },
          message: { type: "string", description: "The notification text" },
        },
        required: ["group", "message"],
      },
    },
  },
];

export interface WriteToolInput {
  group?: string;
  task?: string;
  title?: string;
  description?: string;
  priority?: string;
  due_date?: string;
  assignees?: string[];
  column?: string;
  person?: string;
  change_request?: string;
  reason?: string;
  message?: string;
}

/** What the confirmation card shows. */
export interface ActionPreview {
  title: string;
  details: { label: string; value: string }[];
}

/**
 * A problem the model should relay or resolve (ambiguous name, no permission).
 * Its message is written to be read by the model and passed on to the user.
 */
export class ActionError extends Error {}

interface Context {
  userId: string;
  /** The user's local date, YYYY-MM-DD, for resolving "Friday". */
  today: string;
}

// ── Resolving names to rows ─────────────────────────────────────────────

type Role = "OWNER" | "ADMIN" | "MEMBER";

interface ResolvedGroup {
  id: string;
  groupName: string;
  ownerId: string;
  ownerName: string;
  /** GroupMember rows; the owner has none of their own. */
  members: { userId: string; role: "ADMIN" | "MEMBER" }[];
  role: Role;
}

const myGroupsWhere = (userId: string) => ({
  OR: [{ ownerId: userId }, { members: { some: { userId } } }],
});

const GROUP_SELECT = {
  id: true,
  groupName: true,
  ownerId: true,
  ownerName: true,
  members: { select: { userId: true, role: true } },
} as const;

function roleIn(
  group: { ownerId: string; members: { userId: string; role: "ADMIN" | "MEMBER" }[] },
  userId: string,
): Role | null {
  if (group.ownerId === userId) return "OWNER";
  return group.members.find((m) => m.userId === userId)?.role ?? null;
}

/**
 * Exact id, then exact name, then partial name. Several partial matches is an
 * ambiguity for the user to settle, not something to guess at.
 */
function pickByName<T extends { id: string }>(
  items: T[],
  ref: string,
  nameOf: (item: T) => string,
  noun: string,
): T {
  const wanted = ref.trim().toLowerCase();
  const byId = items.find((i) => i.id === ref.trim());
  if (byId) return byId;
  const exact = items.filter((i) => nameOf(i).toLowerCase() === wanted);
  const matches = exact.length ? exact : items.filter((i) => nameOf(i).toLowerCase().includes(wanted));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new ActionError(`No ${noun} matching "${ref}" was found.`);
  const names = matches.slice(0, 5).map((m) => `"${nameOf(m)}"`).join(", ");
  throw new ActionError(`Several ${noun}s match "${ref}": ${names}. Ask the user which one they mean.`);
}

async function resolveGroup(ref: string, userId: string): Promise<ResolvedGroup> {
  const groups = await prisma.group.findMany({ where: myGroupsWhere(userId), select: GROUP_SELECT });
  const group = pickByName(groups, ref, (g) => g.groupName, "group");
  return { ...group, role: roleIn(group, userId)! };
}

interface ResolvedTask {
  id: string;
  title: string;
  columnId: string;
  assigneeIds: string[];
  group: ResolvedGroup;
}

async function resolveTask(ref: string, groupRef: string | undefined, userId: string): Promise<ResolvedTask> {
  const groupId = groupRef ? (await resolveGroup(groupRef, userId)).id : undefined;
  const tasks = await prisma.planningTask.findMany({
    where: { group: myGroupsWhere(userId), ...(groupId && { groupId }) },
    select: {
      id: true,
      title: true,
      columnId: true,
      assignees: { select: { userId: true } },
      group: { select: GROUP_SELECT },
    },
    take: 500,
  });
  const task = pickByName(tasks, ref, (t) => t.title, "task");
  return {
    id: task.id,
    title: task.title,
    columnId: task.columnId,
    assigneeIds: task.assignees.map((a) => a.userId),
    group: { ...task.group, role: roleIn(task.group, userId)! },
  };
}

interface Person {
  id: string;
  name: string;
}

/** Everyone who can see the group's board: its members plus the owner. */
async function groupPeople(groupId: string, ownerId: string) {
  const members = await prisma.groupMember.findMany({
    where: { groupId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const people = members.map((m) => m.user);
  if (!people.some((p) => p.id === ownerId)) {
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, name: true, email: true },
    });
    if (owner) people.push(owner);
  }
  return people;
}

const displayName = (p: { name: string | null; email: string }) => p.name || p.email;

async function resolvePeople(refs: string[], group: ResolvedGroup, userId: string): Promise<Person[]> {
  if (refs.length === 0) return [];
  const people = await groupPeople(group.id, group.ownerId);
  const resolved = new Map<string, Person>();

  for (const raw of refs) {
    const ref = raw.trim().toLowerCase();
    if (!ref) continue;
    let matches =
      ref === "me" || ref === "myself"
        ? people.filter((p) => p.id === userId)
        : people.filter((p) => p.email.toLowerCase() === ref || p.id === raw.trim());
    if (matches.length === 0) matches = people.filter((p) => (p.name ?? "").toLowerCase() === ref);
    if (matches.length === 0) {
      matches = people.filter((p) =>
        (p.name ?? "").toLowerCase().split(/\s+/).some((part) => part.startsWith(ref)),
      );
    }
    if (matches.length === 0) {
      throw new ActionError(`"${raw}" isn't a member of ${group.groupName}, so they can't be assigned.`);
    }
    if (matches.length > 1) {
      const options = matches.map((p) => `${displayName(p)} (${p.email})`).join(", ");
      throw new ActionError(`Several members of ${group.groupName} match "${raw}": ${options}. Ask the user which one.`);
    }
    resolved.set(matches[0]!.id, { id: matches[0]!.id, name: displayName(matches[0]!) });
  }
  return Array.from(resolved.values());
}

async function resolveColumn(ref: string, groupId: string) {
  const columns = await prisma.planningColumn.findMany({
    where: { groupId },
    select: { id: true, title: true },
  });
  return pickByName(columns, ref, (c) => c.title, "column");
}

async function resolveChangeRequest(
  ref: string,
  groupRef: string | undefined,
  userId: string,
  statuses: ("OPEN" | "CONFLICT")[],
) {
  const groupId = groupRef ? (await resolveGroup(groupRef, userId)).id : undefined;
  const crs = await prisma.changeRequest.findMany({
    where: {
      status: { in: statuses },
      group: myGroupsWhere(userId),
      ...(groupId && { groupId }),
    },
    select: {
      id: true,
      title: true,
      author: { select: { name: true, email: true } },
      group: { select: { id: true, groupName: true, ownerId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return pickByName(crs, ref, (cr) => cr.title, "open change request");
}

/** An existing account, found only by exact email or phone — never by name,
 *  so the assistant can't be used to search the user base. */
async function resolveAccount(ref: string) {
  const value = ref.trim();
  const user = value.includes("@")
    ? await prisma.user.findFirst({
        where: { email: { equals: value, mode: "insensitive" } },
        select: { id: true, name: true, email: true },
      })
    : await prisma.user.findFirst({
        where: { phone: value },
        select: { id: true, name: true, email: true },
      });
  if (!user) {
    throw new ActionError(
      `There's no Ko-Lab account with ${value.includes("@") ? "the email" : "the phone number"} "${value}". They can be invited from the group's page instead.`,
    );
  }
  return user;
}

function assertOwner(role: Role, action: string) {
  if (role !== "OWNER") throw new ActionError(`Only the group owner can ${action}.`);
}

function assertOwnerOrAdmin(role: Role, action: string) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw new ActionError(`Only the group owner or an admin can ${action}.`);
  }
}

function cleanMessage(value: string | undefined, max: number): string {
  const message = (value ?? "").trim();
  if (!message) throw new ActionError("The message is empty.");
  if (message.length > max) throw new ActionError(`Messages can be at most ${max} characters.`);
  return message;
}

// ── Validation and formatting ───────────────────────────────────────────

type Priority = "LOW" | "MEDIUM" | "HIGH";

function parsePriority(value: string | undefined): Priority | undefined {
  if (value === undefined) return undefined;
  const upper = value.trim().toUpperCase();
  if (upper === "LOW" || upper === "MEDIUM" || upper === "HIGH") return upper;
  throw new ActionError(`Priority must be Low, Medium, or High (got "${value}").`);
}

function parseDue(value: string, today: string): string {
  const iso = parseDueDate(value, today);
  if (!iso) {
    throw new ActionError(`Couldn't understand the date "${value}". Ask the user for a specific date.`);
  }
  return iso;
}

function cleanTitle(value: string | undefined): string {
  const title = (value ?? "").trim();
  if (!title) throw new ActionError("The task needs a title.");
  if (title.length > 200) throw new ActionError("Task titles can be at most 200 characters.");
  return title;
}

function cleanDescription(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > 5000) throw new ActionError("Descriptions can be at most 5000 characters.");
  return value.trim();
}

/** "Fri, Oct 24" */
function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const formatPriority = (p: Priority) => p.charAt(0) + p.slice(1).toLowerCase();

const formatPeople = (people: Person[]) => (people.length ? people.map((p) => p.name).join(", ") : "Nobody");

// ── Stored arguments ────────────────────────────────────────────────────
// Ids only: by the time the user confirms, names could match differently.

interface CreateTaskArgs {
  groupId: string;
  title: string;
  description: string | null;
  priority: Priority | null;
  dueDate: string | null;
  assigneeIds: string[];
  /** Null: the board's first column, created with the defaults if it has none. */
  columnId: string | null;
}

interface UpdateTaskArgs {
  groupId: string;
  taskId: string;
  title?: string;
  description?: string;
  priority?: Priority;
  /** Null clears the due date. */
  dueDate?: string | null;
  columnId?: string;
  assigneeIds?: string[];
}

interface CloseTaskArgs {
  groupId: string;
  taskId: string;
}

interface AddMemberArgs {
  groupId: string;
  userId: string;
}

interface ChangeRequestArgs {
  changeRequestId: string;
  reason?: string;
}

interface GroupMessageArgs {
  groupId: string;
  message: string;
}

/**
 * Only the owner, an admin, someone assigned to the task, or anyone when it's
 * unassigned may close it — so one member can't mark another's work done.
 */
function assertCanClose(role: Role, userId: string, assigneeIds: string[]) {
  if (role === "OWNER" || role === "ADMIN") return;
  if (assigneeIds.length === 0 || assigneeIds.includes(userId)) return;
  throw new ActionError(
    "Only the group owner, an admin, or someone assigned to this task can close it.",
  );
}

// ── Proposing ───────────────────────────────────────────────────────────

async function prepare(
  tool: WriteToolName,
  input: WriteToolInput,
  ctx: Context,
): Promise<{ args: object; preview: ActionPreview }> {
  switch (tool) {
    case "create_task": {
      if (!input.group) throw new ActionError("Which group should the task go in?");
      const group = await resolveGroup(input.group, ctx.userId);
      const title = cleanTitle(input.title);
      const description = cleanDescription(input.description);
      const priority = parsePriority(input.priority);
      const dueDate = input.due_date ? parseDue(input.due_date, ctx.today) : null;
      const assignees = await resolvePeople(input.assignees ?? [], group, ctx.userId);
      const column = input.column ? await resolveColumn(input.column, group.id) : null;

      const details = [{ label: "Group", value: group.groupName }];
      if (column) details.push({ label: "Column", value: column.title });
      if (priority) details.push({ label: "Priority", value: formatPriority(priority) });
      if (dueDate) details.push({ label: "Due", value: formatDate(dueDate) });
      if (assignees.length) details.push({ label: "Assign to", value: formatPeople(assignees) });
      if (description) details.push({ label: "Description", value: description });

      return {
        args: {
          groupId: group.id,
          title,
          description: description || null,
          priority: priority ?? null,
          dueDate,
          assigneeIds: assignees.map((a) => a.id),
          columnId: column?.id ?? null,
        },
        preview: { title: `Create task "${title}"`, details },
      };
    }

    case "update_task": {
      if (!input.task) throw new ActionError("Which task should be changed?");
      const task = await resolveTask(input.task, input.group, ctx.userId);
      const args: UpdateTaskArgs = { groupId: task.group.id, taskId: task.id };
      const details = [{ label: "Group", value: task.group.groupName }];

      if (input.title !== undefined) {
        args.title = cleanTitle(input.title);
        details.push({ label: "Rename to", value: args.title });
      }
      if (input.description !== undefined) {
        args.description = cleanDescription(input.description);
        details.push({ label: "Description", value: args.description || "(cleared)" });
      }
      if (input.priority !== undefined) {
        args.priority = parsePriority(input.priority);
        details.push({ label: "Priority", value: formatPriority(args.priority!) });
      }
      if (input.due_date !== undefined) {
        const clear = /^(none|no date|clear|remove)$/i.test(input.due_date.trim());
        args.dueDate = clear ? null : parseDue(input.due_date, ctx.today);
        details.push({ label: "Due", value: args.dueDate ? formatDate(args.dueDate) : "(cleared)" });
      }
      if (input.column !== undefined) {
        const column = await resolveColumn(input.column, task.group.id);
        args.columnId = column.id;
        details.push({ label: "Move to", value: column.title });
      }
      if (input.assignees !== undefined) {
        const people = await resolvePeople(input.assignees, task.group, ctx.userId);
        args.assigneeIds = people.map((p) => p.id);
        details.push({ label: "Assignees", value: formatPeople(people) });
      }
      if (details.length === 1) throw new ActionError("No changes were given for the task.");

      return { args, preview: { title: `Update task "${task.title}"`, details } };
    }

    case "close_task": {
      if (!input.task) throw new ActionError("Which task should be closed?");
      const task = await resolveTask(input.task, input.group, ctx.userId);
      assertCanClose(task.group.role, ctx.userId, task.assigneeIds);
      return {
        args: { groupId: task.group.id, taskId: task.id },
        preview: {
          title: `Mark "${task.title}" as done`,
          details: [{ label: "Group", value: task.group.groupName }],
        },
      };
    }

    case "add_group_member": {
      if (!input.group) throw new ActionError("Which group should they be added to?");
      if (!input.person) throw new ActionError("Who should be added? Ask for their email or phone number.");
      const group = await resolveGroup(input.group, ctx.userId);
      assertOwner(group.role, "add members");
      const person = await resolveAccount(input.person);
      if (person.id === group.ownerId || group.members.some((m) => m.userId === person.id)) {
        throw new ActionError(`${displayName(person)} is already in ${group.groupName}.`);
      }
      const args: AddMemberArgs = { groupId: group.id, userId: person.id };
      return {
        args,
        preview: {
          title: `Add ${displayName(person)} to ${group.groupName}`,
          details: [
            { label: "Group", value: group.groupName },
            { label: "Person", value: `${displayName(person)} (${person.email})` },
          ],
        },
      };
    }

    case "merge_change_request":
    case "reject_change_request": {
      if (!input.change_request) throw new ActionError("Which change request?");
      const merging = tool === "merge_change_request";
      const cr = await resolveChangeRequest(
        input.change_request,
        input.group,
        ctx.userId,
        merging ? ["OPEN"] : ["OPEN", "CONFLICT"],
      );
      if (cr.group.ownerId !== ctx.userId) {
        throw new ActionError(`Only the group owner can ${merging ? "merge" : "reject"} change requests.`);
      }
      const reason = merging ? undefined : input.reason?.trim() || undefined;
      if (reason && reason.length > 2000) throw new ActionError("The message can be at most 2000 characters.");
      const details = [
        { label: "Group", value: cr.group.groupName },
        { label: "Author", value: displayName(cr.author) },
      ];
      if (reason) details.push({ label: "Message to author", value: reason });
      const args: ChangeRequestArgs = { changeRequestId: cr.id, ...(reason && { reason }) };
      return {
        args,
        preview: {
          title: `${merging ? "Merge" : "Reject"} change request "${cr.title}"`,
          details,
        },
      };
    }

    case "send_group_message":
    case "notify_team": {
      if (!input.group) throw new ActionError("Which group?");
      const group = await resolveGroup(input.group, ctx.userId);
      const posting = tool === "send_group_message";
      if (!posting) assertOwnerOrAdmin(group.role, "notify the whole team");
      const args: GroupMessageArgs = {
        groupId: group.id,
        // The socket server caps chat messages at 4000 characters
        message: cleanMessage(input.message, posting ? 4000 : 500),
      };
      return {
        args,
        preview: {
          title: posting ? `Post in ${group.groupName}` : `Notify everyone in ${group.groupName}`,
          details: [{ label: "Message", value: args.message }],
        },
      };
    }
  }
}

export interface ProposedAction {
  id: string;
  tool: WriteToolName;
  preview: ActionPreview;
}

/**
 * Resolve and check a write tool call, and store it for the user to confirm.
 * Throws ActionError for anything the model should take back to the user.
 */
export async function proposeAction(
  tool: WriteToolName,
  input: WriteToolInput,
  ctx: Context & { conversationId: string | null },
): Promise<ProposedAction> {
  const { args, preview } = await prepare(tool, input, ctx);
  const row = await prisma.assistantAction.create({
    data: {
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      tool,
      args: args as unknown as Prisma.InputJsonValue,
      preview: preview as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { id: row.id, tool, preview };
}

// ── Executing (after the user confirms) ─────────────────────────────────

async function loadGroup(groupId: string, userId: string): Promise<ResolvedGroup> {
  const group = await prisma.group.findFirst({
    where: { id: groupId, ...myGroupsWhere(userId) },
    select: GROUP_SELECT,
  });
  if (!group) throw new ActionError("You're no longer a member of this group.");
  return { ...group, role: roleIn(group, userId)! };
}

async function loadTask(taskId: string, groupId: string) {
  const task = await prisma.planningTask.findFirst({
    where: { id: taskId, groupId },
    select: { id: true, title: true, columnId: true, assignees: { select: { userId: true } } },
  });
  if (!task) throw new ActionError("That task no longer exists.");
  return { ...task, assigneeIds: task.assignees.map((a) => a.userId) };
}

/** Drop anyone who left the group since the proposal was made. */
async function stillMembers(group: ResolvedGroup, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const people = await groupPeople(group.id, group.ownerId);
  const allowed = new Set(people.map((p) => p.id));
  return userIds.filter((id) => allowed.has(id));
}

/** The first column, seeding the default columns on a board that has none. */
async function firstColumnId(groupId: string): Promise<string> {
  const first = await prisma.planningColumn.findFirst({
    where: { groupId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (first) return first.id;
  const created = await prisma.$transaction(
    DEFAULT_COLUMNS.map((c, i) =>
      prisma.planningColumn.create({
        data: { groupId, title: c.title, color: c.color, position: i * POSITION_STEP },
        select: { id: true },
      }),
    ),
  );
  return created[0]!.id;
}

async function actorName(userId: string): Promise<string> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return me ? displayName(me) : "Someone";
}

/**
 * Tell newly assigned people. Best-effort: the task change has already been
 * made, and a failed notification mustn't turn that into an error.
 */
async function notifyAssigned(
  recipientIds: string[],
  actorId: string,
  group: ResolvedGroup,
  taskTitle: string,
) {
  const recipients = recipientIds.filter((id) => id !== actorId);
  if (recipients.length === 0) return;
  try {
    const name = await actorName(actorId);
    const message = `${name} assigned you "${taskTitle}" in ${group.groupName}`;
    await prisma.notifications.createMany({
      data: recipients.map((recipientId) => ({
        recipientId,
        type: "TASK_ASSIGNED",
        userId: actorId,
        userName: name,
        groupId: group.id,
        ownerId: group.ownerId,
        ownerName: group.ownerName,
        groupName: group.groupName,
        message,
      })),
    });
    await pushToUsers(recipients, {
      type: "notification",
      notificationType: "TASK_ASSIGNED",
      groupId: group.id,
      groupName: group.groupName,
      message,
    });
  } catch (error) {
    console.error("Failed to notify task assignees:", error);
  }
}

export interface ActionResult {
  message: string;
  groupId: string;
  taskId?: string;
}

/**
 * Carry out a confirmed action as `userId`. Permission is checked again here
 * because the proposal may be up to ACTION_TTL_MS old.
 */
export async function executeAction(tool: string, rawArgs: unknown, userId: string): Promise<ActionResult> {
  switch (tool) {
    case "create_task": {
      const args = rawArgs as CreateTaskArgs;
      const group = await loadGroup(args.groupId, userId);
      const assigneeIds = await stillMembers(group, args.assigneeIds);

      let columnId = args.columnId;
      if (columnId) {
        const column = await prisma.planningColumn.findFirst({
          where: { id: columnId, groupId: group.id },
          select: { id: true },
        });
        columnId = column?.id ?? null;
      }
      columnId ??= await firstColumnId(group.id);

      const task = await prisma.planningTask.create({
        data: {
          groupId: group.id,
          columnId,
          title: args.title,
          description: args.description,
          priority: args.priority,
          dueDate: args.dueDate ? toDate(args.dueDate) : null,
          position: await nextTaskPosition(columnId),
          assignees: { create: assigneeIds.map((id) => ({ userId: id })) },
        },
        select: { id: true },
      });
      await notifyAssigned(assigneeIds, userId, group, args.title);
      return { message: `Created "${args.title}" in ${group.groupName}.`, taskId: task.id, groupId: group.id };
    }

    case "update_task": {
      const args = rawArgs as UpdateTaskArgs;
      const group = await loadGroup(args.groupId, userId);
      const task = await loadTask(args.taskId, group.id);

      if (args.columnId) {
        const column = await prisma.planningColumn.findFirst({
          where: { id: args.columnId, groupId: group.id },
          select: { id: true },
        });
        if (!column) throw new ActionError("That column no longer exists.");
      }

      const assigneeIds = args.assigneeIds && (await stillMembers(group, args.assigneeIds));
      const moving = args.columnId !== undefined && args.columnId !== task.columnId;
      const position = moving ? await nextTaskPosition(args.columnId!) : undefined;

      await prisma.$transaction(async (tx) => {
        if (assigneeIds) {
          await tx.planningAssignee.deleteMany({ where: { taskId: task.id } });
          if (assigneeIds.length) {
            await tx.planningAssignee.createMany({
              data: assigneeIds.map((id) => ({ taskId: task.id, userId: id })),
            });
          }
        }
        await tx.planningTask.update({
          where: { id: task.id },
          data: {
            ...(args.title !== undefined && { title: args.title }),
            ...(args.description !== undefined && { description: args.description || null }),
            ...(args.priority !== undefined && { priority: args.priority }),
            ...(args.dueDate !== undefined && { dueDate: args.dueDate ? toDate(args.dueDate) : null }),
            ...(moving && { columnId: args.columnId, position }),
          },
        });
      });

      if (assigneeIds) {
        const added = assigneeIds.filter((id) => !task.assigneeIds.includes(id));
        await notifyAssigned(added, userId, group, args.title ?? task.title);
      }
      return { message: `Updated "${args.title ?? task.title}".`, taskId: task.id, groupId: group.id };
    }

    case "close_task": {
      const args = rawArgs as CloseTaskArgs;
      const group = await loadGroup(args.groupId, userId);
      const task = await loadTask(args.taskId, group.id);
      assertCanClose(group.role, userId, task.assigneeIds);

      const columns = await prisma.planningColumn.findMany({
        where: { groupId: group.id },
        orderBy: { position: "asc" },
        select: { id: true, title: true },
      });
      const done = findDoneColumn(columns);
      if (!done) throw new ActionError("This board has no columns to move the task into.");
      if (task.columnId === done.id) {
        return { message: `"${task.title}" was already done.`, taskId: task.id, groupId: group.id };
      }

      await prisma.planningTask.update({
        where: { id: task.id },
        data: { columnId: done.id, position: await nextTaskPosition(done.id) },
      });
      return { message: `Moved "${task.title}" to ${done.title}.`, taskId: task.id, groupId: group.id };
    }

    case "add_group_member": {
      const args = rawArgs as AddMemberArgs;
      const group = await loadGroup(args.groupId, userId);
      assertOwner(group.role, "add members");
      if (args.userId === group.ownerId || group.members.some((m) => m.userId === args.userId)) {
        throw new ActionError("They're already in this group.");
      }
      await prisma.groupMember.create({
        data: { groupId: group.id, userId: args.userId, role: "MEMBER" },
      });
      const invitee = await prisma.user.findUnique({
        where: { id: args.userId },
        select: { name: true, email: true },
      });
      const inviteeName = invitee ? displayName(invitee) : "A new member";
      await recordMemberInvited({
        groupId: group.id,
        actorId: userId,
        actorName: await actorName(userId),
        inviteeId: args.userId,
        inviteeName,
      });
      return { message: `Added ${inviteeName} to ${group.groupName}.`, groupId: group.id };
    }

    case "merge_change_request":
    case "reject_change_request": {
      const args = rawArgs as ChangeRequestArgs;
      const outcome =
        tool === "merge_change_request"
          ? await mergeChangeRequest(args.changeRequestId, userId)
          : await rejectChangeRequest(args.changeRequestId, userId, args.reason);
      if (!outcome.ok) throw new ActionError(outcome.error);
      const cr = await prisma.changeRequest.findUnique({
        where: { id: args.changeRequestId },
        select: { groupId: true },
      });
      return {
        message: `${outcome.status === "MERGED" ? "Merged" : "Rejected"} "${outcome.title}".`,
        groupId: cr?.groupId ?? "",
      };
    }

    case "send_group_message": {
      const args = rawArgs as GroupMessageArgs;
      const group = await loadGroup(args.groupId, userId);
      const senderName = await actorName(userId);
      const row = await prisma.groupMessage.create({
        data: { groupId: group.id, senderId: userId, senderName, message: args.message },
        select: { id: true, createdAt: true },
      });
      // Open chats only hear about messages over the socket
      const people = await groupPeople(group.id, group.ownerId);
      await pushToUsers(
        people.map((p) => p.id),
        {
          type: "group_message",
          id: row.id,
          groupId: group.id,
          senderId: userId,
          senderName,
          content: args.message,
          createdAt: row.createdAt.getTime(),
        },
      );
      return { message: `Posted in ${group.groupName}.`, groupId: group.id };
    }

    case "notify_team": {
      const args = rawArgs as GroupMessageArgs;
      const group = await loadGroup(args.groupId, userId);
      assertOwnerOrAdmin(group.role, "notify the whole team");
      const name = await actorName(userId);
      const recipients = (await groupPeople(group.id, group.ownerId))
        .map((p) => p.id)
        .filter((id) => id !== userId);
      if (recipients.length === 0) throw new ActionError("There's nobody else in this group to notify.");
      const message = `${name} (${group.groupName}): ${args.message}`;
      await prisma.notifications.createMany({
        data: recipients.map((recipientId) => ({
          recipientId,
          type: "TEAM_NOTICE",
          userId,
          userName: name,
          groupId: group.id,
          ownerId: group.ownerId,
          ownerName: group.ownerName,
          groupName: group.groupName,
          message,
        })),
      });
      await pushToUsers(recipients, {
        type: "notification",
        notificationType: "TEAM_NOTICE",
        groupId: group.id,
        groupName: group.groupName,
        message,
      });
      return {
        message: `Notified ${recipients.length} ${recipients.length === 1 ? "person" : "people"} in ${group.groupName}.`,
        groupId: group.id,
      };
    }

    default:
      throw new ActionError(`Unknown action "${tool}".`);
  }
}
