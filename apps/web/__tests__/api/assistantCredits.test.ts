/**
 * Assistant message credits.
 *
 * Each user gets DAILY_CREDITS credits per UTC day and every message spends
 * one, whichever conversation it is sent in. The count lives in the database
 * so the limit can't be bypassed from the browser, and a failed model call
 * hands the credit back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tiny in-memory stand-ins for the two tables
const conversations = new Map<string, { id: string; userId: string }>();
const usage = new Map<string, { used: number }>();
const key = (userId: string, day: string) => `${userId}|${day}`;

vi.mock("../../app/lib/prisma", () => ({
  default: {
    assistantConversation: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `conv${conversations.size + 1}`, userId: data.userId };
        conversations.set(row.id, row);
        return { id: row.id };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = conversations.get(where.id);
        return row && row.userId === where.userId ? row : null;
      }),
    },
    assistantDailyUsage: {
      createMany: vi.fn(async ({ data }: any) => {
        for (const d of data) {
          if (!usage.has(key(d.userId, d.day))) usage.set(key(d.userId, d.day), { used: 0 });
        }
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const { userId, day } = where.userId_day;
        return usage.get(key(userId, day)) ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = usage.get(key(where.userId, where.day));
        if (!row) return { count: 0 };
        if (where.used?.lt !== undefined && !(row.used < where.used.lt)) return { count: 0 };
        if (where.used?.gt !== undefined && !(row.used > where.used.gt)) return { count: 0 };
        row.used += data.used.increment ?? -data.used.decrement;
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

import { GET, POST } from "../../app/api/assistant/route";
import { getServerSession } from "next-auth";
import { DAILY_CREDITS } from "../../app/lib/assistantCredits";

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
  conversations.clear();
  usage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));
  (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "me" } });
  create.mockResolvedValue(reply);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("assistant daily credits", () => {
  it("starts a conversation and spends one credit on the first message", async () => {
    const res = await send();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.conversationId).toBe("conv1");
    expect(body.credits).toEqual({ total: DAILY_CREDITS, used: 1, remaining: DAILY_CREDITS - 1 });
  });

  it("doesn't refill the allowance when a new chat is started", async () => {
    await send();
    const body = await (await send()).json();

    expect(body.conversationId).toBe("conv2");
    expect(body.credits.used).toBe(2);
  });

  it("refuses with 402 once the day's allowance is used, without calling the model", async () => {
    for (let i = 0; i < DAILY_CREDITS; i++) {
      expect((await send()).status).toBe(200);
    }
    create.mockClear();

    const res = await send();
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.code).toBe("OUT_OF_CREDITS");
    expect(body.credits.remaining).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("gives a full allowance again on the next UTC day", async () => {
    for (let i = 0; i < DAILY_CREDITS; i++) await send();
    vi.setSystemTime(new Date("2026-10-05T00:00:01Z"));

    const body = await (await send()).json();
    expect(body.credits.used).toBe(1);
  });

  it("counts each user separately", async () => {
    await send();
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "other" } });

    const body = await (await send()).json();
    expect(body.credits.used).toBe(1);
  });

  it("refunds the credit when the model call fails", async () => {
    await send();
    create.mockRejectedValueOnce(new Error("groq down"));

    expect((await send()).status).toBe(500);
    expect(usage.get(key("me", "2026-10-04"))!.used).toBe(1);
  });

  it("won't spend credits on someone else's conversation", async () => {
    const { conversationId } = await (await send()).json();
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "intruder" } });

    expect((await send(conversationId)).status).toBe(404);
    expect(usage.has(key("intruder", "2026-10-04"))).toBe(false);
  });

  it("reports today's allowance on GET", async () => {
    await send();
    const body = await (await GET()).json();

    expect(body.credits).toEqual({ total: DAILY_CREDITS, used: 1, remaining: DAILY_CREDITS - 1 });
  });
});
