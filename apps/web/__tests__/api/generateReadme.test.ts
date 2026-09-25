/**
 * README generation reads the repo tree in one request.
 *
 * It used to walk the Contents API a directory at a time with no limit, so a
 * large repo made hundreds of sequential GitHub calls and timed out or hit the
 * owner's rate limit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: {
    group: {
      findUnique: vi.fn(async () => ({
        githubRepo: "repo",
        ownerName: "owner",
        githubAccessToken: "enc",
      })),
    },
  },
}));

vi.mock("../../app/lib/encryption", () => ({
  decrypt: vi.fn(() => "token"),
  extractRepoName: vi.fn((v: string) => v),
}));

vi.mock("../../app/lib/apiAuth", () => ({
  getSessionUser: vi.fn(async () => ({ id: "me" })),
  isGroupMember: vi.fn(async () => true),
  unauthorized: () => new Response(null, { status: 401 }),
  forbidden: () => new Response(null, { status: 403 }),
}));

import { POST } from "../../app/api/generate-readme/route";

const tree = [
  { type: "blob", path: "package.json" },
  { type: "tree", path: "src" },
  { type: "blob", path: "src/index.ts" },
  { type: "blob", path: "node_modules/react/index.js" },
  { type: "blob", path: "dist/bundle.js" },
  ...Array.from({ length: 600 }, (_, i) => ({ type: "blob", path: `src/gen/file${i}.ts` })),
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  delete process.env.GROQ_API_KEY; // use the offline template README
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes("/git/trees/")
        ? { tree, truncated: false }
        : { encoding: "base64", content: Buffer.from('{"name":"demo"}').toString("base64") },
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
});

function generate() {
  return POST(
    new Request("http://localhost/api/generate-readme", {
      method: "POST",
      body: JSON.stringify({ groupId: "g1" }),
    }),
  );
}

describe("POST /api/generate-readme", () => {
  it("lists the repo with one recursive tree request", async () => {
    const res = await generate();
    expect(res.status).toBe(200);

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.filter((u) => u.includes("/git/trees/"))).toEqual([
      "https://api.github.com/repos/owner/repo/git/trees/HEAD?recursive=1",
    ]);
    // Only key root files are read individually — never a directory walk
    expect(urls.filter((u) => u.includes("/contents/"))).toEqual([
      "https://api.github.com/repos/owner/repo/contents/package.json",
    ]);
  });

  it("leaves out generated folders and caps the file list", async () => {
    const { content } = await (await generate()).json();

    expect(content).not.toContain("node_modules");
    expect(content).not.toContain("dist/bundle.js");
    // The offline template reports how many files it saw
    expect(content).toContain("400 files detected");
  });
});
