# Ko-Lab

A real-time collaborative code editor with group workspaces, GitHub integration, and built-in team chat.

## Features

### Collaboration
- **Collaborative code editor** — multi-user real-time editing powered by WebSockets, with syntax highlighting for JavaScript, Python, Java, and HTML (CodeMirror 6)
- **Change request workflow** — members submit code changes, the group owner reviews and approves or rejects them; history is preserved
- **GitHub integration** — link any GitHub repo to a group; commits and file modifications sync back to GitHub via the Octokit REST API
- **SSH key management** — generate and register an SSH key from within the app to authorise pushes to GitHub
- **AI Assistant: "What did I miss?"** — LLM-powered chatbot (Groq) that queries your workspace across groups, tasks, code changes, and calls in one question

### Groups & Notifications
- **Create a group** — attach a GitHub repo, name the group, and invite members by phone number
- **Group chat** — real-time messaging with emoji reactions, message status (sending / delivered / read), background themes, and browser push notifications
- **Live notifications** — instant push to open WebSocket connections; fallback to DB persistence for offline users
- **Member roles** — ADMIN (owner) and MEMBER; only the owner can add members and approve changes
- **Guest access** — time-limited guest sessions for read-only collaboration without an account

### Direct Messaging
- **One-to-one chat** — find a contact by phone number; messages delivered in real time via WebSocket with offline persistence
- **Read receipts** — single tick (sending), double tick (delivered), blue double tick (read)
- **New message divider** — visual separator for messages received while offline
- **Browser push notifications** — get notified of new messages even when the tab is in the background

### Social
- **Friends** — search users by phone number, add them as friends, and access their chat from the sidebar in one click
- **Friend search** — checks whether the current user has a phone number set; if not, prompts to add one before searching

### Profile & Settings
- **Profile page** — view and edit display name, phone number; email is read-only
- **Connected accounts** — see which providers (GitHub, Google) are linked; connect a missing one with a single click
- **Notification toggle** — enable or disable browser push notifications; requests permission on first enable; shows a warning when blocked by the browser

### UI / UX
- **Dark mode** — full light/dark theme toggle, persisted across sessions
- **Onboarding tours** — per-page guided tours (Shepherd.js) shown once on first visit; storageKey prevents repeat display
- **Searchable repo dropdown** — the GitHub group-creation page replaces the native `<select>` with a filterable dropdown with live search and clear button
- **Chat background themes** — six colour themes per chat (Default, Midnight, Sky, Sage, Rose, Sand), stored per conversation in `localStorage`
- **Responsive layout** — sidebar collapses on mobile; group chats redirect to a dedicated page on small screens

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Monorepo | Turborepo 2 |
| Database | PostgreSQL + Prisma 5 |
| Auth | NextAuth v4 (GitHub OAuth, Google OAuth) |
| Real-time | WebSocket server (`apps/web-socket`) |
| LLM | Groq (`openai/gpt-oss-20b`) + tool calling |
| Styling | Tailwind CSS 3 |
| Editor | CodeMirror 6 via `@uiw/react-codemirror` |
| GitHub API | Octokit REST |
| File storage | S3 (`@aws-sdk/client-s3`) — LocalStack in development |
| Animations | Framer Motion |
| Onboarding | Shepherd.js |
| Notifications | React Hot Toast + Web Notifications API |
| Voice input | Web Speech API (browser native) |

---

## Project Structure

```
ko-lab/
├── apps/
│   ├── web/                  # Next.js frontend + API routes
│   │   ├── app/
│   │   │   ├── api/          # REST API routes
│   │   │   ├── components/   # Shared UI components
│   │   │   ├── github/       # GitHub group creation page
│   │   │   ├── group/        # Group chat + code editor
│   │   │   ├── chat/         # Direct message chat
│   │   │   ├── chat-room/    # Chat sidebar (groups + friends)
│   │   │   ├── profile/      # User profile + settings
│   │   │   ├── notifications/ # Notification centre
│   │   │   └── ...           # Auth pages, member management, etc.
│   │   └── prisma/           # Database schema + migrations
│   └── web-socket/           # Standalone WebSocket server
└── packages/
    ├── ui/                   # Shared React component library
    ├── eslint-config/
    └── typescript-config/
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- GitHub OAuth app ([create one](https://github.com/settings/developers))
- Google OAuth credentials ([create one](https://console.cloud.google.com/))
- Docker — only for [LocalStack](#localstack-local-s3), which backs image uploads in development

### Environment Variables

Create `apps/web/.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/colab

NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here

GITHUB_ID=your-github-oauth-app-id
GITHUB_SECRET=your-github-oauth-app-secret

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

NEXT_PUBLIC_WEB_SOCKET_URL=ws://localhost:8080
ALLOWED_ORIGINS=http://localhost:3000

# Groq (for AI assistant — optional, assistant disabled if unset)
GROQ_API_KEY=gsk_your-key-here

# S3 (LocalStack in development — see below).
# The credentials are placeholders: LocalStack accepts any value.
S3_ENDPOINT=http://localhost:4566
S3_BUCKET=avatars
S3_FORCE_PATH_STYLE=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# Service-to-service (optional, live notifications disabled if unset)
GIT_SERVICE_URL=http://localhost:8080
GIT_SERVICE_SECRET=your-secret-key
```

### Install & Run

```bash
# Install dependencies
npm install

# Push the database schema
cd apps/web && npx prisma db push

# Start all apps in development
npm run dev
```

The web app runs on `http://localhost:3000` and the WebSocket server on `ws://localhost:8080`.

### LocalStack (local S3)

Image uploads — currently profile avatars — go to S3 via `apps/web/app/lib/s3.ts`. In development
that S3 is [LocalStack](https://localstack.cloud/) running in Docker, so no AWS account or real
credentials are needed. Point `S3_ENDPOINT` at a real bucket in production and the same code path
is used unchanged.

```bash
cd apps/web

npm run localstack:up     # start LocalStack (creates the avatars bucket)
npm run localstack:logs   # follow its logs
npm run localstack:down   # stop it
```

Notes:

- Runs on port `4566` and only enables the `s3` service.
- The bucket named by `S3_BUCKET` is created automatically on startup.
- Uploads persist between restarts, in a Docker volume rather than the repo.
- `next.config.mjs` allows `localhost:4566` as an image host and in the CSP, but only when
  `NODE_ENV !== "production"` — so the dev-only endpoint is never trusted in a deployed build.

### Build for Production

```bash
npm run build
npm start
```

---

## API Routes

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth session handling |
| POST | `/api/assistant` | LLM-powered chatbot (Groq tool calling) |
| GET/POST | `/api/profile` | Get and update user profile |
| GET/POST | `/api/friends` | List friends / add a friend by phone |
| POST | `/api/friend-search` | Find a user by phone number |
| POST | `/api/set-phone` | Save the current user's phone number |
| GET | `/api/get-user-number` | Look up a user by email, id, or phone |
| GET | `/api/lookup-user` | Check if user exists by email (combined endpoint) |
| POST | `/api/create-group-data` | Create a group linked to a GitHub repo |
| GET | `/api/my-groups` | List groups the user owns or belongs to |
| GET | `/api/check-group-member` | Check if a user is a group member |
| POST | `/api/add-group-member` | Add a member to a group |
| GET/POST | `/api/save-group-message` | Fetch or save group chat messages |
| GET/POST | `/api/direct-message` | Fetch or send a direct message |
| GET | `/api/direct-message/unread` | Count unread direct messages |
| GET/POST | `/api/notifications` | Fetch or dismiss notifications |
| POST | `/api/send-invite` | Send a group invite by phone |
| GET/POST | `/api/files` | List or save code editor files |
| POST | `/api/save-coding-files` | Persist code changes to a file |
| POST | `/api/commit-changes` | Commit approved changes to GitHub |
| POST | `/api/change-request` | Submit a change request |
| POST | `/api/rejected-cr` | Record a rejected change request |
| GET | `/api/modified-files` | List files changed in a session |
| GET | `/api/github` | Proxy GitHub repo file tree |

---

## Database Models

```
User            — profile, phone, OAuth accounts
Account         — linked OAuth providers (GitHub, Google)
Friendship      — accepted friend relationships
Group           — collaborative workspace linked to a GitHub repo
GroupMember     — user ↔ group membership with role (ADMIN / MEMBER)
GroupMessage    — group chat messages
Chat            — direct message conversation
Messages        — individual direct messages with read status
Invite          — pending group invitations (by phone)
File            — code editor file content per group
ModifiedFiles   — tracked changes within a session
Change          — line-level diff entries
Notifications   — group join / invite notifications
RejectedCr      — rejected change request records
ApprovedCr      — approved change request records
GuestUser       — anonymous time-limited session
GuestGroup      — guest ↔ group access mapping
Otp             — one-time passwords for phone auth
Testimonial     — user feedback shown on landing page
```

---

## Deployment

The project is deployed on [Vercel](https://vercel.com). Set all environment variables listed above in the Vercel project settings. The WebSocket server (`apps/web-socket`) should be deployed separately (e.g. a Railway or Fly.io instance) and its public URL set as `NEXT_PUBLIC_WEB_SOCKET_URL`.
