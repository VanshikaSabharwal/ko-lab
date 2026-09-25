import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { randomBytes } from "crypto";
import prisma from "./prisma";
import { s3Client } from "./s3";
import { collectWorkspaceFiles } from "./workspaceFiles";
import { extensionOf } from "./githubFiles";
import type { LivePreviewState } from "./livePreviewConfig";

// "Make it live": a static site from the editor, copied into object storage
// under previews/{previewId}/ and served by /preview/{token}/... Copying (rather
// than reading the repo on each request) is what makes a deploy a snapshot, so
// the site only changes when the author deploys again or saves with auto-update
// on.

const BUCKET = process.env.DRAFT_BUCKET || process.env.S3_BUCKET || "ko-lab-drafts";

const MAX_FILES = 1_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const CONCURRENCY = 8;

/** Where a site's index.html usually is, in order of preference. */
const ROOT_CANDIDATES = ["", "dist", "build", "out", "public", "docs"];

export class PreviewError extends Error {}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

function objectKey(previewId: string, sitePath: string): string {
  return `previews/${previewId}/${sitePath}`;
}

/**
 * Dotfiles and dot-folders (.env, .git*, .vscode) and node_modules never make
 * it into a preview: a share link is public, and .env is the classic leak.
 */
function isPublishable(path: string): boolean {
  return !path.split("/").some((seg) => seg.startsWith(".") || seg === "node_modules");
}

/** The folder holding the site's index.html, or null if there isn't one. */
export function findSiteRoot(paths: string[]): string | null {
  const set = new Set(paths);
  for (const dir of ROOT_CANDIDATES) {
    if (set.has(dir ? `${dir}/index.html` : "index.html")) return dir;
  }
  // Otherwise the shallowest index.html anywhere
  const nested = paths
    .filter((p) => p === "index.html" || p.endsWith("/index.html"))
    .sort((a, b) => a.split("/").length - b.split("/").length)[0];
  return nested === undefined ? null : nested.slice(0, -"/index.html".length);
}

/**
 * Source that only runs after a bundler (Vite/CRA entry points like
 * /src/main.tsx). Serving it as-is gives a blank page, so refuse up front.
 */
export function needsBuildStep(indexHtml: string): boolean {
  return /<script[^>]+src=["'][^"']+\.(jsx|tsx|ts)["']/i.test(indexHtml);
}

/** Path of a repo file relative to the site root, or null if it's outside it. */
function sitePathFor(repoPath: string, rootDir: string): string | null {
  if (!rootDir) return repoPath;
  return repoPath.startsWith(`${rootDir}/`) ? repoPath.slice(rootDir.length + 1) : null;
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const { Contents, NextContinuationToken } = await s3Client.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const c of Contents ?? []) if (c.Key) keys.push(c.Key);
    token = NextContinuationToken;
  } while (token);
  return keys;
}

async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
      }),
    );
  }
}

export async function deletePreviewObjects(previewId: string): Promise<void> {
  await deleteKeys(await listKeys(`previews/${previewId}/`));
}

/**
 * Copy branch + the author's drafts (+ the open file's unsaved text) into the
 * preview's folder. Uploads first and removes stale files after, so a redeploy
 * never serves a half-empty site.
 */
export async function publishSnapshot(opts: {
  previewId: string;
  groupId: string;
  userId: string;
  branch: string;
  unsaved?: { path: string; content: string };
}): Promise<{ rootDir: string }> {
  const { previewId, groupId, userId, branch, unsaved } = opts;
  const files = (await collectWorkspaceFiles({ groupId, userId, branch, unsaved })).filter((f) =>
    isPublishable(f.path),
  );
  const byPath = new Map(files.map((f) => [f.path, f]));

  const rootDir = findSiteRoot([...byPath.keys()]);
  if (rootDir === null) {
    throw new PreviewError("No index.html found. Make it live serves static sites, which need an index.html.");
  }

  const sitePaths = files
    .map((f) => ({ repoPath: f.path, sitePath: sitePathFor(f.path, rootDir) }))
    .filter((p): p is { repoPath: string; sitePath: string } => p.sitePath !== null);

  if (sitePaths.length > MAX_FILES) {
    throw new PreviewError(`This site has ${sitePaths.length} files; the limit is ${MAX_FILES}.`);
  }
  const knownBytes = sitePaths.reduce((n, p) => n + byPath.get(p.repoPath)!.size, 0);
  if (knownBytes > MAX_TOTAL_BYTES) {
    throw new PreviewError("This site is over 50 MB, too large to make live.");
  }

  const contentOf = (repoPath: string) => byPath.get(repoPath)!.read();

  const indexRepoPath = rootDir ? `${rootDir}/index.html` : "index.html";
  if (needsBuildStep((await contentOf(indexRepoPath)).toString("utf-8"))) {
    throw new PreviewError(
      "This project needs a build step (e.g. Vite or React). Make it live serves static HTML, CSS and JS. Commit a built dist/ folder to publish it.",
    );
  }

  const queue = [...sitePaths];
  const upload = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: objectKey(previewId, next.sitePath),
          Body: await contentOf(next.repoPath),
          ContentType: contentTypeFor(next.sitePath),
        }),
      );
    }
  };
  const worker = () =>
    upload().catch((error) => {
      queue.length = 0; // one failure stops the other uploads too
      throw error;
    });
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const fresh = new Set(sitePaths.map((p) => objectKey(previewId, p.sitePath)));
  const stale = (await listKeys(`previews/${previewId}/`)).filter((k) => !fresh.has(k));
  if (stale.length > 0) await deleteKeys(stale);

  return { rootDir };
}

/**
 * Update one file of a live preview after a save. Returns false when the file
 * sits outside the site root (nothing to update).
 */
export async function updateSnapshotFile(
  previewId: string,
  rootDir: string,
  repoPath: string,
  content: string,
): Promise<boolean> {
  const sitePath = sitePathFor(repoPath, rootDir);
  if (sitePath === null || !isPublishable(repoPath)) return false;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: objectKey(previewId, sitePath),
      Body: content,
      ContentType: contentTypeFor(sitePath),
    }),
  );
  return true;
}

/** Bytes of one site file, or null if it isn't in the snapshot. */
export async function readSnapshotFile(previewId: string, sitePath: string): Promise<Uint8Array | null> {
  try {
    const { Body } = await s3Client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: objectKey(previewId, sitePath) }),
    );
    return Body ? await Body.transformToByteArray() : new Uint8Array();
  } catch (e: any) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

/** A preview is gone once neither its private nor its share link is live. */
export function isFullyExpired(
  p: { expiresAt: Date; shareExpiresAt: Date | null },
  now = new Date(),
): boolean {
  return p.expiresAt <= now && (!p.shareExpiresAt || p.shareExpiresAt <= now);
}

/**
 * Remove previews whose links have all expired. Run on each deploy instead of
 * a cron job; the serving route already refuses expired links, so this only
 * frees storage.
 */
export async function sweepExpiredPreviews(): Promise<void> {
  const now = new Date();
  const expired = await prisma.livePreview.findMany({
    where: {
      expiresAt: { lte: now },
      OR: [{ shareExpiresAt: null }, { shareExpiresAt: { lte: now } }],
    },
    select: { id: true },
    take: 20,
  });
  for (const { id } of expired) {
    await deletePreviewObjects(id);
    await prisma.livePreview.delete({ where: { id } }).catch(() => {});
  }
}

export function previewState(
  origin: string,
  p: {
    token: string;
    expiresAt: Date;
    branch: string;
    rootDir: string;
    shareToken: string | null;
    shareExpiresAt: Date | null;
  },
): LivePreviewState {
  const now = new Date();
  const shareLive = p.shareToken && p.shareExpiresAt && p.shareExpiresAt > now;
  return {
    url: `${origin}/preview/${p.token}/index.html`,
    expiresAt: p.expiresAt.toISOString(),
    branch: p.branch,
    rootDir: p.rootDir,
    shareUrl: shareLive ? `${origin}/preview/${p.shareToken}/index.html` : null,
    shareExpiresAt: shareLive ? p.shareExpiresAt!.toISOString() : null,
  };
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  wasm: "application/wasm",
};

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? "application/octet-stream";
}
