/**
 * Assistant message credits.
 *
 * Each conversation gets CREDITS_PER_CONVERSATION credits and every user
 * message spends one. The count lives in the database so the limit can't be
 * bypassed from the browser, and a failed model call hands the credit back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny in-memory stand-in for the AssistantConversation table
type Row = { id: string; userId: string; creditsTotal: number; creditsUsed: number };
const rows = new Map<string, Row>();

vi.mock("../../app/lib/prisma", () => ({
  default: {
    assistantConversation: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `conv${rows.size + 1}`, creditsUsed: 0, ...data };
        rows.set(row.id, row);
        return { id: row.id };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = rows.get(where.id);
        return row && row.userId === where.userId ? row : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ ...rows.get(where.id)! })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = rows.get(where.id);
        if (!row) return { count: 0 };
        if (where.userId && row.userId !== where.userId) return { count: 0 };
        if (where.creditsUsed?.lt !== undefined && !(row.creditsUsed < where.creditsUsed.lt))
          return { count: 0 };
        if (where.creditsUsed?.gt !== undefined && !(row.creditsUsed > where.creditsUsed.gt))
          return { count: 0 };
        row.creditsUsed += data.creditsUsed.increment ?? -data.creditsUsed.decrement;
        return { count: 1 };
      }),
    },
  },
}));

vi.mock("../../app/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

// The route builds its Groq client at import time, before plain consts exist
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("groq-sdk", () => ({
  Groq: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create } } };
  }),
}));

process.env.GROQ_API_KEY = "test";

import { POST } from "../../app/api/assistant/route";
import { getServerSession } from "next-auth";
import { CREDITS_PER_CONVERSATION } from "../../app/lib/assistantCredits";

const reply = { choices: [{ finish_reason: "stop", message: { content: "Hi!" } }] };

function send(conversationId?: string) {
  return POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], conversationId }),
    })
  );
}

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
  (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "me" } });
  create.mockResolvedValue(reply);
});

describe("POST /api/assistant credits", () => {
  it("starts a conversation and spends one credit on the first message", async () => {
    const res = await send();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.conversationId).toBe("conv1");
    expect(body.credits).toEqual({
      total: CREDITS_PER_CONVERSATION,
      used: 1,
      remaining: CREDITS_PER_CONVERSATION - 1,
    });
  });

  it("refuses with 402 once the allowance is used, without calling the model", async () => {
    const { conversationId } = await (await send()).json();
    for (let i = 1; i < CREDITS_PER_CONVERSATION; i++) {
      expect((await send(conversationId)).status).toBe(200);
    }
    create.mockClear();

    const res = await send(conversationId);
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.code).toBe("OUT_OF_CREDITS");
    expect(body.credits.remaining).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("refunds the credit when the model call fails", async () => {
    const { conversationId } = await (await send()).json();
    create.mockRejectedValueOnce(new Error("groq down"));

    expect((await send(conversationId)).status).toBe(500);
    expect(rows.get(conversationId)!.creditsUsed).toBe(1);
  });

  it("won't spend credits on someone else's conversation", async () => {
    const { conversationId } = await (await send()).json();
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "intruder" } });

    expect((await send(conversationId)).status).toBe(404);
    expect(rows.get(conversationId)!.creditsUsed).toBe(1);
  });
});
