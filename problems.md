# Ko-Lab — Known Problems & Stale Features

_Audit date: 2026-07-10_

Ranked by severity. Check items off as they're fixed.

---

## 🔴 Security (fix first — exploitable today)

### 1. API routes trust the client to say who they are — ✅ FIXED (2026-07-12)
- [x] All routes now derive caller identity from `getServerSession()` via `apps/web/app/lib/apiAuth.ts` (`getSessionUser` / `getSessionUserRecord` / `isGroupMember` helpers). Client-supplied `userId` / `senderPhone` identity params are ignored.
- Highlights of the sweep (~22 routes):
  - `direct-message` (POST/GET/PATCH) — sender is always the session user.
  - `workspace/[groupId]/[type]` — membership checked against the session user.
  - `create-group-data` GET — was returning the **decrypted GitHub token + SSH key** to anyone with a groupId; now members-only. DELETE owner check now uses session identity.
  - `commit-changes` — also removed logs that printed the decrypted GitHub token and Authorization headers.
  - `add-group-member` — only the group owner may add others; users may add themselves.
  - `rejected-cr` POST — only the group owner may reject CRs.
  - `calls/livekit-webhook` — now verifies LiveKit's JWT signature via `WebhookReceiver` (see #1b below, was previously unauthenticated).
  - User-enumeration routes (`check-user`, `get-user-id`, `get-user-number`, `friend-search`) now require a session.
- Left public by design: `auth/*` (signup/nextauth), `guest-mode`, `testimonial-card` GET.
- ⚠️ Remaining design concern (not fixed): `create-group-data` GET still hands the *decrypted* GitHub token to any group **member** (the code editor consumes it client-side). Long-term, GitHub calls should happen server-side only.

### 2. WebSocket server has no authentication — ✅ FIXED (2026-07-12)
- [x] Connections now require a short-lived (5 min) HMAC-signed token instead of a client-chosen `?userId=`:
  - `apps/web/app/api/ws-token/route.ts` mints the token for the logged-in session user.
  - `apps/web/app/lib/wsToken.ts` (sign) / `apps/web-socket/src/wsToken.ts` (verify) share the `WS_AUTH_SECRET` env var (falls back to `NEXTAUTH_SECRET`). No new crypto deps — plain `node:crypto` HMAC.
  - WS server derives `userId` from the verified token and rejects missing/invalid/expired tokens (close code 1008). Fails closed if no secret is configured.
  - All 5 frontend socket call sites fetch a fresh token per (re)connect via `apps/web/app/lib/wsAuth.ts`.
- Setup note: `apps/web-socket` now loads `.env` via dotenv; a local `apps/web-socket/.env` was created with `WS_AUTH_SECRET` copied from the web app's `NEXTAUTH_SECRET` (git-ignored). **In production, set the same `WS_AUTH_SECRET` on both apps.**
- Note: `apps/web/app/components/Group-Chat.tsx` is dead code (nothing imports it — superseded by `group/[groupId]/GroupChat.tsx`); it was updated anyway, but should just be deleted (see #10).

### 3. npm vulnerabilities — ✅ TRIAGED (2026-07-13)
- 23 vulnerabilities reported by npm (5 low, 7 moderate, 11 high). No **non-breaking** fixes are available (`npm audit fix` changes nothing); a blanket `npm audit fix --force` would install `next` major, `uuid@14`, `diff@9` and downgrade `@vercel/style-guide` — breaking the build. So triaged individually:
  - **10 of the 11 "high" are dev/build tooling** (`eslint`, `typescript-eslint`, `glob`, `minimatch`, `tmp` via turbo-gen). Never shipped to production, not reachable by users. No action.
  - **`diff` (low)** — vuln is in `parsePatch`; we only use `diffLines`. Not in code path.
  - **`uuid` (moderate)** — vuln is v3/v5/v6 with a `buf` arg; we use v4 without `buf`. Not in usage.
  - **`next` (high) — the only genuinely-shipped vuln:** DoS via image optimization. Already on the latest 14.x (14.2.35); fix requires **Next 15 (major upgrade)** — a separate, tested migration. Interim mitigation: limited exposure if remote images aren't served through `next/image` optimization.
- [ ] **Remaining action:** plan a Next 15 upgrade when the image-optimization DoS matters for the deployment. Everything else is dev-tooling noise.

### 3b. `create-group-data` GET leaked the owner's GitHub token to members — ✅ FIXED (2026-07-13)
- [x] The GET response no longer includes the decrypted `githubAccessToken` or `sshKey` — it returns only safe fields (+ a `hasSshKey` boolean). All GitHub calls are proxied server-side (`/api/files`, `/api/file-content`, `/api/vcs/*`), so the token never reaches the browser. Removed a `console.log` in `GroupChat` that dumped the full response.

---

## 🟠 Correctness / hygiene

### 4. Prisma schema change with no migration
- [ ] Uncommitted `apps/web/prisma/schema.prisma` adds the `WorkspaceBoard` model, but the latest migration is still `20260329_add_isread_to_messages`.
- If the local DB was updated via `prisma db push`, anyone else pulling the branch (or prod) won't have the table.
- **Fix:** run `npx prisma migrate dev` and commit the migration alongside the schema.

### 5. Root `package.json` dependency problems
- [x] `"crypto": "^1.0.1"` — this is a **deprecated placeholder npm package**, not Node's built-in `crypto`. Removed (2026-10-08).
- [ ] App-level deps living at the monorepo root: `framer-motion`, `lucide-react`, `embla-carousel-react`, `js-cookie`, `shepherd.js`, `react-icons`, `react-hot-toast` — move to the app that uses them.
- [x] Both `octokit` **and** `@octokit/rest` are installed — pick one. Kept `@octokit/rest` (the only one imported); removed `octokit` (2026-10-08).
- [ ] Version skew: `prisma`/`@prisma/client` ^5.19.1 at root vs ^5.20.0 in apps/web; `next-auth` duplicated at root and app level.

### 6. `packages/db` is an empty husk
- [x] Contains only `node_modules` — no source, no schema. Folder deleted (2026-10-08).
- [x] `apps/web-socket/tsconfig.json` still maps `@repo/db/*` paths even though the `@repo/db` dependency was removed from its package.json. The mapping was already gone by 2026-10-08.
- **Fix:** delete the package and the stale tsconfig path mapping.

---

## 🟡 Stale / abandoned features

### 7. Email OTP flow is dead code
- [x] `apps/web/app/api/auth/send-otp/route.ts` is 100% commented out; `nodemailer` has been removed from deps. Route deleted (2026-10-08). The signup form still required its "Send OTP" step, so email signup could never finish; that step is removed and the form now submits straight to `/api/auth/signup` (where OTP was already optional). Emails are therefore unverified at signup.
- [ ] Leftover smell: DMs are keyed on **unverified phone numbers** (`senderPhone`/`recipientPhone`, plus `check-phone-number`, `get-user-number`, `set-phone` routes) even though phone/OTP verification was abandoned. Fragile identity model — feeds problem #1.

### 8. Call recording ("part 2") planned but never built
- [ ] `voice-and-videocall-features.md` specs LiveKit Egress + FFmpeg + MinIO recording — zero code exists for any of it.
- [ ] Plan assumes **self-hosted** LiveKit, but the implementation uses LiveKit **Cloud** (`ko-lab-5s9w0dn1.livekit.cloud`). Stale relative to reality:
  - `docker-compose.livekit.yml`
  - `scripts/smoke-test-livekit.sh`
  - Recording & infrastructure sections (9–10) of `voice-and-videocall-features.md`
- [ ] `ko-lab-call-system-v1.json` claims `call_missed` is "not yet implemented server-side" — it now is (`apps/web-socket/src/index.ts`). Doc is out of date.
- Calls themselves appear complete.

### 9. Workspace feature exists only in the working tree
- All four boards (mind map, planning, DB schema, UI design), WS sync, API route, schema change, and the GroupChat menu link are **uncommitted**.
- Looks feature-complete against `workspaces-config-v1.json`. Blockers before committing:
  - [ ] #4 (missing migration)
  - [ ] ideally #1 (its API trusts client-supplied `userId`)
  - [ ] decide whether `workspaces-config-v1.json` and root `package-lock.json` are tracked or not.

### 10. Root-level clutter & duplicate routes
- [x] Design docs at repo root (`code-editor-improvements-v1.json`, `ko-lab-call-system-v1.json`, `voice-and-videocall-features.md`) — two are already partly wrong (see #8). Moved to `docs/` with the other design notes (2026-10-08); their contents are unchanged, so the stale parts in #8 still apply.
- [ ] `apps/web/app/chat-room/page.tsx` is a thin wrapper around `<Chats />` while a separate `chat/[chatId]` route exists — check whether both are needed.

---

## Suggested order of attack

1. #1 + #2 together — same root cause (client-asserted identity); every new feature inherits the pattern until it's fixed.
2. #4 — one command, unblocks committing the workspace feature (#9).
3. #5, #6, #7 — quick dependency/dead-code cleanup.
4. #3 — npm audit highs.
5. #8, #10 — doc and clutter cleanup when convenient.
