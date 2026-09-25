import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import prisma from "./prisma";

// ── Signed OAuth `state` for the manual GitHub-link flow ────────────────────
// We can't trust GitHub's email to match an existing account, so linking is
// keyed on the logged-in session user id, carried through the OAuth round-trip
// in a tamper-proof state string (reuses the HMAC pattern from wsToken.ts).

const SECRET = process.env.WS_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
const STATE_TTL_SECONDS = 600; // 10 min to complete the OAuth dance

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Cookie holding the nonce signed into the state. The callback requires the
 * two to match, so a state only completes in the browser that started it —
 * an authorize link sent to someone else can't finish on their account.
 */
export const LINK_NONCE_COOKIE = "gh_link_nonce";
export const LINK_NONCE_TTL_SECONDS = STATE_TTL_SECONDS;

export function newLinkNonce(): string {
  return randomBytes(16).toString("hex");
}

export function signLinkState(userId: string, nonce: string): string {
  if (!SECRET) throw new Error("NEXTAUTH_SECRET must be set to sign link state");
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        sub: userId,
        nonce,
        exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
      }),
    ),
  );
  const sig = b64url(createHmac("sha256", SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyLinkState(state: string): { userId: string; nonce: string } | null {
  if (!SECRET) return null;
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;

  const expected = new Uint8Array(createHmac("sha256", SECRET).update(payload).digest());
  const given = new Uint8Array(Buffer.from(sig, "base64url"));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.sub !== "string" || typeof data.exp !== "number") return null;
    if (typeof data.nonce !== "string") return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: data.sub, nonce: data.nonce };
  } catch {
    return null;
  }
}

// ── GitHub account helpers ──────────────────────────────────────────────────

export interface LinkedGithub {
  githubUserId: string; // immutable — survives username changes
  accessToken: string | null;
  username: string | null;
  scope: string | null;
}

/** The GitHub Account row for a Ko-Lab user, or null if not linked. */
export async function getLinkedGithub(userId: string): Promise<LinkedGithub | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "github" },
    select: { providerAccountId: true, access_token: true, scope: true },
  });
  if (!account) return null;
  return {
    githubUserId: account.providerAccountId,
    accessToken: account.access_token ?? null,
    username: null,
    scope: account.scope ?? null,
  };
}

/** Resolve the current GitHub login for a user (handles renames). */
export async function getGithubUsername(userId: string): Promise<string | null> {
  const linked = await getLinkedGithub(userId);
  if (!linked?.accessToken) return null;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${linked.accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.login ?? null;
  } catch {
    return null;
  }
}

/** True if the linked token carries the `repo` scope needed to push / accept invites. */
export function hasRepoScope(scope: string | null): boolean {
  if (!scope) return false;
  return scope.split(/[,\s]+/).includes("repo");
}

/**
 * Public origin of this deployment.
 *
 * Prefers explicit config, then Vercel's own deployment URL, and only falls
 * back to localhost for local dev. The fallback used to win silently whenever
 * NEXTAUTH_URL was unset, which put `http://localhost:3000` into invite links
 * that were then shared with real users.
 */
export function getBaseUrl(): string {
  const explicit = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  // Set automatically on Vercel; host only, so the scheme is added here.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}

/**
 * Origin for a specific request, which beats any env guess: it reflects the
 * host the user actually reached, including custom domains and previews.
 * Falls back to getBaseUrl() when the headers aren't trustworthy.
 */
export function getRequestBaseUrl(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return getBaseUrl();
  // Anything not obviously local is served over HTTPS in practice.
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}
