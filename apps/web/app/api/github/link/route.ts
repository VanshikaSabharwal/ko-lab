import { NextResponse } from "next/server";
import { getSessionUser, unauthorized } from "../../../lib/apiAuth";
import {
  signLinkState,
  getBaseUrl,
  newLinkNonce,
  LINK_NONCE_COOKIE,
  LINK_NONCE_TTL_SECONDS,
} from "../../../lib/githubLink";

// Step 1 of manual GitHub linking: redirect the logged-in user to GitHub's
// authorize page with a signed state carrying their Ko-Lab user id.
// Deterministic — links regardless of whether emails match across providers.
export async function GET() {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const clientId = process.env.GITHUB_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GitHub OAuth is not configured" }, { status: 500 });
  }

  const redirectUri = `${getBaseUrl()}/api/github/link/callback`;
  const nonce = newLinkNonce();
  const state = signLinkState(me.id, nonce);

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "repo read:user user:email");
  authorizeUrl.searchParams.set("state", state);
  // Force the account chooser so a user can link a GitHub account that differs
  // from any they're currently signed into.
  authorizeUrl.searchParams.set("allow_signup", "false");

  const res = NextResponse.redirect(authorizeUrl.toString());
  // Ties the state to this browser; see LINK_NONCE_COOKIE. Lax (not Strict)
  // so it's still sent on the top-level redirect back from GitHub.
  res.cookies.set(LINK_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/github/link",
    maxAge: LINK_NONCE_TTL_SECONDS,
  });
  return res;
}
