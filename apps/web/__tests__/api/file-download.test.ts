/**
 * The download route proxies raw file bytes from the git workspace service
 * so the browser can save the file with a Content-Disposition attachment.
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
  readFileRawBuffer: vi.fn(),
}));

import { GET } from "../../app/api/file-download/route";
import { getSessionUser, isGroupMember } from "../../app/lib/apiAuth";
import { resolveBranch, readFileRawBuffer } from "../../app/lib/gitClient";

function request(path: string, group = "g1", ref?: string): Request {
  const params = new URLSearchParams({ group, path });
  if (ref) params.set("ref", ref);
  return new Request(`http://localhost:3000/api/file-download?${params.toString()}`);
}

const SAMPLE_BYTES = Buffer.from("file content here");

beforeEach(() => {
  vi.clearAllMocks();
  (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "u1" });
  (isGroupMember as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (resolveBranch as ReturnType<typeof vi.fn>).mockResolvedValue("main");
  (readFileRawBuffer as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_BYTES);
});

describe("GET /api/file-download", () => {
  it("sends Content-Disposition: attachment so the browser saves the file", async () => {
    const res = await GET(request("img/photo.jpg"));

    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain('filename="photo.jpg"');
  });

  it("neutralises quotes in a filename so the header can't be broken", async () => {
    const res = await GET(request('weird".name.txt'));
    const disposition = res.headers.get("content-disposition") ?? "";
    // The raw quote must not survive into the quoted string.
    expect(disposition).toContain('filename="weird_.name.txt"');
  });

  it("carries a non-ASCII name in filename*", async () => {
    const res = await GET(request("café.txt"));
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain(encodeURIComponent("café.txt"));
  });

  it("sets Content-Type from extension", async () => {
    const res = await GET(request("logo.png"));
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("defaults to application/octet-stream for unknown types", async () => {
    const res = await GET(request("file.unknown"));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("does not cache private file bytes", async () => {
    const res = await GET(request("secret.env"));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("passes a branch ref through to resolveBranch", async () => {
    await GET(request("a.txt", "g1", "develop"));
    expect(resolveBranch).toHaveBeenCalledWith("g1", "develop");
  });

  it("returns the buffer with correct Content-Length", async () => {
    const res = await GET(request("a.txt"));
    expect(res.headers.get("content-length")).toBe(String(SAMPLE_BYTES.byteLength));
  });

  it("refuses a caller who isn't a group member", async () => {
    (isGroupMember as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const res = await GET(request("a.txt"));
    expect(res.status).toBe(403);
  });

  it("rejects an anonymous caller", async () => {
    (getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(request("a.txt"));
    expect(res.status).toBe(401);
  });
});
