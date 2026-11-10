/**
 * Assistant write tools: a tool call only proposes a change, and the change
 * runs only from the user's confirm, as that user, with their permissions
 * checked again at that point.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: {
    group: { findMany: vi.fn(), findFirst: vi.fn() },
    groupMember: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    planningTask: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    planningColumn: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    notifications: { createMany: vi.fn() },
    assistantAction: {
      create: vi.fn(async () => ({ id: "act1" })),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    assistantConversation: {
      create: vi.fn(async () => ({ id: "conv1" })),
      findFirst: vi.fn(async () => ({ id: "conv1" })),
    },
    assistantDailyUsage: {
      createMany: vi.fn(async () => ({ count: 1 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => ({ used: 1 })),
    },
    $transaction: vi.fn(),
  },
}));

const { completions } = vi.hoisted(() => ({ completions: vi.fn() }));
vi.mock("groq-sdk", () => ({
  Groq: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: completions } } };
  }),
}));
process.env.GROQ_API_KEY = "test";
vi.mock("../../app/lib/pushClient", () => ({ pushToUsers: vi.fn(async () => 1) }));
vi.mock("../../app/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "me" } })) }));

import prisma from "../../app/lib/prisma";
import { pushToUsers } from "../../app/lib/pushClient";
import { ActionError, executeAction, proposeAction } from "../../app/lib/assistantActions";
import { POST as decide } from "../../app/api/assistant/actions/[actionId]/route";
import { POST as chat } from "../../app/api/assistant/route";

type Mock = ReturnType<typeof vi.fn>;
type Model = Record<
  "findMany" | "findFirst" | "findUnique" | "create" | "createMany" | "update" | "updateMany",
  Mock
>;
const db = prisma as unknown as Record<
  "group" | "groupMember" | "user" | "planningTask" | "planningColumn" | "notifications" | "assistantAction",
  Model
> & { $transaction: Mock };

const ANIME = {
  id: "g1",
  groupName: "Anime Website",
  ownerId: "owner",
  ownerName: "Olivia",
  members: [
    { userId: "me", role: "MEMBER" },
    { userId: "alice", role: "MEMBER" },
  ],
};
const ANIME_API = { ...ANIME, id: "g2", groupName: "Anime API" };

const PEOPLE = [
  { user: { id: "me", name: "Vanshika Sabharwal", email: "v@example.com" } },
  { user: { id: "alice", name: "Alice Smith", email: "alice@example.com" } },
  { user: { id: "owner", name: "Olivia", email: "o@example.com" } },
];

const ctx = { userId: "me", today: "2026-10-21", conversationId: "conv1" };

beforeEach(() => {
  vi.clearAllMocks();
  db.group.findMany.mockResolvedValue([ANIME, ANIME_API]);
  db.group.findFirst.mockResolvedValue(ANIME);
  db.groupMember.findMany.mockResolvedValue(PEOPLE);
  db.user.findUnique.mockResolvedValue({ name: "Vanshika Sabharwal", email: "v@example.com" });
  db.planningColumn.findFirst.mockResolvedValue({ id: "col-planning", position: 0 });
  db.planningTask.findFirst.mockResolvedValue(null);
  db.planningTask.create.mockResolvedValue({ id: "task-new" });
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? arg(prisma) : Promise.all(arg as Promise<unknown>[]),
  );
});

describe("proposeAction", () => {
  it("stores a resolved create_task as PENDING without creating the task", async () => {
    const action = await proposeAction(
      "create_task",
      {
        group: "anime website",
        title: "Fix API validation",
        priority: "high",
        due_date: "Friday",
        assignees: ["me", "alice"],
      },
      ctx,
    );

    expect(db.planningTask.create).not.toHaveBeenCalled();
    const stored = db.assistantAction.create.mock.calls[0]![0].data;
    expect(stored).toMatchObject({ userId: "me", tool: "create_task", conversationId: "conv1" });
    expect(stored.args).toEqual({
      groupId: "g1",
      title: "Fix API validation",
      description: null,
      priority: "HIGH",
      dueDate: "2026-10-23",
      assigneeIds: ["me", "alice"],
      columnId: null,
    });
    expect(action.preview.details).toContainEqual({ label: "Due", value: "Fri, Oct 23" });
    expect(action.preview.details).toContainEqual({
      label: "Assign to",
      value: "Vanshika Sabharwal, Alice Smith",
    });
  });

  it("asks which group when a name matches several", async () => {
    await expect(proposeAction("create_task", { group: "anime", title: "x" }, ctx)).rejects.toThrow(
      /Several groups match "anime".*Anime Website.*Anime API/,
    );
    expect(db.assistantAction.create).not.toHaveBeenCalled();
  });

  it("only searches the caller's own groups", async () => {
    await proposeAction("create_task", { group: "Anime Website", title: "x" }, ctx);
    expect(db.group.findMany.mock.calls[0]![0].where).toEqual({
      OR: [{ ownerId: "me" }, { members: { some: { userId: "me" } } }],
    });
  });

  it("refuses to assign someone outside the group", async () => {
    await expect(
      proposeAction("create_task", { group: "Anime Website", title: "x", assignees: ["bob"] }, ctx),
    ).rejects.toThrow(/"bob" isn't a member of Anime Website/);
  });

  it("rejects a due date it can't read instead of guessing", async () => {
    await expect(
      proposeAction("create_task", { group: "Anime Website", title: "x", due_date: "soonish" }, ctx),
    ).rejects.toBeInstanceOf(ActionError);
  });

  it("won't let a member close a task assigned only to someone else", async () => {
    db.planningTask.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "Fix API validation",
        columnId: "c1",
        assignees: [{ userId: "alice" }],
        group: ANIME,
      },
    ]);
    await expect(proposeAction("close_task", { task: "fix api" }, ctx)).rejects.toThrow(
      /Only the group owner, an admin, or someone assigned/,
    );
  });

  it("lets an admin close anyone's task", async () => {
    db.planningTask.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "Fix API validation",
        columnId: "c1",
        assignees: [{ userId: "alice" }],
        group: { ...ANIME, members: [{ userId: "me", role: "ADMIN" }] },
      },
    ]);
    const action = await proposeAction("close_task", { task: "Fix API validation" }, ctx);
    expect(action.preview.title).toBe('Mark "Fix API validation" as done');
  });
});

describe("executeAction", () => {
  const args = {
    groupId: "g1",
    title: "Fix API validation",
    description: null,
    priority: "HIGH",
    dueDate: "2026-10-23",
    assigneeIds: ["me", "alice"],
    columnId: null,
  };

  it("creates the task and notifies the other assignees, not the actor", async () => {
    const result = await executeAction("create_task", args, "me");

    expect(result).toMatchObject({ taskId: "task-new", groupId: "g1" });
    const data = db.planningTask.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ groupId: "g1", columnId: "col-planning", priority: "HIGH" });
    expect(data.assignees.create).toEqual([{ userId: "me" }, { userId: "alice" }]);

    const notified = db.notifications.createMany.mock.calls[0]![0].data;
    expect(notified.map((n: { recipientId: string }) => n.recipientId)).toEqual(["alice"]);
    expect(notified[0].type).toBe("TASK_ASSIGNED");
    expect(pushToUsers).toHaveBeenCalledWith(["alice"], expect.objectContaining({ type: "notification" }));
  });

  it("checks membership again at confirm time", async () => {
    db.group.findFirst.mockResolvedValue(null);
    await expect(executeAction("create_task", args, "me")).rejects.toThrow(/no longer a member/);
    expect(db.planningTask.create).not.toHaveBeenCalled();
  });

  it("drops assignees who left the group since the proposal", async () => {
    db.groupMember.findMany.mockResolvedValue(PEOPLE.filter((p) => p.user.id !== "alice"));
    await executeAction("create_task", args, "me");
    expect(db.planningTask.create.mock.calls[0]![0].data.assignees.create).toEqual([{ userId: "me" }]);
  });

  it("seeds the default columns on a board that has none", async () => {
    db.planningColumn.findFirst.mockResolvedValue(null);
    db.planningColumn.create.mockImplementation(async ({ data }: { data: { title: string } }) => ({
      id: `col-${data.title}`,
    }));
    await executeAction("create_task", args, "me");
    expect(db.planningColumn.create).toHaveBeenCalledTimes(4);
    expect(db.planningTask.create.mock.calls[0]![0].data.columnId).toBe("col-Planning");
  });

  it("closes a task by moving it to the done column", async () => {
    db.planningTask.findFirst.mockResolvedValue({
      id: "t1",
      title: "Fix API validation",
      columnId: "c-progress",
      assignees: [{ userId: "me" }],
    });
    db.planningColumn.findMany.mockResolvedValue([
      { id: "c-progress", title: "In Progress" },
      { id: "c-done", title: "Completed" },
      { id: "c-archive", title: "Archive" },
    ]);
    const result = await executeAction("close_task", { groupId: "g1", taskId: "t1" }, "me");
    expect(db.planningTask.update.mock.calls[0]![0].data.columnId).toBe("c-done");
    expect(result.message).toBe('Moved "Fix API validation" to Completed.');
  });
});

describe("POST /api/assistant/actions/[actionId]", () => {
  const pending = {
    id: "act1",
    tool: "close_task",
    args: { groupId: "g1", taskId: "t1" },
    status: "PENDING",
    createdAt: new Date(),
  };

  function send(decision: string) {
    return decide(
      new Request("http://localhost/api/assistant/actions/act1", {
        method: "POST",
        body: JSON.stringify({ decision }),
      }),
      { params: { actionId: "act1" } },
    );
  }

  beforeEach(() => {
    db.assistantAction.findFirst.mockResolvedValue(pending);
    db.assistantAction.updateMany.mockResolvedValue({ count: 1 });
    db.planningTask.findFirst.mockResolvedValue({
      id: "t1",
      title: "Fix API validation",
      columnId: "c1",
      assignees: [],
    });
    db.planningColumn.findMany.mockResolvedValue([
      { id: "c1", title: "Planning" },
      { id: "c-done", title: "Completed" },
    ]);
  });

  it("only finds the caller's own proposals", async () => {
    db.assistantAction.findFirst.mockResolvedValue(null);
    const res = await send("confirm");
    expect(res.status).toBe(404);
    expect(db.assistantAction.findFirst.mock.calls[0]![0].where).toEqual({ id: "act1", userId: "me" });
  });

  it("claims the row before executing, so a double click runs it once", async () => {
    db.assistantAction.updateMany.mockResolvedValue({ count: 0 });
    const res = await send("confirm");
    expect(res.status).toBe(409);
    expect(db.planningTask.update).not.toHaveBeenCalled();
    expect(db.assistantAction.updateMany.mock.calls[0]![0].where).toEqual({
      id: "act1",
      status: "PENDING",
    });
  });

  it("executes on confirm and records the result", async () => {
    const res = await send("confirm");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "EXECUTED", taskId: "t1" });
    expect(db.planningTask.update).toHaveBeenCalledTimes(1);
    expect(db.assistantAction.update.mock.calls[0]![0].data.result).toMatchObject({ taskId: "t1" });
  });

  it("changes nothing on cancel", async () => {
    const res = await send("cancel");
    expect(await res.json()).toMatchObject({ status: "CANCELLED" });
    expect(db.assistantAction.updateMany.mock.calls[0]![0].data.status).toBe("CANCELLED");
    expect(db.planningTask.update).not.toHaveBeenCalled();
  });

  it("refuses a stale proposal", async () => {
    db.assistantAction.findFirst.mockResolvedValue({
      ...pending,
      createdAt: new Date(Date.now() - 31 * 60 * 1000),
    });
    const res = await send("confirm");
    expect(res.status).toBe(410);
    expect(db.planningTask.update).not.toHaveBeenCalled();
  });

  it("marks the action FAILED when the permission check fails at confirm time", async () => {
    db.planningTask.findFirst.mockResolvedValue({
      id: "t1",
      title: "Fix API validation",
      columnId: "c1",
      assignees: [{ userId: "alice" }],
    });
    const res = await send("confirm");
    expect(res.status).toBe(422);
    expect(db.assistantAction.update.mock.calls[0]![0].data.status).toBe("FAILED");
    expect(db.planningTask.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/assistant with a write tool", () => {
  it("returns the proposal as a card and changes nothing", async () => {
    completions
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: {
                    name: "create_task",
                    arguments: JSON.stringify({ group: "Anime Website", title: "Review PR" }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ choices: [{ finish_reason: "stop", message: { content: "" } }] });

    const res = await chat(
      new Request("http://localhost/api/assistant", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "add a Review PR task to Anime Website" }],
          timeZone: "Asia/Kolkata",
        }),
      }),
    );
    const data = await res.json();

    expect(data.actions).toEqual([
      expect.objectContaining({ id: "act1", tool: "create_task" }),
    ]);
    expect(data.response).toMatch(/Confirm below/);
    expect(db.planningTask.create).not.toHaveBeenCalled();

    // The model is told it's waiting on the user, not that it's done
    const toolMsg = completions.mock.calls[1]![0].messages.find(
      (m: { role: string }) => m.role === "tool",
    );
    expect(JSON.parse(toolMsg.content).status).toBe("awaiting_user_confirmation");
    // ...and knows today's date for relative due dates
    expect(completions.mock.calls[0]![0].messages[0].content).toMatch(/Today is \w+day, \d{4}-\d{2}-\d{2}\./);
  });
});
