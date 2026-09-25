/**
 * GitHub account linking callback.
 *
 * The signed state used to be the only check, so an attacker could start the
 * flow on their own account, send the authorize link to a victim, and have
 * the victim's GitHub account (and repo-scoped token) land on the attacker's
 * account. The callback now also requires the browser that started the flow
 * (nonce cookie) and the signed-in user the state was signed for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
});

vi.mock("../../app/lib/prisma", () => ({
  default: {
    account: { findUnique: vi.fn(), upsert: vi.fn() },
    groupMember: { findMany: vi.fn() },
  },
}));

vi.mock("../../app/lib/apiAuth", () => ({ getSessionUser: vi.fn() }));
vi.mock("../../app/lib/githubCollaborator", () => ({ sendCollaboratorInvite: vi.fn() }));

import { GET } from "../../app/api/github/link/callback/route";
import { signLinkState, LINK_NONCE_COOKIE } from "../../app/lib/githubLink";
import prisma from "../../app/lib/prisma";
import { getSessionUser } from "../../app/lib/apiAuth";

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function callback(state: string, cookieNonce?: string) {
  const req = new NextRequest(
    `http://localhost:3000/api/github/link/callback?code=abc&state=${encodeURIComponent(state)}`,
  );
  if (cookieNonce) req.cookies.set(LINK_NONCE_COOKIE, cookieNonce);
  return GET(req);
}

const redirectReason = (res: Response) =>
  new URL(res.headers.get("location")!).searchParams.get("reason");

beforeEach(() => {
  vi.clearAllMocks();
  mocked(getSessionUser).mockResolvedValue({ id: "attacker" });
  mocked(prisma.account.findUnique).mockResolvedValue(null);
  mocked(prisma.groupMember.findMany).mockResolvedValue([]);
  global.fetch = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      String(url).includes("access_token")
        ? { access_token: "gh-token", scope: "repo" }
        : { id: 42, login: "someone" },
  })) as unknown as typeof fetch;
});

describe("GET /api/github/link/callback", () => {
  it("links the account when the session, state and cookie all match", async () => {
    const state = signLinkState("attacker", "n1");
    const res = await callback(state, "n1");

    expect(res.headers.get("location")).toContain("github=linked");
    expect(prisma.account.upsert).toHaveBeenCalled();
  });

  it("refuses a state completed in a browser that didn't start the flow", async () => {
    // The victim's browser has no nonce cookie for the attacker's state
    mocked(getSessionUser).mockResolvedValue({ id: "victim" });
    const state = signLinkState("attacker", "n1");
    const res = await callback(state);

    expect(redirectReason(res)).toBe("state_mismatch");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.account.upsert).not.toHaveBeenCalled();
  });

  it("refuses when the signed-in user isn't the one the state was signed for", async () => {
    mocked(getSessionUser).mockResolvedValue({ id: "victim" });
    const state = signLinkState("attacker", "n1");
    const res = await callback(state, "n1");

    expect(redirectReason(res)).toBe("session_mismatch");
    expect(prisma.account.upsert).not.toHaveBeenCalled();
  });

  it("refuses a nonce cookie from a different flow", async () => {
    const state = signLinkState("attacker", "n1");
    const res = await callback(state, "other");

    expect(redirectReason(res)).toBe("state_mismatch");
    expect(prisma.account.upsert).not.toHaveBeenCalled();
  });

  it("clears the nonce cookie so the state can't be reused", async () => {
    const res = await callback(signLinkState("attacker", "n1"), "n1");
    const cookie = res.headers.get("set-cookie") ?? "";

    expect(cookie).toContain(`${LINK_NONCE_COOKIE}=`);
    expect(cookie).toMatch(/Max-Age=0/i);
  });
});
