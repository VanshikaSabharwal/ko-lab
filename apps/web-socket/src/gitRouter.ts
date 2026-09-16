import { Router } from "express";
import express from "express";
import { timingSafeEqual } from "crypto";
import {
  withGroupLock,
  ensureClone,
  resolveDefaultBranch,
  walkTree,
  readFileContent,
  readFileRaw,
  branchDir,
} from "./gitWorkspace";

// ── Service-to-service auth ───────────────────────────────────────────────────
// The Vercel app is the only caller; validate a shared bearer token.
const SECRET = process.env.GIT_SERVICE_SECRET || "";

const git = Router();

git.use((req, res, next) => {
  const h = req.headers.authorization || "";
  const given = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "");
  const expected = Buffer.from(SECRET);
  if (
    !SECRET ||
    given.length !== expected.length ||
    !timingSafeEqual(new Uint8Array(given), new Uint8Array(expected))
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

git.use(express.json({ limit: "5mb" }));

// ── POST /git/default-branch ─────────────────────────────────────────────────
// Resolve the repo's default branch without any GitHub API call.
git.post("/default-branch", async (req, res) => {
  const { repoUrl } = req.body ?? {};
  if (!repoUrl) return res.status(400).json({ error: "repoUrl required" });
  try {
    const branch = await resolveDefaultBranch(repoUrl);
    res.json({ branch });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /git/ensure ─────────────────────────────────────────────────────────
// Clone (if needed) + pull, then return the file tree.
git.post("/ensure", async (req, res) => {
  const { groupId, branch, repoUrl } = req.body ?? {};
  if (!groupId || !branch || !repoUrl) {
    return res.status(400).json({ error: "groupId, branch, repoUrl required" });
  }
  try {
    const files = await withGroupLock(groupId, async () => {
      const dir = await ensureClone(groupId, branch, repoUrl);
      return walkTree(dir);
    });
    res.json({ files });
  } catch (e: any) {
    console.error("Git ensure error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /git/content ────────────────────────────────────────────────────────
// Read a file from the clone. Returns the same shape as the old
// /api/file-content so the editor needs zero client changes.
git.post("/content", async (req, res) => {
  const { groupId, branch, filePath } = req.body ?? {};
  if (!groupId || !branch || !filePath) {
    return res.status(400).json({ error: "groupId, branch, filePath required" });
  }
  try {
    const result = await withGroupLock(groupId, () =>
      readFileContent(groupId, branch, filePath),
    );
    res.json(result);
  } catch (e: any) {
    console.error("Git content error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /git/file ────────────────────────────────────────────────────────────
// Serve a raw file for image preview / downloads.
// Query: ?groupId=X&branch=Y&path=Z
git.get("/file", async (req, res) => {
  const { groupId, branch, path: filePath } = req.query ?? {};
  if (!groupId || !branch || !filePath) {
    return res.status(400).json({ error: "groupId, branch, path required" });
  }
  try {
    const buf = await withGroupLock(groupId as string, () =>
      readFileRaw(groupId as string, branch as string, filePath as string),
    );
    res.setHeader("Content-Length", buf.byteLength);
    res.send(buf);
  } catch (e: any) {
    console.error("Git file serve error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /git/files ──────────────────────────────────────────────────────────
// Just return the tree (already cloned). Useful for branch switches where
// the clone already exists and only the listing is needed.
git.post("/files", async (req, res) => {
  const { groupId, branch } = req.body ?? {};
  if (!groupId || !branch) {
    return res.status(400).json({ error: "groupId, branch required" });
  }
  try {
    const files = await walkTree(branchDir(groupId, branch));
    res.json({ files });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export { git };