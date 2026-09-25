// @vitest-environment node
/**
 * "Make it live" static-site previews.
 *
 * The serving route is where the rules live: a private link opens only for its
 * author, a share link opens for anyone until it runs out, and every response
 * is sandboxed so the site can't act with the viewer's session.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/lib/prisma", () => ({
  default: { livePreview: { findFirst: vi.fn() } },
}));
vi.mock("../../app/lib/apiAuth", () => ({ getSessionUser: vi.fn() }));
vi.mock("../../app/lib/s3", () => ({ s3Client: { send: vi.fn() } }));
vi.mock("../../app/lib/gitClient", () => ({ listFiles: vi.fn(), readFileRawBuffer: vi.fn() }));
vi.mock("../../app/lib/draftStore", () => ({ draftContentFor: vi.fn() }));

import { GET } from "../../app/preview/[token]/[[...path]]/route";
import { findSiteRoot, isFullyExpired, needsBuildStep } from "../../app/lib/livePreview";
import prisma from "../../app/lib/prisma";
import { getSessionUser } from "../../app/lib/apiAuth";
import { s3Client } from "../../app/lib/s3";

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);

const preview = {
  id: "p1",
  userId: "author",
  token: "priv",
  expiresAt: inMinutes(10),
  shareToken: "pub",
  shareExpiresAt: inMinutes(60),
};

function get(token: string, path?: string[]) {
  return GET(new Request(`http://localhost:3000/preview/${token}/${(path ?? []).join("/")}`), {
    params: { token, path },
  });
}

describe("findSiteRoot", () => {
  it("prefers the repo root, then build output folders", () => {
    expect(findSiteRoot(["index.html", "dist/index.html"])).toBe("");
    expect(findSiteRoot(["src/main.ts", "dist/index.html"])).toBe("dist");
  });

  it("falls back to the shallowest index.html, or null", () => {
    expect(findSiteRoot(["site/a/index.html", "site/index.html"])).toBe("site");
    expect(findSiteRoot(["README.md"])).toBeNull();
  });
});

describe("needsBuildStep", () => {
  it("flags bundler entry points but not plain scripts", () => {
    expect(needsBuildStep('<script type="module" src="/src/main.tsx"></script>')).toBe(true);
    expect(needsBuildStep('<script src="app.js"></script>')).toBe(false);
  });
});

describe("isFullyExpired", () => {
  it("keeps a preview while its share link is still live", () => {
    expect(isFullyExpired({ expiresAt: inMinutes(-1), shareExpiresAt: inMinutes(5) })).toBe(false);
    expect(isFullyExpired({ expiresAt: inMinutes(-1), shareExpiresAt: null })).toBe(true);
  });
});

describe("GET /preview/[token]/...", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(prisma.livePreview.findFirst).mockResolvedValue(preview);
    mocked(s3Client.send).mockResolvedValue({
      Body: { transformToByteArray: async () => new TextEncoder().encode("<h1>hi</h1>") },
    });
  });

  it("serves the author their private site, sandboxed", async () => {
    mocked(getSessionUser).mockResolvedValue({ id: "author" });
    const res = await get("priv", ["index.html"]);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>hi</h1>");
    expect(res.headers.get("Content-Security-Policy")).toMatch(/^sandbox allow-scripts/);
    expect(res.headers.get("Content-Security-Policy")).not.toMatch(/allow-same-origin/);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("refuses a private page to anyone else", async () => {
    mocked(getSessionUser).mockResolvedValue({ id: "someone-else" });
    expect((await get("priv", ["index.html"])).status).toBe(403);
  });

  it("serves the share link without a session", async () => {
    mocked(getSessionUser).mockResolvedValue(null);
    expect((await get("pub", ["index.html"])).status).toBe(200);
  });

  it("says a link has expired", async () => {
    mocked(prisma.livePreview.findFirst).mockResolvedValue({ ...preview, expiresAt: inMinutes(-1) });
    mocked(getSessionUser).mockResolvedValue({ id: "author" });
    const res = await get("priv", ["index.html"]);
    expect(res.status).toBe(410);
    expect(await res.text()).toMatch(/Make it live/);
  });

  it("sends the bare link to index.html so relative paths resolve", async () => {
    const res = await get("pub");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/preview/pub/index.html");
  });

  it("404s an unknown token", async () => {
    mocked(prisma.livePreview.findFirst).mockResolvedValue(null);
    expect((await get("nope", ["index.html"])).status).toBe(404);
  });
});
