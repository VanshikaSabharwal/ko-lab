/**
 * "Make it live" against real (LocalStack) storage: the site that gets
 * published must be the one that's served, private files must stay out, and a
 * redeploy must not leave old files behind.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// The repo's files come from the git service and the database; only that
// source is replaced, storage itself is real.
vi.mock("../../app/lib/prisma", () => ({ default: {} }));
vi.mock("../../app/lib/workspaceFiles", () => ({ collectWorkspaceFiles: vi.fn() }));

import {
  publishSnapshot,
  readSnapshotFile,
  updateSnapshotFile,
  deletePreviewObjects,
  PreviewError,
} from "../../app/lib/livePreview";
import { collectWorkspaceFiles } from "../../app/lib/workspaceFiles";

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** The repo as the git service would hand it over. */
function repo(files: Record<string, string>) {
  mocked(collectWorkspaceFiles).mockResolvedValue(
    Object.entries(files).map(([path, content]) => ({
      path,
      size: Buffer.byteLength(content),
      read: async () => Buffer.from(content),
    })),
  );
}

const text = async (previewId: string, path: string) => {
  const bytes = await readSnapshotFile(previewId, path);
  return bytes === null ? null : Buffer.from(bytes).toString("utf-8");
};

let previewId = "";
let n = 0;
const deploy = () => publishSnapshot({ previewId, groupId: "g", userId: "u", branch: "main" });

beforeEach(() => {
  previewId = `preview-${Date.now()}-${n++}`;
  vi.clearAllMocks();
});

describe("Make it live", () => {
  it("serves every file of the site exactly as it is in the repo", async () => {
    repo({
      "index.html": "<h1>Hello</h1>",
      "css/style.css": "body { color: red }",
      "js/app.js": 'console.log("hi")',
    });

    expect(await deploy()).toEqual({ rootDir: "" });

    expect(await text(previewId, "index.html")).toBe("<h1>Hello</h1>");
    expect(await text(previewId, "css/style.css")).toBe("body { color: red }");
    expect(await text(previewId, "js/app.js")).toBe('console.log("hi")');
  });

  it("never publishes secrets, dotfiles or node_modules", async () => {
    repo({
      "index.html": "<h1>Hello</h1>",
      ".env": "DATABASE_URL=secret",
      ".git/config": "[core]",
      "config/.secrets.json": "{}",
      "node_modules/lib/index.js": "module.exports = {}",
    });

    await deploy();

    expect(await text(previewId, "index.html")).toBe("<h1>Hello</h1>");
    expect(await text(previewId, ".env")).toBeNull();
    expect(await text(previewId, ".git/config")).toBeNull();
    expect(await text(previewId, "config/.secrets.json")).toBeNull();
    expect(await text(previewId, "node_modules/lib/index.js")).toBeNull();
  });

  it("serves a built site from its dist folder, without the source around it", async () => {
    repo({
      "dist/index.html": "<h1>Built</h1>",
      "dist/assets/app.js": "built()",
      "src/main.js": "source()",
      "README.md": "# readme",
    });

    expect(await deploy()).toEqual({ rootDir: "dist" });

    expect(await text(previewId, "index.html")).toBe("<h1>Built</h1>");
    expect(await text(previewId, "assets/app.js")).toBe("built()");
    expect(await text(previewId, "src/main.js")).toBeNull();
    expect(await text(previewId, "README.md")).toBeNull();
  });

  it("a redeploy updates changed files and removes deleted ones", async () => {
    repo({ "index.html": "v1", "old-page.html": "gone soon", "keep.css": "same" });
    await deploy();

    repo({ "index.html": "v2", "keep.css": "same", "new-page.html": "new" });
    await deploy();

    expect(await text(previewId, "index.html")).toBe("v2");
    expect(await text(previewId, "new-page.html")).toBe("new");
    expect(await text(previewId, "keep.css")).toBe("same");
    expect(await text(previewId, "old-page.html")).toBeNull();
  });

  it("keeps two people's sites apart", async () => {
    repo({ "index.html": "mine" });
    await deploy();
    const mine = previewId;

    previewId = `${mine}-other`;
    repo({ "index.html": "theirs" });
    await deploy();

    expect(await text(mine, "index.html")).toBe("mine");
    expect(await text(previewId, "index.html")).toBe("theirs");
  });

  it("saving a file updates just that file on the live site", async () => {
    repo({ "index.html": "<h1>Old</h1>", "style.css": "a{}" });
    await deploy();

    expect(await updateSnapshotFile(previewId, "", "index.html", "<h1>New</h1>")).toBe(true);

    expect(await text(previewId, "index.html")).toBe("<h1>New</h1>");
    expect(await text(previewId, "style.css")).toBe("a{}");
  });

  it("a save outside the site folder, or of a private file, changes nothing", async () => {
    repo({ "dist/index.html": "<h1>Built</h1>" });
    await deploy();

    expect(await updateSnapshotFile(previewId, "dist", "src/main.js", "x")).toBe(false);
    expect(await updateSnapshotFile(previewId, "dist", "dist/.env", "SECRET=1")).toBe(false);

    expect(await text(previewId, "main.js")).toBeNull();
    expect(await text(previewId, ".env")).toBeNull();
  });

  it("taking the site down removes all of its files", async () => {
    repo({ "index.html": "<h1>Hello</h1>", "css/style.css": "a{}" });
    await deploy();

    await deletePreviewObjects(previewId);

    expect(await text(previewId, "index.html")).toBeNull();
    expect(await text(previewId, "css/style.css")).toBeNull();
  });

  it("returns null for a page the site doesn't have", async () => {
    repo({ "index.html": "<h1>Hello</h1>" });
    await deploy();
    expect(await text(previewId, "nope.html")).toBeNull();
  });

  it("refuses a project with no index.html and publishes nothing", async () => {
    repo({ "index.js": "server()", "package.json": "{}" });

    await expect(deploy()).rejects.toBeInstanceOf(PreviewError);
    expect(await text(previewId, "index.js")).toBeNull();
  });

  it("refuses a project that needs a build step and publishes nothing", async () => {
    repo({ "index.html": '<script type="module" src="/src/main.tsx"></script>', "src/main.tsx": "x" });

    await expect(deploy()).rejects.toBeInstanceOf(PreviewError);
    expect(await text(previewId, "index.html")).toBeNull();
  });
});
