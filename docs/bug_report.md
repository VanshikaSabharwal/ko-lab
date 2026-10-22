# Ko-Lab — Bug Report System

_Design finalized 2026-07-13 (interview)._

A user-friendly, in-app bug reporting system: floating button → capture modal with
screenshot + auto-context → GitHub issue + DB record → status tracking with notify-on-resolve.

## Decisions (from interview)

| Question | Decision |
|---|---|
| Entry point | Floating "Report a bug" button on every page (+ keyboard shortcut) |
| Destination | Auto-create a **GitHub issue** in the main Ko-Lab repo |
| Email | Rely on **GitHub's native issue-notification email** (owner emailed automatically) — no email provider |
| Capture | Description + category/severity + **auto-context** + **screenshot & annotate** |
| Follow-up | **Status tracking** (Open → In progress → Fixed) + **notify reporter on resolve** |
| Who can report | Logged-in users (session) |

## User flow

1. User clicks the floating **🐛 Report a bug** button (or shortcut).
2. Modal opens:
   - Title + description
   - Category (Bug / UI / Performance / Other), severity (Low / Medium / High)
   - Auto-captured silently: current URL, browser + OS, userId, recent console errors
   - Screenshot of the current screen (via `html-to-image`, already a dependency) with
     annotate (draw / highlight) before attaching
3. On submit:
   1. Save a `BugReport` row (status `OPEN`) with everything incl. screenshot + context
   2. Create a **GitHub issue** in the Ko-Lab repo (labels + context in body) → GitHub emails
      the owner automatically. Store issue number + URL on the row.
   3. Thank-you toast with a link to track it.
4. Follow-up:
   - **My reports** — reporter sees their submissions + status.
   - **Admin view** (owner only) — list/filter all, update status.
   - Marking a report **Fixed** notifies the reporter via the existing notifications system.

## Data model

```prisma
enum BugStatus { OPEN IN_PROGRESS FIXED WONT_FIX }
enum BugSeverity { LOW MEDIUM HIGH }
enum BugCategory { BUG UI PERFORMANCE OTHER }

model BugReport {
  id              String       @id @default(cuid())
  reporterId      String
  title           String
  description     String       @db.Text
  category        BugCategory  @default(BUG)
  severity        BugSeverity  @default(MEDIUM)
  status          BugStatus    @default(OPEN)
  // Auto-captured context
  url             String?
  userAgent       String?
  context         Json?        // { errors: string[], viewport, ... }
  screenshot      String?      @db.Text // data URL (v1); blob storage is a later upgrade
  // GitHub linkage
  githubIssueNo   Int?
  githubIssueUrl  String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  reporter        User         @relation("UserBugReports", fields: [reporterId], references: [id])

  @@index([reporterId])
  @@index([status])
}
```
(+ `bugReports BugReport[] @relation("UserBugReports")` on `User`.)

## API routes

- `POST /api/bug-report` — create report (session user = reporter); saves row, creates GitHub
  issue (best-effort), returns the report.
- `GET  /api/bug-report` — list the caller's own reports (`?mine=1`) or, for the app owner, all.
- `PATCH /api/bug-report/[id]` — owner-only; update status. On → FIXED, notify the reporter.

## GitHub integration

- Env: `BUG_REPORT_REPO` (e.g. `VanshikaSabharwal/ko-lab`) + `BUG_REPORT_GITHUB_TOKEN`
  (a PAT with `repo`/issues write — the issue is created with a dedicated bot token, NOT the
  reporter's, since reports come from any user).
- Issue body includes description, category/severity, URL, browser, and a link back to the
  in-app admin report. Labels: `bug-report`, severity.
- **Graceful degradation:** if the env vars aren't set, the report still saves to the DB and
  shows in the admin/my-reports views — only the GitHub issue step is skipped.

## Screenshot storage

- v1: store the annotated screenshot as a data URL in `BugReport.screenshot` (works, simple).
  GitHub's issue API doesn't cleanly accept image uploads, so the issue links to the in-app
  report instead of embedding the image.
- Later upgrade: push to blob storage (Vercel Blob / Cloudinary) and embed a real URL.

## UI surfaces

- `BugReportButton` — floating button + capture modal (screenshot canvas + annotate + form).
  Mounted globally (in `Providers`, next to `CallUI`).
- `/bugs` — "My reports" list with status badges; owner also sees all + status controls.

## Phases

1. Schema + `POST`/`GET` API + floating button + capture modal (text + auto-context). Saves to DB.
2. Screenshot capture + annotate.
3. GitHub issue creation on submit (graceful if env unset).
4. `/bugs` status tracking + owner admin controls + notify-on-resolve.
