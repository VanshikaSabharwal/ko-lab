/**
 * Assistant tools only read data from the caller's own groups.
 *
 * get_blocked_by used to load any planning task by id, so a guessed or leaked
 * task id exposed another group's planning.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: {
    assistantConversation: {
      create: vi.fn(async () => ({ id: "conv1" })),
      findFirst: vi.fn(async () => ({ creditsTotal: 15 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => ({ creditsTotal: 15, creditsUsed: 1 })),
    },
    planningTask: { findFirst: vi.fn() },
  },
}));

vi.mock("../../app/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "me" } })) }));

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("groq-sdk", () => ({
  Groq: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create } } };
  }),
}));

process.env.GROQ_API_KEY = "test";

import { POST } from "../../app/api/assistant/route";
import prisma from "../../app/lib/prisma";

const findFirst = prisma.planningTask.findFirst as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  create
    .mockResolvedValueOnce({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: "t1",
                type: "function",
                function: { name: "get_blocked_by", arguments: JSON.stringify({ task_id: "task-x" }) },
              },
            ],
          },
        },
      ],
    })
    .mockResolvedValueOnce({ choices: [{ finish_reason: "stop", message: { content: "done" } }] });
});

function ask() {
  return POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "what blocks task-x?" }] }),
    }),
  );
}

describe("assistant get_blocked_by", () => {
  it("only looks the task up within the caller's groups", async () => {
    findFirst.mockResolvedValue(null);
    await ask();

    const where = findFirst.mock.calls[0]![0].where;
    expect(where.id).toBe("task-x");
    expect(where.group).toEqual({
      OR: [{ ownerId: "me" }, { members: { some: { userId: "me" } } }],
    });
  });

  it("reports another group's task as not found", async () => {
    findFirst.mockResolvedValue(null);
    await ask();

    // The tool result handed back to the model on the second call
    const messages = create.mock.calls[1]![0].messages;
    const toolMsg = messages.find((m: { role: string }) => m.role === "tool");
    expect(JSON.parse(toolMsg.content)).toEqual({ error: "Task not found" });
  });
});
