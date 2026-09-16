/**
 * The route is now a thin pass-through to the git workspace service. These
 * tests verify the route correctly proxies responses, attaches the image
 * downloadUrl, and honours auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(),
  isGroupMember: vi.fn(),
  unauthorized: () => new Response(null, { status: 401 }),
  forbidden: () => new Response(null, { status: 403 }),
}));

vi.mock("../../app/lib/gitClient", () => ({
  resolveBranch: vi.fn(async (_groupId: string, ref?: string | null) => ref ?? "main"),
  readFile: vi.fn(),
}));

import { POST } from "../../app/api/file-content/route";
import { getSessionUser, isGroupMember } from "../../app/lib/apiAuth";
import { readFile, resolveBranch } from "../../app/lib/gitClient";

function request(filePath: string, ref?: string): Request {
  const body: Record<string, string> = { groupId: "g1", filePath };
  if (ref) body.ref = ref;
  return new Request("http://localhost:3000/api/file-content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
  (isGroupMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

describe("POST /api/file-content", () => {
  it("flags an image and attaches same-origin downloadUrl", async () => {
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      binary: true,
      isImage: true,
      size: 80 * 1024 * 1024,
      name: "photo.jpg",
    });

    const res = await POST(request("img/photo.jpg"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.binary).toBe(true);
    expect(body.isImage).toBe(true);
    expect(body.content).toBeUndefined();
    expect(body.downloadUrl).toContain("/api/file-download");
    expect(body.downloadUrl).toContain("group=g1");
    expect(body.downloadUrl).toContain("path=img%2Fphoto.jpg");
    expect((readFile as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("passes through non-image text files unchanged", async () => {
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: '{"a":1}',
      size: 10,
      name: "config.json",
    });

    const body = await (await POST(request("app/config.json"))).json();
    expect(body.content).toBe('{"a":1}');
    expect(body.readOnly).toBeFalsy();
    expect(body.binary).toBeUndefined();
    // No downloadUrl attached for text files
    expect(body.downloadUrl).toBeUndefined();
  });

  it("passes through heavy/large text files with heavy flag", async () => {
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "x".repeat(3 * 1024 * 1024),
      size: 3 * 1024 * 1024,
      heavy: true,
      readOnly: true,
      name: "huge.log",
    });

    const body = await (await POST(request("huge.log"))).json();
    expect(body.heavy).toBe(true);
    expect(body.readOnly).toBe(true);
  });

  it("passes through binary non-image files without downloadUrl", async () => {
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      binary: true,
      isImage: false,
      size: 500,
      name: "archive.zip",
    });

    const body = await (await POST(request("archive.zip"))).json();
    expect(body.binary).toBe(true);
    expect(body.isImage).toBe(false);
    // Non-image binaries don't get downloadUrl from the route
    expect(body.downloadUrl).toBeUndefined();
  });

  it("forwards ref to resolveBranch", async () => {
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "hello",
      size: 5,
      name: "a.txt",
    });

    await POST(request("a.txt", "develop"));
    expect(resolveBranch).toHaveBeenCalledWith("g1", "develop");
  });

  it("refuses a caller who isn't a group member", async () => {
    (isGroupMember as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await POST(request("a.txt"));
    expect(res.status).toBe(403);
  });

  it("rejects an anonymous caller", async () => {
    (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(request("a.txt"));
    expect(res.status).toBe(401);
  });

  it("returns 400 when filePath is missing", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/file-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: "g1" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
