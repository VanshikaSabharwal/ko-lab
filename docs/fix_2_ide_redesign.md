# fix_2 — Code Editor (IDE) redesign

Rebuild `/code-editor/[groupId]/[githubRepo]` to match the provided mockup, using Ko-lab's existing blue palette rather than the mockup's violet.

**Do this AFTER the Planning & Milestones workspace rebuild is complete.** That work introduces the app shell (sidebar, top bar, `cn()` helper, design tokens, `Avatar`/`AvatarStack`) which this plan reuses. Starting here first would mean building the same chrome twice.

Status legend: ☐ todo · ◐ in progress · ☑ done

---

## Decisions taken

| Question | Decision |
|---|---|
| Palette | **Blue accent, mockup's layout and depth.** Purple stays the secondary accent it already is (logo gradient, AI surfaces). |
| AI Assistant | **Full working chat with Apply Fix.** |
| AI provider | **Groq** (`llama-3.3-70b-versatile`) — matches the existing README feature. One provider, one key, no new dependency. |
| Apply Fix safety | **Diff preview + explicit accept.** Nothing is written until the user accepts. |
| Diagnostics | **CodeMirror's built-in linting** (`@codemirror/lint`). Real, in-browser, no server calls. |
| "+ New Project" | **Links to the existing `/create-group` flow.** No duplicated repo-binding logic. |
| Themes | Light and dark, consistent with the rest of the app. |
| **Mobile** | **Responsive, one codebase.** Sidebar → drawer below `md:`, bottom tab bar (Files/Collab/Settings), AI panel → floating button opening a sheet. |
| **Sequencing** | **Layout first, AI wired after.** FIX-2.4 splits: panel UI ships with the shell; Groq streaming + Apply Fix land as a separate step. |

---

## Palette translation

The mockup is violet-on-near-black. Ko-lab is blue-on-gray: `bg-blue-600` (×32), `bg-blue-500` (×22), `text-blue-500` (×19), with purple appearing only in the logo gradient (`from-blue-500 to-purple-600`) and `text-purple-400` (×9).

Translation rule — **keep the mockup's structure, swap its hue**:

| Mockup element | Ko-lab equivalent |
|---|---|
| Violet primary button ("New Project") | `bg-blue-600 hover:bg-blue-500` |
| Violet active nav pill | `bg-blue-600/15 text-blue-400 border-l-2 border-blue-500` |
| Violet focus ring / active tab underline | `border-blue-500`, `ring-blue-500` |
| Near-black page ground `#0d0d14` | `bg-gray-950` (already the app's `<body>` in dark) |
| Panel surfaces | `bg-gray-900`, elevated `bg-gray-800` |
| Panel borders | `border-gray-800` / `border-gray-700` |
| **AI Assistant accent** | **keep purple** — `bg-purple-600`, `text-purple-400`. Purple becomes the consistent "AI" signal across Generate README and the assistant. |

What carries over from the mockup unchanged: the layout grid, panel depth and rounding, generous padding, the icon-led file tree, the tab bar, and the status bar.

---

## What exists today

`apps/web/app/code-editor/[groupId]/[githubRepo]/Editor.tsx` is **1071 lines in a single component**. It already contains a file-explorer sidebar (~L756-841), CodeMirror, branch/VCS state, and the Generate README trigger. It has no tab bar, no AI panel, and no status bar.

`api/generate-readme/route.ts` is the only AI feature: it walks the GitHub tree, collects ~20 important files (truncated to 3000 chars each), and POSTs to `https://api.groq.com/openai/v1/chat/completions` with `model: "llama-3.3-70b-versatile"`, gated on `process.env.GROQ_API_KEY`. **Groq is OpenAI-compatible, so `stream: true` + SSE works with plain `fetch` — no SDK needed.**

---

## FIX-2.1 · Decompose Editor.tsx

**Status:** ☐ todo

**Why first:** every later step edits this file. Splitting it up front means the redesign is a series of small reviewable diffs instead of one 1000-line rewrite.

**Steps**
- [ ] Extract presentational regions into `code-editor/components/`: `FileTree`, `EditorTabs`, `EditorBreadcrumb`, `StatusBar`, `AiAssistantPanel`, `UndoRedoPill`
- [ ] Lift state into hooks: `useOpenFiles` (tabs + dirty tracking), `useRepoTree`, `useEditorDiagnostics`
- [ ] `Editor.tsx` becomes a layout shell composing those pieces
- [ ] No behavior change in this step — pure refactor, verified by using the editor exactly as before

---

## FIX-2.2 · Shell: sidebar, top bar, tabs, breadcrumb

**Status:** ☐ todo

Reuses the sidebar/top-bar primitives built for the Planning workspace, so this is composition rather than new component work.

**Steps**
- [ ] Left sidebar: "Ko-lab IDE / ACTIVE WORKSPACE" header, `+ New Project` → `/create-group`, nav (Files / Collaboration / Settings), `PROJECT EXPLORER` tree, sign-out pinned bottom
- [ ] Top bar: logo, Files/Collaboration/Settings tabs, "Search files…", notification bell, avatar, Sign out
- [ ] **Collaboration tab → the collaborator UI from `fix_3`.** These two documents meet here.
- [ ] Tab bar: one tab per open file, filetype icon, close ✕, dirty dot for unsaved changes
- [ ] Breadcrumb from the active file's path (`repo > src > index.html`)
- [ ] Filetype icon map (`.html`/`.css`/`.js`/`.ts`/`.json`/`.md` + folder) — small local component, colored per type as in the mockup
- [ ] Search filters the tree by path substring; ⌘K focuses it

**Note:** the Planning work moves the global `<Header/>` into a route group. `/code-editor/*` must be excluded from it too, or the app header will stack above this top bar.

---

## FIX-2.3 · Status bar + real diagnostics

**Status:** ☐ todo

**Steps**
- [ ] Bottom bar: branch name with `*` when dirty, error/warning counts, `UTF-8`, language label, bell
- [ ] Add `@codemirror/lint`; wire `linter()` for the languages whose packages are already installed (JSON, CSS, HTML, JS)
- [ ] Feed the diagnostic count into the status bar via `useEditorDiagnostics`
- [ ] Languages without a linter report `—`, not `0` — **don't imply a clean file when nothing was checked**
- [ ] Clicking the counts opens a problems popover listing them; clicking one jumps to the line

---

## FIX-2.4 · AI Assistant panel

**Status:** ☐ todo

The largest piece. Right-hand panel: message bubbles, `Apply Fix` / `Explain` actions, `Ask AI…` composer.

**API** — `api/ai/assist/route.ts`, following the auth pattern every other route uses (`getSessionUser` → `isGroupMember` → act):

- Accepts `{ groupId, filePath, fileContent, selection?, messages[] }`
- Streams from Groq with `stream: true`, relaying SSE chunks to the client
- **Truncate `fileContent`** the way `generate-readme` already does (3000-char cap per file) — a large file will otherwise blow the context window
- Rate-limit per user; an assistant panel is trivially spammable
- Return a structured `{ type: "edit", newContent }` when the model proposes a fix, so the client can diff it

**Client**
- [ ] `AiAssistantPanel` with streamed rendering, purple accent
- [ ] Composer: Enter sends, Shift+Enter newline, stop button while streaming
- [ ] `Explain` → prose answer. `Apply Fix` → **diff preview, never a direct write**
- [ ] Diff view reuses the `diff` package (already a dependency, already used by the VCS flow); Accept writes to the buffer and marks it dirty; Reject discards
- [ ] Conversation is per-file and in-memory only — no persistence in this phase
- [ ] Panel collapsible; hidden below `lg:` on mobile behind a toggle

**Risk:** Apply Fix is the one feature here that can destroy user work. The diff gate is not optional, and the accepted edit must go through the normal dirty/save path so it is undoable.

---

## FIX-2.5 · Generate AI README restyle

**Status:** ☐ todo

- [ ] Restyle to the mockup's gradient button, purple family (it is an AI surface)
- [ ] Move into the AI panel as a quick action rather than floating over the editor
- [ ] Keep the existing route and behavior — **no functional change**

---

## Verification

- `tsc --noEmit`, `next lint`, `next build` clean.
- **FIX-2.1 is a pure refactor** — open files, edit, save, switch branch, commit, generate README, all behaving exactly as before the split.
- Tabs: open several files, edit one, switch away and back — content and dirty state survive. Closing a dirty tab warns.
- Diagnostics: introduce a real JSON syntax error → count increments; fix it → returns to zero. A `.py` file shows `—`, not `0`.
- AI: ask about the open file → streamed answer. `Apply Fix` → diff appears, Accept applies, Reject leaves the file untouched. Test with `GROQ_API_KEY` **unset** — the panel must degrade with a clear message, not crash.
- Both themes; mobile at 390×844 (sidebar and AI panel collapse).
- Confirm the global app header does not stack above the IDE top bar.

---

## Sequencing

1. FIX-2.1 decompose (no visible change)
2. FIX-2.2 shell
3. FIX-2.3 status bar + diagnostics
4. FIX-2.4 AI assistant ← largest, most risk
5. FIX-2.5 README restyle

Steps 1-3 are safe and mostly mechanical. Step 4 is a genuine feature and could reasonably ship on its own branch.
