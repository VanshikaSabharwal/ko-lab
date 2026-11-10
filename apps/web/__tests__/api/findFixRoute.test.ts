/**
 * POST /api/editor/find-fix: auth → validation → rate limit, then a cached or
 * live SearchApi search under a monthly cap, then a Groq fix. Secrets must
 * never reach either service, and failed searches must not burn quota.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getSessionUser = vi.fn(async () => ({ id: "me" }) as { id: string } | null);
vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: () => getSessionUser(),
  unauthorized: () => new Response(null, { status: 401 }),
}));

const store = {
  limit: vi.fn(async () => ({ success: true, remaining: 4, reset: Date.now() + 1000 })),
  getCache: vi.fn(async (): Promise<unknown> => null),
  setCache: vi.fn(async () => {}),
  reserveMonthly: vi.fn(async () => true),
  releaseMonthly: vi.fn(async () => {}),
};
let storeAvailable = true;
vi.mock("../../app/lib/redis", () => ({
  getFixStore: () => (storeAvailable ? store : null),
  monthlyCap: () => 90,
}));

import { POST } from "../../app/api/editor/find-fix/route";

const SEARCH_RESULTS = {
  organic_results: [
    { title: "Fix A", link: "https://blog.example.com/a", snippet: "do a" },
    { title: "Fix B", link: "https://stackoverflow.com/q/1", snippet: "do b" },
  ],
};

function groqReply(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

const fetchMock = vi.fn();

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/editor/find-fix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const validBody = { error: "TypeError: x is not a function", language: "JavaScript", source: "manual" };

beforeEach(() => {
  vi.clearAllMocks();
  storeAvailable = true;
  getSessionUser.mockImplementation(async () => ({ id: "me" }));
  store.limit.mockImplementation(async () => ({ success: true, remaining: 4, reset: Date.now() + 1000 }));
  store.getCache.mockImplementation(async () => null);
  store.reserveMonthly.mockImplementation(async () => true);
  process.env.SEARCHAPI_KEY = "search-key-123";
  process.env.GROQ_API_KEY = "groq-key-456";
  fetchMock.mockImplementation(async (url: string | URL) => {
    if (String(url).startsWith("https://www.searchapi.io/")) {
      return new Response(JSON.stringify(SEARCH_RESULTS), { status: 200 });
    }
    return groqReply("**Cause** bad call [2]. **Fix** ... [9]");
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const searchCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("searchapi.io"));
const groqCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("api.groq.com"));

describe("POST /api/editor/find-fix", () => {
  it("rejects signed-out users", async () => {
    getSessionUser.mockImplementation(async () => null);
    const res = await call(validBody);
    expect(res.status).toBe(401);
    expect(store.limit).not.toHaveBeenCalled();
  });

  it("validates the body before counting against the rate limit", async () => {
    const res = await call({ ...validBody, error: "e".repeat(2001) });
    expect(res.status).toBe(400);
    expect(store.limit).not.toHaveBeenCalled();
    expect((await call({ ...validBody, source: "nope" })).status).toBe(400);
    expect((await call({ source: "manual" })).status).toBe(400);
    expect(store.limit).not.toHaveBeenCalled();
  });

  it("returns 503 when the store isn't configured", async () => {
    storeAvailable = false;
    expect((await call(validBody)).status).toBe(503);
  });

  it("returns 429 once the per-user limit is used, even for a cached error", async () => {
    store.getCache.mockImplementation(async () => [{ title: "c", link: "https://x.dev", snippet: "" }]);
    store.limit.mockImplementation(async () => ({ success: false, remaining: 0, reset: Date.now() + 30_000 }));
    const res = await call(validBody);
    expect(res.status).toBe(429);
    expect((await res.json()).retryAfter).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches, caches, and returns links plus the AI fix", async () => {
    const res = await call(validBody);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.map((r: { title: string }) => r.title)).toEqual(["Fix B", "Fix A"]);
    expect(data.cached).toBe(false);
    expect(data.remaining).toBe(4);
    expect(store.reserveMonthly).toHaveBeenCalledOnce();
    expect(store.setCache).toHaveBeenCalledOnce();
    // [9] doesn't exist among 2 results
    expect(data.aiFix).toContain("[2]");
    expect(data.aiFix).not.toContain("[9]");
  });

  it("sends the SearchApi key in the Authorization header, not the URL", async () => {
    await call(validBody);
    const [url, init] = searchCalls()[0]!;
    expect(String(url)).not.toContain("search-key-123");
    expect(String(url)).not.toContain("api_key");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer search-key-123" });
  });

  it("searches only the normalized error", async () => {
    await call({ ...validBody, error: "TypeError: myFn is not a function\n    at /home/me/app.js:3:1" });
    const q = new URL(String(searchCalls()[0]![0])).searchParams.get("q");
    expect(q).toBe("TypeError: is not a function JavaScript");
  });

  it("never sends secrets to SearchApi or Groq", async () => {
    await call({
      error: "Error: connect ECONNREFUSED postgres://admin:hunter2@db:5432 token=sk-live-abcdefghijklmnop1234",
      snippet: "const url = 'postgres://admin:hunter2@db';\nAPI_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123",
      source: "run",
    });
    for (const [url, init] of fetchMock.mock.calls) {
      const sent = String(url) + String((init as RequestInit | undefined)?.body ?? "");
      expect(sent).not.toContain("hunter2");
      expect(sent).not.toContain("sk-live-abcdefghijklmnop1234");
      expect(sent).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123");
    }
  });

  it("serves a cache hit without calling SearchApi, but still calls Groq", async () => {
    store.getCache.mockImplementation(async () => [{ title: "c", link: "https://x.dev", snippet: "" }]);
    const data = await (await call(validBody)).json();
    expect(data.cached).toBe(true);
    expect(searchCalls()).toHaveLength(0);
    expect(store.reserveMonthly).not.toHaveBeenCalled();
    expect(groqCalls()).toHaveLength(1);
  });

  it("answers AI-only when the monthly cap is reached", async () => {
    store.reserveMonthly.mockImplementation(async () => false);
    const data = await (await call(validBody)).json();
    expect(data.searchLimited).toBe(true);
    expect(data.results).toEqual([]);
    expect(data.aiFix).toBeTruthy();
    expect(searchCalls()).toHaveLength(0);
    expect(store.releaseMonthly).not.toHaveBeenCalled();
  });

  it.each([
    ["a 500", async () => new Response("boom", { status: 500 })],
    [
      "a timeout",
      async () => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      },
    ],
  ])("gives quota back when SearchApi fails with %s", async (_label, failure) => {
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).includes("searchapi.io") ? failure() : groqReply("AI fix"),
    );
    const data = await (await call(validBody)).json();
    expect(store.releaseMonthly).toHaveBeenCalledOnce();
    expect(store.setCache).not.toHaveBeenCalled();
    expect(data.searchFailed).toBe(true);
    expect(data.aiFix).toBe("AI fix");
  });

  it("still returns the links when Groq fails", async () => {
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).includes("searchapi.io")
        ? new Response(JSON.stringify(SEARCH_RESULTS), { status: 200 })
        : new Response(JSON.stringify({ error: { message: "down" } }), { status: 503 }),
    );
    const data = await (await call(validBody)).json();
    expect(data.results).toHaveLength(2);
    expect(data.aiFix).toBeNull();
  });

  it("fences search results and code as untrusted data in the prompt", async () => {
    await call({ ...validBody, snippet: "const a = 1;" });
    const payload = JSON.parse(String((groqCalls()[0]![1] as RequestInit).body));
    expect(payload.messages[0].content).toMatch(/untrusted DATA/);
    expect(payload.messages[1].content).toContain("<search_results>");
    expect(payload.messages[1].content).toContain("<user_code>");
  });
});
