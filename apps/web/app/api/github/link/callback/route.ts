import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { verifyLinkState, getBaseUrl, LINK_NONCE_COOKIE } from "../../../../lib/githubLink";
import { getSessionUser } from "../../../../lib/apiAuth";
import { sendCollaboratorInvite } from "../../../../lib/githubCollaborator";

// Step 2: GitHub redirects back here. Verify the signed state, exchange the
// code for a token, read the GitHub identity, and attach it to the SESSION
// user's account — no reliance on email matching.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const base = getBaseUrl();

  // Every outcome clears the nonce cookie, so a state can be used once
  const finish = (res: NextResponse) => {
    res.cookies.set(LINK_NONCE_COOKIE, "", { path: "/api/github/link", maxAge: 0 });
    return res;
  };
  const fail = (reason: string) =>
    finish(
      NextResponse.redirect(`${base}/profile?github=error&reason=${encodeURIComponent(reason)}`),
    );

  if (!code || !state) return fail("missing_code");

  const verified = verifyLinkState(state);
  if (!verified) return fail("invalid_state");
  const { userId } = verified;

  // The signed state alone isn't enough: an attacker could start the flow on
  // their own account and send the authorize link to a victim, whose GitHub
  // account (and repo-scoped token) would then land on the attacker's
  // account. Require that this browser started the flow and that the person
  // signed in here is the one the state was signed for.
  const cookieNonce = req.cookies.get(LINK_NONCE_COOKIE)?.value;
  if (!cookieNonce || cookieNonce !== verified.nonce) return fail("state_mismatch");

  const me = await getSessionUser();
  if (!me || me.id !== userId) return fail("session_mismatch");

  // Exchange code → access token
  let accessToken: string;
  let scope: string | null = null;
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_ID,
        client_secret: process.env.GITHUB_SECRET,
        code,
        redirect_uri: `${base}/api/github/link/callback`,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return fail("token_exchange_failed");
    accessToken = tokenData.access_token;
    scope = tokenData.scope ?? null;
  } catch {
    return fail("token_exchange_failed");
  }

  // Read the GitHub identity (immutable id + current login)
  let githubUserId: string;
  let githubLogin: string;
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${accessToken}`, Accept: "application/vnd.github.v3+json" },
    });
    if (!userRes.ok) return fail("github_user_failed");
    const gh = await userRes.json();
    githubUserId = String(gh.id);
    githubLogin = gh.login;
  } catch {
    return fail("github_user_failed");
  }

  // Guard: this GitHub account must not already be linked to a DIFFERENT user
  const existing = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: "github", providerAccountId: githubUserId } },
    select: { userId: true },
  });
  if (existing && existing.userId !== userId) {
    return fail("github_account_taken");
  }

  // Upsert the Account row for the session user
  await prisma.account.upsert({
    where: { provider_providerAccountId: { provider: "github", providerAccountId: githubUserId } },
    update: { access_token: accessToken, scope, userId },
    create: {
      userId,
      type: "oauth",
      provider: "github",
      providerAccountId: githubUserId,
      access_token: accessToken,
      scope,
      token_type: "bearer",
    },
  });

  // Fire any collaborator invites that were queued while this user was unlinked.
  const pending = await prisma.groupMember.findMany({
    where: { userId, codeAccess: "PENDING_GITHUB" },
    select: { groupId: true },
  });
  await Promise.allSettled(pending.map((m) => sendCollaboratorInvite(m.groupId, userId)));

  return finish(
    NextResponse.redirect(`${base}/profile?github=linked&login=${encodeURIComponent(githubLogin)}`),
  );
}
