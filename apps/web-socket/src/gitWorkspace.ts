import { promises as fs } from "fs";
import path from "path";
import { simpleGit, SimpleGit } from "simple-git";

export const WORKSPACE_ROOT = process.env.GIT_WORKSPACE_ROOT || "/data/workspaces";

// ── Per-group lock ────────────────────────────────────────────────────────────
// Render is a single box — serialize git ops per group via promise chain.
const locks = new Map<string, Promise<unknown>>();

export function withGroupLock<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(groupId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(groupId, next.catch(() => {}));
  return next;
}

// ── Branch / path safety ──────────────────────────────────────────────────────
const SAFE_BRANCH = /^[a-zA-Z0-9][a-zA-Z0-9_.\/-]*$/;

export function branchDir(groupId: string, branch: string): string {
  if (!SAFE_BRANCH.test(branch)) throw new Error("Invalid branch name");
  return path.join(WORKSPACE_ROOT, groupId, branch);
}

export function safeResolve(dir: string, filePath: string): string {
  const abs = path.resolve(dir, filePath);
  if (!abs.startsWith(dir + path.sep) && abs !== dir) {
    throw new Error("Invalid file path");
  }
  return abs;
}

// ── Clone / pull ──────────────────────────────────────────────────────────────

/**
 * Resolve the repo's default branch via `git ls-remote --symref`, which is a
 * git-protocol op (not the REST API), so it costs no GitHub API rate limit.
 */
export async function resolveDefaultBranch(repoUrl: string): Promise<string> {
  try {
    const output = await simpleGit().raw([
      "ls-remote",
      "--symref",
      repoUrl,
      "HEAD",
    ]);
    const m = output.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/);
    if (m?.[1]) return m[1];
  } catch {
    /* fall through */
  }
  return "main";
}

export async function ensureClone(
  groupId: string,
  branch: string,
  repoUrl: string,
): Promise<string> {
  const dir = branchDir(groupId, branch);

  if (await fs.stat(path.join(dir, ".git")).catch(() => null)) {
    // Already cloned — refresh remote URL (token may have rotated) and pull.
    const git = simpleGit(dir);
    await git.remote(["set-url", "origin", repoUrl]);
    await git.pull("origin", branch).catch(() => {});
    return dir;
  }

  await fs.mkdir(path.dirname(dir), { recursive: true });
  await simpleGit().clone(repoUrl, dir, [
    "--branch",
    branch,
    "--single-branch",
    "--depth",
    "1",
  ]);
  return dir;
}

// ── File tree walk ────────────────────────────────────────────────────────────

export async function walkTree(
  dir: string,
): Promise<{ name: string; path: string; size: number; type: string }[]> {
  const out: { name: string; path: string; size: number; type: string }[] = [];

  async function recurse(folder: string, base: string) {
    for (const e of await fs.readdir(folder, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const abs = path.join(folder, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await recurse(abs, rel);
      } else {
        const { size } = await fs.stat(abs);
        out.push({ name: e.name, path: rel, size, type: "file" });
      }
    }
  }

  await recurse(dir, "");
  return out;
}

// ── File content read ─────────────────────────────────────────────────────────

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico",
  "pdf", "zip", "gz", "tar", "tgz", "bz2", "7z", "rar",
  "mp3", "mp4", "wav", "ogg", "webm", "mov", "avi", "flac",
  "woff", "woff2", "ttf", "otf", "eot",
  "pyc", "class", "jar", "wasm", "so", "dll", "dylib", "exe", "bin",
  "sqlite", "db", "psd", "sketch", "fig",
]);

function extensionOf(filePath: string): string {
  const base = filePath.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function looksBinary(buf: Buffer, ext: string): boolean {
  if (BINARY_EXTENSIONS.has(ext)) return true;
  return buf.subarray(0, 8000).includes(0);
}

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico",
]);

// Size tiers — same thresholds as the Vercel-side githubFiles.ts
const EDITABLE_MAX = 5 * 1024 * 1024;
const CONTENTS_API_MAX = 1024 * 1024;

export interface ContentResult {
  content?: string;
  binary?: boolean;
  isImage?: boolean;
  size: number;
  name: string;
  downloadUrl?: string;
  heavy?: boolean;
  readOnly?: boolean;
}

export async function readFileContent(
  groupId: string,
  branch: string,
  filePath: string,
): Promise<ContentResult> {
  const dir = branchDir(groupId, branch);
  const abs = safeResolve(dir, filePath);
  const name = filePath.split("/").pop() ?? "";
  const ext = extensionOf(filePath);
  const { size } = await fs.stat(abs);

  if (BINARY_EXTENSIONS.has(ext)) {
    return {
      binary: true,
      isImage: IMAGE_EXTENSIONS.has(ext),
      size,
      name,
    };
  }

  if (size > EDITABLE_MAX) {
    // Still readable from disk — local read, no API rate limit.
    // Serve as text but flag as read-only so CodeMirror doesn't parse/lint.
    const buf = await fs.readFile(abs);
    if (looksBinary(buf, ext)) {
      return { binary: true, isImage: false, size, name };
    }
    return {
      content: buf.toString("utf-8"),
      size,
      heavy: size > CONTENTS_API_MAX,
      readOnly: true,
      name,
    };
  }

  const buf = await fs.readFile(abs);
  if (looksBinary(buf, ext)) {
    return { binary: true, isImage: false, size, name };
  }
  return {
    content: buf.toString("utf-8"),
    size,
    heavy: size > CONTENTS_API_MAX,
    name,
  };
}

// ── Raw file read (for image preview downloadUrl) ─────────────────────────────

export async function readFileRaw(
  groupId: string,
  branch: string,
  filePath: string,
): Promise<Buffer> {
  const dir = branchDir(groupId, branch);
  const abs = safeResolve(dir, filePath);
  return fs.readFile(abs);
}
