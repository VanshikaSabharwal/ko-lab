# fix_3 — Collaborator access

Answer to "how can we add collaborator access?" — plus the gaps found while investigating.

**Short answer: collaborator access already exists and works.** An owner can invite a group member as a GitHub repo collaborator, and the invite survives the member not having linked GitHub yet. What's missing is everything *after* the invite: no removal, no roles, no resend, and no handling of declined or expired invitations.

**Do this AFTER the Planning & Milestones workspace rebuild.** The Collaboration tab in `fix_2` renders this UI, so `fix_3` should land before or alongside that step.

Status legend: ☐ todo · ◐ in progress · ☑ done

---

## How it works today

Two separate concepts, often confused:

| | Group membership | Code access |
|---|---|---|
| Model | `GroupMember` | `GroupMember.codeAccess` |
| Values | `role: ADMIN \| MEMBER` | `NONE → PENDING_GITHUB → INVITED → ACTIVE` |
| Grants | Chat, workspace boards, viewing files | Pushing / raising change requests |

Being a group member does **not** grant repo access. Repo access is a real GitHub collaborator invitation with `permission: "push"`.

### The invite flow

1. Owner opens `/viewMembers/[groupId]` → `CollaboratorPanel` → clicks Invite on a member.
2. `POST /api/github/collaborator` (`{groupId, memberUserId}`) — **owner-only**, 403 otherwise; also verifies the target is already a group member.
3. `sendCollaboratorInvite()` in `app/lib/githubCollaborator.ts`:
   - Member has no linked GitHub → status becomes `PENDING_GITHUB`, no API call. The intent is *queued*.
   - Otherwise `PUT /repos/{owner}/{repo}/collaborators/{username}` with `{permission: "push"}` using the **owner's decrypted token**.
   - GitHub `204` (already a collaborator) → `ACTIVE`; `201` (invite created) → `INVITED`.
4. Member accepts, either in-app on `/profile` (`PATCH /api/github/invitations`) or via GitHub's email link.
5. Out-of-band acceptance is reconciled lazily by `refreshCollaboratorStatus()`, but **only** when the member loads their own status while `INVITED`.

If a member links GitHub later, `api/github/link/callback` drains every queued `PENDING_GITHUB` row and fires the invites then. That part is nicely designed.

### What the status actually gates

- `POST /api/vcs/change-request` — hard gate: owner, or `codeAccess === "ACTIVE"`.
- `Editor.tsx:250` — `canEdit` toggles CodeMirror read-only.
- `lib/vcs.ts` — with a usable member token the commit is authored under **their** token; otherwise it falls back to the owner's token with the member as git author.

---

## Gaps found

Ordered by severity. The first three are correctness/security issues, not missing features.

### GAP-1 · Accepting one invitation activates every pending membership

**Status:** ☐ todo · **Severity: high — privilege escalation**

`api/github/invitations/route.ts` PATCH:
```ts
await prisma.groupMember.updateMany({
  where: { userId: me.id, codeAccess: "INVITED", ...(groupId ? { groupId } : {}) },
  data: { codeAccess: "ACTIVE" },
});
```
`groupId` is optional and **the profile UI never sends it** — it posts only `invitationId`. So a user with pending invites to groups A, B and C who accepts A's invitation is marked `ACTIVE` in all three. They then pass the change-request gate for repos they were never granted on GitHub.

**Fix:** resolve the group from the invitation's repo and scope the update to it. Never mass-update on `userId` alone.

### GAP-2 · Server routes don't enforce codeAccess

**Status:** ☐ todo · **Severity: high**

`api/modified-files`, `api/save-coding-files` and `api/commit-changes` check `getSessionUser()` only — no `codeAccess`, and in places no group membership. **The read-only editor is cosmetic**: a `NONE` member can POST drafts directly.

Combined with `api/add-group-member` allowing anyone to add *themselves* to any existing group, the owner-only invite gate is the only thing containing repo access.

**Fix:** add the same `isGroupMember` + `codeAccess === "ACTIVE"` check the change-request route already uses. Factor it into an `isCodeContributor(groupId, userId)` helper in `app/lib/apiAuth.ts` beside `isGroupMember`.

### GAP-3 · No way to revoke access

**Status:** ☐ todo · **Severity: high**

There is no `DELETE` on the collaborator route, no call to GitHub's `DELETE /repos/{o}/{r}/collaborators/{u}`, and `setCodeAccess` is never called with `NONE`. **No code path downgrades anyone, ever.**

Removing someone from the group would leave them a live GitHub collaborator with push rights indefinitely — and there's no route to remove a group member either.

**Fix:** `DELETE /api/github/collaborator` (owner-only) that revokes on GitHub, deletes any pending invitation, and sets `codeAccess: "NONE"`. Wire a "Revoke access" action into the panel with a confirmation naming the consequence.

### GAP-4 · Declined and expired invitations are invisible

**Status:** ☐ todo

GitHub invitations expire after 7 days and can be declined. `refreshCollaboratorStatus` returns `false` on 404 but deliberately never writes `NONE`, so a declined invite reads "Invite sent" forever and the owner has no action available.

**Fix:** persist `invitedAt`; treat `INVITED` past 7 days as stale and surface "Invite expired — resend". Optionally reconcile against `GET /repos/{o}/{r}/invitations` in the owner view.

### GAP-5 · Owner cannot resend an invite

**Status:** ☐ todo

`canInvite = codeAccess === "NONE" || codeAccess === "PENDING_GITHUB"` — so `INVITED` rows have no actions at all. GitHub's `PUT` is idempotent and a resend would work fine; the UI simply refuses.

**Fix:** allow Invite on `INVITED` rows, labelled "Resend invite".

### GAP-6 · No roles — permission is hardcoded

**Status:** ☐ todo

`permission: "push"` is hardcoded. `GroupRole` (ADMIN/MEMBER) exists but **no route ever mutates it**, and it is never mapped to a GitHub permission.

**Fix:** map `GroupRole` → GitHub permission (`ADMIN → maintain`, `MEMBER → push`) and add a role-change route, owner-only. Re-`PUT` on change, since GitHub updates permission through the same endpoint.

### GAP-7 · Members have no self-service

**Status:** ☐ todo

A member sees nothing at `/viewMembers` (`CollaboratorPanel` returns `null` for non-owners). Their only signal is an amber banner inside the code editor. There is **no way to request access**, and the owner is never notified when a member links GitHub.

**Fix:** a member-facing access card showing current status with the right next action, plus a "Request code access" button that notifies the owner.

### GAP-8 · Owner's view is never reconciled

**Status:** ☐ todo

Reconciliation runs only on the *member's* self-status fetch. The owner's panel can show `INVITED` long after acceptance, and a collaborator removed directly on GitHub stays `ACTIVE` in Ko-lab — still passing the change-request gate.

**Fix:** reconcile in the owner's GET (bounded — a HEAD per member is fine for small groups), or a webhook later.

### GAP-9 · Token hygiene

**Status:** ☐ todo

Member tokens are stored **plaintext** in `Account.access_token`, while group tokens are encrypted via `decrypt()`. The `repo` scope is broad (full read/write on all their repos). `signLinkState`'s nonce is generated but never stored, so state is replayable within its 10-minute window.

**Fix:** encrypt member tokens at rest reusing `app/lib/encryption.ts`; persist and burn the nonce.

### GAP-10 · The `Invite` model is vestigial

**Status:** ☐ todo · **Severity: low, but user-visible**

`api/send-invite` generates `http://localhost:3000/signup?referral=${invite.id}` — **hardcoded localhost, broken in production**. Nothing ever reads `?referral=`, so the invitee must still join manually. `status` never leaves `"pending"`, and the duplicate check queries `phone` without `groupId`, so a phone invited to one group can never be invited to another — despite the schema's `@@unique([phone, groupId])`.

**Fix:** use `getBaseUrl()` (already exists, used by the GitHub link route); consume `referral` at signup to auto-join; scope the duplicate check by `groupId`.

---

## Recommended sequence

**Security first** — these are live issues, independent of any redesign:
1. GAP-1 scope the invitation update
2. GAP-2 enforce `codeAccess` server-side
3. GAP-3 revocation

**Then the workflow gaps**, which fit naturally into `fix_2`'s Collaboration tab:
4. GAP-5 resend · GAP-4 expiry
5. GAP-7 member self-service
6. GAP-6 roles
7. GAP-8 owner reconciliation

**Cleanup:** GAP-9 token hygiene, GAP-10 the `Invite` model.

Steps 1-3 are small and worth doing regardless of whether the IDE redesign proceeds.

---

## Verification

- **GAP-1:** two groups, pending invites in both; accept one → only that group flips to `ACTIVE`.
- **GAP-2:** as a `NONE` member, POST directly to `/api/modified-files` with curl → must 403. This is the check that proves the editor's read-only state is real.
- **GAP-3:** revoke → the user disappears from the repo's collaborators on GitHub and `codeAccess` reads `NONE`; they can no longer raise a change request.
- **GAP-5/4:** resend appears on an `INVITED` row; an invite older than 7 days reads "expired".
- **GAP-6:** promoting to ADMIN changes the GitHub permission to `maintain`.
- Throughout: confirm the owner is always implicitly `ACTIVE` and never blocked by their own gates.
