/**
 * Covers the byte-range endpoint behind the virtualized large-file viewer.
 *
 * The contract that matters: it asks GitHub for a range, never the whole file,
 * and trims partial lines at the chunk edges so the viewer never paints half a
 * line — reporting the byte offsets of what it actually returned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: { group: { findUnique: vi.fn() } },
}));

vi.mock("../../app/lib/encryption", () => ({
  decrypt: vi.fn((v: string) => v),
  extractRepoName: vi.fn((v: string) => v),
}));

vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(),
  isGroupMember: vi.fn(),
  unauthorized: () => new Response(null, { status: 401 }),
  forbidden: () => new Response(null, { status: 403 }),
}));

import { POST } from "../../app/api/file-chunk/route";
import prisma from "../../app/lib/prisma";
import { getSessionUser, isGroupMember } from "../../app/lib/apiAuth";

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/file-chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Fakes a 206 range response over `total` bytes. */
function mockRange(text: string, total: number, status = 206) {
  const captured: { headers?: Record<string, string> } = {};
  global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    captured.headers = init?.headers as Record<string, string>;
    const buf = Buffer.from(text);
    return {
      ok: true,
      status,
      headers: {
        get: (h: string) =>
          h.toLowerCase() === "content-range"
            ? `bytes 0-${buf.length - 1}/${total}`
            : null,
      },
      arrayBuffer: async () => buf,
    };
  }) as unknown as typeof fetch;
  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
  (isGroupMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (prisma.group.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    githubRepo: "repo",
    ownerName: "owner",
    githubAccessToken: "token",
  });
});

describe("POST /api/file-chunk", () => {
  it("sends a Range header for the requested window", async () => {
    const captured = mockRange("hello\nworld\n", 1_000_000);

    await POST(
      request({ groupId: "g1", filePath: "big.log", start: 1024, length: 256 }),
    );

    expect(captured.headers?.Range).toBe("bytes=1024-1279");
    // Raw bytes, not the JSON envelope — the envelope can't be ranged.
    expect(captured.headers?.Accept).toBe("application/vnd.github.raw");
  });

  it("trims a partial leading line for a mid-file chunk", async () => {
    // The window opens mid-line; that fragment must be dropped.
    mockRange("tail-of-line\nfull line\n", 1_000_000);

    const body = await (
      await POST(request({ groupId: "g1", filePath: "f.log", start: 5000 }))
    ).json();

    expect(body.text.startsWith("full line")).toBe(true);
    // Reported start accounts for the dropped fragment, so chunks stitch
    // together without overlap.
    expect(body.start).toBe(5000 + "tail-of-line\n".length);
  });

  it("keeps the leading fragment when the chunk starts at byte 0", async () => {
    mockRange("first line\nsecond\n", 1_000_000);

    const body = await (
      await POST(request({ groupId: "g1", filePath: "f.log", start: 0 }))
    ).json();

    expect(body.text.startsWith("first line")).toBe(true);
    expect(body.start).toBe(0);
  });

  it("keeps the trailing fragment at end of file", async () => {
    const text = "a\nlast line no newline";
    // total equals what was returned, so this window reaches EOF.
    mockRange(text, text.length);

    const body = await (
      await POST(request({ groupId: "g1", filePath: "f.log", start: 0 }))
    ).json();

    expect(body.text).toContain("last line no newline");
  });

  it("reports total size from content-range", async () => {
    mockRange("x\n", 42_000_000);

    const body = await (
      await POST(request({ groupId: "g1", filePath: "f.log", start: 0 }))
    ).json();

    expect(body.total).toBe(42_000_000);
    expect(body.ranged).toBe(true);
  });

  it("slices locally when the server ignores Range", async () => {
    // 200 means the whole file came back; the route must still return only the
    // requested window so the client's offsets stay correct.
    mockRange("0123456789abcdef", 16, 200);

    const body = await (
      await POST(request({ groupId: "g1", filePath: "f.log", start: 4, length: 4 }))
    ).json();

    expect(body.ranged).toBe(false);
    expect(body.text).toBe("4567");
  });

  it("caps an oversized length request", async () => {
    const captured = mockRange("x\n", 100_000_000);

    await POST(
      request({
        groupId: "g1",
        filePath: "f.log",
        start: 0,
        length: 999_999_999,
      }),
    );

    const range = captured.headers?.Range ?? "";
    const end = Number(range.split("-")[1]);
    // Clamped to MAX_CHUNK (4 × 256 KB), not the requested gigabyte.
    expect(end).toBe(4 * 256 * 1024 - 1);
  });

  it("rejects a request without a start offset", async () => {
    const res = await POST(request({ groupId: "g1", filePath: "f.log" }));
    expect(res.status).toBe(400);
  });

  it("refuses a caller who isn't a group member", async () => {
    (isGroupMember as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(
      request({ groupId: "g1", filePath: "f.log", start: 0 }),
    );
    expect(res.status).toBe(403);
  });
});

/**
 * filePath goes into a GitHub API URL that carries the owner's token. URLs
 * resolve `..`, so an unchecked path escaped the group's repo to any repo or
 * endpoint the token can reach.
 */
describe("POST /api/file-chunk path safety", () => {
  it.each([
    "../../../other-repo/contents/.env",
    "src/../../../../user/emails",
    "%2e%2e/%2e%2e/secret",
    "a//b",
    "./x",
    "dir\\..\\x",
  ])("rejects %s without calling GitHub", async (filePath) => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(request({ groupId: "g1", filePath, start: 0 }));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("encodes each segment so ? and # can't change the URL", async () => {
    mockRange("x\n", 2);
    await POST(request({ groupId: "g1", filePath: "docs/what?#.md", start: 0 }));

    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe("https://api.github.com/repos/owner/repo/contents/docs/what%3F%23.md");
  });

  it("still accepts a normal nested path, including a literal %", async () => {
    mockRange("x\n", 2);
    const res = await POST(request({ groupId: "g1", filePath: "logs/100%.log", start: 0 }));

    expect(res.status).toBe(200);
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe("https://api.github.com/repos/owner/repo/contents/logs/100%25.log");
  });
});
