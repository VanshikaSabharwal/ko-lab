/**
 * Shared GitHub file-access helpers.
 *
 * Both /api/file-content and /api/file-chunk need the same preamble — resolve
 * the group, decrypt its token, build the repo base URL — so it lives here
 * rather than being copied between routes.
 */
import prisma from "./prisma";
import { decrypt, extractRepoName } from "./encryption";
import { isGroupMember } from "./apiAuth";

/**
 * Size tiers for opening a file in the editor.
 *
 * CodeMirror parses a whole document into its text tree and the linter walks
 * all of it, so cost scales with bytes no matter how little is on screen. These
 * thresholds degrade the experience in steps instead of freezing the tab.
 */
export const EDITABLE_MAX = 5 * 1024 * 1024;
/** Past this a file opens in the chunked viewer instead of CodeMirror. */
export const CODEMIRROR_MAX = 5 * 1024 * 1024;
/** Ceiling for the virtualized viewer when range requests are unavailable. */
export const VIEWER_MAX = 25 * 1024 * 1024;
/** The Contents API refuses blobs past this; larger files go via Git Blobs. */
export const CONTENTS_API_MAX = 1024 * 1024;

/** Bytes per chunk request from the virtualized viewer. */
export const CHUNK_SIZE = 256 * 1024;

/**
 * How long a staged deletion survives before it is un-staged.
 *
 * Lives here rather than in the route because a Next.js route module may only
 * export handlers and a small set of config keys.
 */
export const TRASH_TTL_DAYS = 10;
/** Items expiring within this window drive the warning banner and badge. */
export const TRASH_WARN_DAYS = 1;

export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico",
]);

// Extensions that are never source text. SVG is deliberately absent — it's XML
// and editing it in the editor is legitimate.
export const BINARY_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  "pdf", "zip", "gz", "tar", "tgz", "bz2", "7z", "rar",
  "mp3", "mp4", "wav", "ogg", "webm", "mov", "avi", "flac",
  "woff", "woff2", "ttf", "otf", "eot",
  "pyc", "class", "jar", "wasm", "so", "dll", "dylib", "exe", "bin",
  "sqlite", "db", "psd", "sketch", "fig",
]);

export function extensionOf(filePath: string): string {
  const base = filePath.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  // A leading dot means a dotfile (.gitignore), not an extension.
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * True when the bytes can't be a text file.
 *
 * Extension alone misses unlabelled binaries, so this also looks for a NUL —
 * which valid UTF-8 text never contains — in the first slice of the buffer.
 * Without this check, decoding as UTF-8 silently produces a screen of U+FFFD
 * rather than reporting anything.
 */
export function looksBinary(buf: Buffer, ext: string): boolean {
  if (BINARY_EXTENSIONS.has(ext)) return true;
  return buf.subarray(0, 8000).includes(0);
}

/**
 * A repo file path made safe to append to `/repos/{owner}/{repo}/contents/`.
 *
 * URLs resolve `..`, so an unchecked path like `../../other/repo/contents/.env`
 * walked out of the group's repo — while carrying the owner's token — to any
 * repo or endpoint that token can reach. Each segment is also percent-encoded
 * so a `?` or `#` can't rewrite the query or fragment.
 *
 * Returns null for anything that isn't a plain relative path.
 */
export function safeContentsPath(filePath: unknown): string | null {
  if (typeof filePath !== "string") return null;
  const trimmed = filePath.replace(/^\/+|\/+$/g, "");
  if (!trimmed || trimmed.length > 1024) return null;
  // Backslashes and control characters have no place in a repo path
  if (/[\\\u0000-\u001f\u007f]/.test(trimmed)) return null;

  const segments = trimmed.split("/");
  for (const seg of segments) {
    // Decoded too, since `%2e%2e` is treated as `..` by URL parsers. A `%` that
    // doesn't decode (a file named `100%.txt`) is just a literal character.
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      // keep the raw segment
    }
    if (seg === "" || decoded === "." || decoded === "..") return null;
  }
  return segments.map(encodeURIComponent).join("/");
}

export interface RepoAccess {
  base: string;
  headers: Record<string, string>;
}

export type RepoAccessResult =
  | { ok: true; access: RepoAccess }
  | { ok: false; status: number; error: string };

/**
 * Authorize the caller for a group and return everything needed to call the
 * GitHub API for its repo.
 */
export async function resolveRepoAccess(
  groupId: string,
  userId: string,
): Promise<RepoAccessResult> {
  if (!(await isGroupMember(groupId, userId))) {
    return { ok: false, status: 403, error: "Not a member of this group" };
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { githubRepo: true, ownerName: true, githubAccessToken: true },
  });

  if (!group) {
    return { ok: false, status: 404, error: `Group with ID ${groupId} not found` };
  }

  const { githubRepo, ownerName, githubAccessToken } = group;
  if (!githubRepo || !ownerName || !githubAccessToken) {
    return {
      ok: false,
      status: 400,
      error: "GitHub repository URL, owner name, or access token is missing",
    };
  }

  let token: string;
  try {
    token = decrypt(githubAccessToken);
  } catch {
    token = githubAccessToken;
  }

  return {
    ok: true,
    access: {
      base: `https://api.github.com/repos/${ownerName}/${extractRepoName(githubRepo)}`,
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    },
  };
}
