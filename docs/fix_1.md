# fix_1.md — Ko-Lab fix log

Tracking file for the 5 issues raised. Each entry: error → one-line summary → root cause → fix → steps → verification.

Status legend: ☐ todo · ◐ in progress · ☑ done

---

## FIX-1 · "Notifications" label is black in dark mode

**Status:** ☑ done

**One-line summary:** The chat-room sidebar's "Notifications" link is hardcoded `text-black`, so it disappears against the dark background.

**Error / symptom**
On `/chat-room` in dark mode, the word "Notifications" renders black-on-dark and is effectively invisible.

**File:** `apps/web/app/components/Notifications.tsx:37`

**Root cause**
```tsx
className="text-black hover:text-blue-600 font-semibold text-lg …"
```
Tailwind is configured with `darkMode: "class"` (`apps/web/tailwind.config.js:2`) and the app wraps everything in `next-themes` with `attribute="class"` (`apps/web/provider.tsx:11`). Every other component pairs a light class with a `dark:` variant; this one has no `dark:` variant at all, so `text-black` applies in both themes.

Secondary defect in the same file: it uses `useState`/`useEffect`/`useSession` but has no `"use client"` directive. It only works today because its importer (`Chats.tsx`) is a client component — it would break if ever imported from a server component.

**Fix**
1. Add `dark:` variants to the link colour.
2. Add the missing `"use client"` directive.
3. Sweep the rest of the app for the same class of bug (`text-black` / `text-gray-900` with no `dark:` sibling).

**Steps**
- [x] `text-black` → `text-gray-900 dark:text-white`
- [x] `hover:text-blue-600` → `hover:text-blue-600 dark:hover:text-blue-400`
- [x] Prepend `"use client";`
- [x] Run the sweep: `grep -rn 'text-black' apps/web/app --include=*.tsx | grep -v 'dark:'`

**Sweep result:** exactly one further occurrence —
`confirm-changes/[groupId]/Confirm.tsx:318`, a change-request title input styled
`flex-1 rounded p-2 text-black` with no background class. Not actually broken (black
text on a browser-default white input is legible), but incorrect in principle: it
relies on the input's UA default rather than declaring its own surface. Given explicit
light/dark background, text, border and placeholder colours.

`grep -rn 'text-gray-900' apps/web/app --include=*.tsx | grep -v 'dark:'` returned
no hits — that half of the sweep was already clean.

**Verification**
- Toggle dark/light from the profile page; the label must be legible in both.
- `npx tsc --noEmit` clean.

---

## FIX-2 · Bug report button is not movable

**Status:** ☑ done

**One-line summary:** The floating "Report a bug" launcher is pinned to `bottom-5 right-5`, where it permanently covers the workspace canvas MiniMap and any bottom-right UI.

**Error / symptom**
The launcher cannot be moved out of the way. On the workspace boards it sits directly on top of React Flow's MiniMap and Controls, which occupy the same corner.

**File:** `apps/web/app/components/bug/BugReportButton.tsx:176`

**Root cause**
```tsx
className="fixed bottom-5 right-5 z-[90] …"
```
Position is a static Tailwind anchor with no drag affordance and no persisted state.

**Fix**
Make the launcher draggable via Pointer Events (works for mouse *and* touch with one code path), clamped to the viewport and persisted to `localStorage`.

Critical detail: a `click` handler fires after a drag completes, so the existing `onClick={() => setOpen(true)}` must be **removed** and replaced by an open-on-pointerup that only fires when the pointer moved less than a small threshold. Otherwise every reposition also opens the modal.

**Steps**
- [x] Add `pos` state (`null` = default bottom-right anchor) + a `drag` ref holding grab offset and a `moved` flag
- [x] `onPointerDown`: `setPointerCapture`, record offset, `moved = false`
- [x] `onPointerMove`: update `pos`, clamped to `[8, innerWidth - w - 8] × [8, innerHeight - h - 8]`; set `moved = true` past a 4px threshold
- [x] `onPointerUp`: release capture; open the modal only if `moved === false`
- [x] Remove the existing `onClick`
- [x] Persist to `localStorage["ko-lab:bugbtn-pos"]` inside try/catch (private mode throws); restore in `useEffect` so SSR markup matches
- [x] Re-clamp on `window.resize` so the button can't strand off-screen after a rotate
- [x] Add `touch-none` (prevents the page scrolling while touch-dragging) and `cursor-grab active:cursor-grabbing`
- [x] Mobile: icon-only circle below `sm:` so it occludes less of a 390px viewport
- [x] `title="Drag to move · click to report"` + `aria-label="Report a bug"` (the title is now an instruction, so the accessible name is set separately)
- [x] Also handle `onPointerCancel` — an interrupted touch gesture would otherwise leave `drag.current` populated

**Extracted helpers** (module scope, above the component): `loadPos()`, `savePos()`,
`clampToViewport()`, and constants `POS_STORAGE_KEY`, `VIEWPORT_MARGIN`,
`DRAG_THRESHOLD_PX`. All hooks stay above the existing
`if (status !== "authenticated") return null;` early return.

**Verification**
- Drag to each corner → reload → position persists.
- Click without moving → modal opens. Drag then release → modal does **not** open.
- Touch-drag on a phone → page does not scroll underneath.
- Rotate device → button stays on-screen.

---

## FIX-3 · DB schema: tables cannot be moved or connected

**Status:** ☑ done

**One-line summary:** Table nodes are fully covered by `nodrag` children so there is no draggable surface, and their connection handles are id-less, 6px, and painted over by the header — so neither dragging nor connecting can initiate.

**Error / symptom**
On `/workspace/[groupId]/db-schema`, tables cannot be repositioned and dragging between tables never creates a relation.

**Files:**
- `apps/web/app/workspace/[groupId]/db-schema/TableNode.tsx:26-28`
- `apps/web/app/workspace/[groupId]/db-schema/DbSchema.tsx:79-89`

**Root cause — three distinct defects**

**(a) No draggable surface.** Every interactive child of the node carries `nodrag` (lines 34, 45, 52, 58, 63, 73) and collectively they cover the node's entire area. The only drag-eligible pixels left are the 1px border and a sliver of header padding — unhittable in practice, and impossible on touch. Contrast `mind-map/StickyNoteNode.tsx`, which has no `nodrag` anywhere and drags correctly.

**(b) Handles are unusable.**
```tsx
<Handle type="target" position={Position.Left}  className="!bg-blue-500" />
<Handle type="source" position={Position.Right} className="!bg-blue-500" />
```
React Flow's default handle is 6×6px. These render as the node's first children and are overpainted by the header block's `bg-gray-700/60` (line 30). Neither carries an `id`, so `onConnect` receives `sourceHandle: null` / `targetHandle: null`.

**(c) Latent — surfaces only once (a) and (b) are fixed.** `useWorkspaceBoard.onNodesChange` (`lib/useWorkspaceBoard.ts:140-146`) broadcasts on *every* change. A continuous drag emits ~60 ops/sec; the WS server enforces `MAX_MESSAGE_SIZE_BYTES = 8_000` and a per-second message cap (`apps/web-socket/src/index.ts:17,319,326`) and replies `{type:"error"}`, which the client ignores. Result would be silently dropped ops and desynced peers. Fixing (a)+(b) without (c) trades one bug for a worse one — they ship together.

**Fix**
- (a) Give the node an explicit drag handle and set `dragHandle` on the node objects. With an explicit `dragHandle`, React Flow ignores `nodrag` ambiguity entirely — this is the robust fix rather than removing `nodrag` (which is still needed for text selection).
- (b) Give both handles explicit `id`s and real hit areas; enable `ConnectionMode.Loose` and a larger `connectionRadius`; add per-column handles so a relation can target a specific FK column.
- (c) Throttle in-flight drag broadcasts while keeping local state updates immediate.

**Steps**
- [x] `TableNode`: `GripVertical` drag handle; the **whole header** is the drag surface, class `table-drag-handle`
- [x] `DbSchema.handleAddTable`: add `dragHandle: ".table-drag-handle"` to created nodes
- [x] **Backfill** `dragHandle` in `displayNodes` for tables persisted before this change — without it, existing boards stay unmovable after the fix
- [x] Bump touch targets: icon buttons `size={16}` + `p-1.5`, shrinking to `md:h-3 md:w-3`; rows `py-2` → `md:py-1`
- [x] Handles: `id="table-l"` / `id="table-r"`, `!h-3 !w-3`, `!border-2 !border-white`
- [x] `WorkspaceCanvas`: `connectionMode={ConnectionMode.Loose}`, `connectionRadius={isCoarsePointer ? 44 : 30}`
- [x] New `lib/useCoarsePointer.ts` — `(pointer: coarse)` media query, starts `false` so SSR and first client render agree. Reused by FIX-5.
- [x] Per-column handles (`col-${col.id}-l` / `-r`) for column-level relations
- [x] `handleConnect` in `DbSchema` stamps `type: "relation"` + `label: "1-1"` at creation
- [x] Widened `useWorkspaceBoard.onConnect` to `Connection | Edge` (and the `connect` op type) rather than casting — `addEdge` accepts both, and the remote-op path must carry the same enrichment or peers would render the edge differently
- [x] `onNodesChange`: coalesce in-flight `dragging:true` position changes per node id, flush at most every 50ms (`DRAG_BROADCAST_MS`) with a trailing timer so the last tick is never lost; all other change types send immediately, and a pending drag is flushed first so ordering holds. Cleanup clears the timer on unmount.
- [x] `usePlanningBoard`: if `JSON.stringify(next)` exceeds `MAX_OP_BYTES` (7,000 — headroom under the server's 8,000 for the message envelope), emit `{action:"invalidate"}` instead and save immediately; `applyRemoteOp` handles `invalidate` by bumping a `refetchToken` that re-runs the load effect

**Verified:** `npx tsc --noEmit` clean · `npx next lint` on the changed paths reports
no warnings or errors.

**Note on the test suite:** `npm test` shows 16 failed / 54 passed. This is a
**pre-existing baseline** — confirmed by stashing all changes and re-running, which
gives the identical 16/54. The failures are auth mocking in the calls/webhook API
tests and are unrelated to this work. Likewise `__tests__/components/CallSignaling.test.ts(21,3)`
`Cannot find name 'afterAll'` in tsc is pre-existing (a missing vitest global).

**Verification**
- Add two tables; drag each by its header → both move.
- Drag right handle → other table's left handle → edge appears labelled `1-1`; clicking the label cycles cardinality.
- Reload → positions and edge persist.
- Two browser profiles on the same board → moves and edges replicate within ~100ms.
- Drag continuously ~5s → no `Rate limit exceeded` in either console; final positions agree.

---

## FIX-4 · Milestones workspace is a list, not a timeline

**Status:** ☑ done

**One-line summary:** The milestone "timeline" is a sorted `<ol>` with timeline styling — dates only drive sort order, nothing is positioned proportionally to time, and the existing card links drive no progress.

**File:** `apps/web/app/workspace/[groupId]/planning/MilestoneTimeline.tsx`

**How it is currently built** (the explanation requested)
- **Data model:** one `WorkspaceBoard` row per group, `type = PLANNING`, `content` as a JSON blob shaped `{ columns, cards, milestones }` (`lib/usePlanningBoard.ts:25-39`). A milestone is `{ id, title, dueDate, cardIds }`. Kanban and milestones deliberately share one blob so milestones can reference kanban cards by id.
- **Sync:** broadcasts the **entire** content object on every change (`usePlanningBoard.ts:104-113`). This violates the project's own spec (`workspaces-config-v1.json` → `op_shape_guidance`: ops must be small deltas, never full board content, because of the 8KB cap). ~40 cards will exceed 8KB and the board **silently stops syncing**.
- **Rendering:** a vertical `<ol>` with a left border as the spine and an absolutely-positioned dot per item (lines 75-78). `dueDate` is only used for `localeCompare` sorting (line 18). No duration, no progress, no status, no drag. Container is `max-w-2xl` (line 51), wasting the full canvas width.

**Why it is weak:** it is a sorted list wearing timeline styling. The `cardIds` link already exists but computes nothing — that unused link is the largest available win.

**Fix**
Rewrite as a real date-scaled Gantt. All new model fields are **optional**, so `content` being `Json` means **no DB migration**.

```ts
export interface Milestone {
  id: string;
  title: string;
  dueDate: string;      // keep — existing rows depend on it
  startDate?: string;   // new
  cardIds: string[];
  color?: string;       // new
  done?: boolean;       // new
}
```
Read `startDate ?? dueDate` so existing milestones render as zero-duration markers.

**Steps**
- [x] Extend `Milestone` with optional `startDate` / `done`; add `milestoneRange()` rather than a `normalizeMilestone()` — callers only ever need the resolved start/end pair, so a range helper is the smaller surface
- [x] New `lib/timelineScale.ts` — `buildTimelineScale(dates)` returning `toPct`, `startMs/endMs` and month `ticks`, plus `shiftISODate` / `daysBetween`. Pure and React-free so the arithmetic is directly testable.
- [x] Horizontal track: absolutely-positioned bar per milestone, `left`/`width` in percent, `minWidth: 96` floor, month tick header
- [x] `milestoneProgress()` — `cardsInDoneColumn / cardIds.length`, done column matched by `/done|complete|shipped/i` with last-column fallback. Returns **null** when nothing is linked so "untracked" is distinguishable from "0%".
- [x] `milestoneStatus()` — `done` / `overdue` / `at-risk` (≤7d && <50%) / `on-track`, each paired with an icon **and** a text label, never colour alone
- [x] Desktop drag-to-reschedule: pointer capture, dx→days via the same scale, moves start and due together preserving duration; listeners on `window` so a fast drag doesn't outrun the bar
- [x] Mobile (`md:hidden`): card list with progress bar, status chip and date range; tap opens the edit sheet
- [x] Shared `MilestoneEditor` sheet — precise date entry, done toggle, task linking, delete. Bottom sheet on phones, centred dialog at `sm:`.
- [x] Add form stacks `flex-col` → `sm:flex-row`; dropped `max-w-2xl`
- [x] Numeric date comparison replaces `localeCompare`

**Deviations from plan, and why**
- **Edge grips to resize one end** were not built. Dragging moves the whole bar
  with its duration intact; changing start and due independently is done in the
  editor sheet, which is unambiguous and works on both platforms. Worth adding
  later if you want it directly on the bar.
- **A visible "Edit" affordance** was added beside each desktop bar. The rewrite
  had left delete reachable only via double-click, which is undiscoverable.

**Verification**
- [x] 23 unit tests across `__tests__/workspace/timelineScale.test.ts` and
  `milestoneProgress.test.ts` — scale midpoint/clamping/same-day/empty input,
  month-boundary and leap-day arithmetic, progress with missing cards, done-column
  matching by name and by fallback, and every status branch. All pass.
- Still to check by hand: add milestones with differing dates, link cards, move a
  card to "Done" → progress advances; drag a bar → dates shift; mobile shows the
  card list, not the Gantt.

---

## FIX-5 · Workspace layouts are not responsive

**Status:** ☑ done

**One-line summary:** All four boards assume a wide desktop viewport — fixed-width side panels, `h-screen`, and a palette whose drag mechanism does not fire on touch at all.

**Breakdown**

| Location | Problem |
|---|---|
| `components/WorkspaceCanvas.tsx:149` | `h-screen` + flex-row body; `vh` is clipped behind mobile browser chrome |
| `components/WorkspaceCanvas.tsx:170-189` | `sidebar` / canvas / `rightPanel` are unconditional flex siblings — no breakpoint, no drawer |
| `ui-design/UiPalette.tsx:26` | fixed `w-44 shrink-0` |
| `ui-design/PropertiesPanel.tsx:37,50` | fixed `w-52 shrink-0` — 384px of chrome before any canvas on a 390px screen |
| `ui-design/UiPalette.tsx:13-16` | **HTML5 `dragstart`/`dataTransfer` never fires on touch** — the UI design board is unusable on mobile by construction |
| `planning/KanbanCard.tsx:20-33` | dnd-kit `listeners` spread on the card root, so a swipe-to-scroll and a drag are indistinguishable on touch (hence the `onPointerDown` stopPropagation hack on line 30) |
| `planning/KanbanColumn.tsx:31` | fixed `w-64`; a column never fills a narrow screen |
| `planning/MilestoneTimeline.tsx:51-52` | 3-child flex add-row overflows below ~420px |
| `db-schema/TableNode.tsx:26` | `w-60` with 12px text and 12px icon buttons — below the 44px touch-target minimum |
| `components/WorkspaceCanvas.tsx:114` | `colorMode="dark"` hardcoded; shell `bg-gray-900 text-white` has no light variant |
| `planning/Planning.tsx:26,44-60` | header packs breadcrumb + title + toggle + presence in one non-wrapping row |

**Fix**
Adaptive single component tree (no forked mobile components): panels become slide-over drawers below `md:` and render inline exactly as today at `md:` and up, so **the desktop layout is unchanged**.

**Steps — shared shell**
- [x] `useTheme()` → `colorMode={resolvedTheme === "light" ? "light" : "dark"}`
- [x] Shell converted to light/dark pairs throughout
- [x] `RelationEdge` stroke picks `#2563eb` on light, `#60a5fa` on dark
- [x] `panel` state + slide-over drawers with `bg-black/40` backdrop; `md:relative md:!translate-x-0` restores the desktop layout unchanged
- [x] Mobile-only (`md:hidden`) `PanelLeft` / `PanelRight` toggles in the header, plus a `DrawerClose` button inside each drawer
- [x] Header `flex-wrap` + `truncate min-w-0` title; breadcrumb label hidden below `sm:`
- [x] `h-screen` → `h-[100dvh]` in `WorkspaceCanvas`, `Planning` and `WorkspaceHub`
- [x] Canvas toolbar moves to `bottom-3` below `md:`, wraps
- [x] MiniMap hidden below `md:`; Controls lifted to `!bottom-16` so the mobile toolbar clears it
- [x] `zoomOnPinch` + `panOnScroll` enabled

**Steps — per board**
- [x] `UiPalette`: `onPick` tap-to-insert alongside the drag path; chips became `<button>` (they were `<div draggable>`, unreachable by keyboard)
- [x] `KanbanBoard`: `TouchSensor` with `{ delay: 200, tolerance: 8 }`
- [x] `KanbanCard`: listeners moved onto a `GripVertical` handle; both `stopPropagation` hacks removed as a result. Delete button no longer hover-only on touch (`md:opacity-0 md:group-hover:opacity-100`).
- [x] `KanbanColumn`: `w-[85vw] max-w-xs md:w-64`, snap scrolling
- [x] Theme pass across `WorkspaceHub`, `BoardToolbar`, `PresenceBar`, `TableNode`, `PropertiesPanel`, `KanbanColumn`, `KanbanCard`, `MilestoneTimeline`, `Planning`, `RelationEdge`

**Wiring note — why `renderSidebar` exists**
Tap-to-insert needs `screenToFlowPosition`, which is only available inside
`ReactFlowProvider`; the board components render *outside* it. Rather than move
the provider, `WorkspaceCanvas` gained an optional `renderSidebar(insertAtCenter)`
render prop, resolved by a small `SidebarSlot` that lives inside the provider.
The plain `sidebar` prop still works for boards that don't need it.

**Deliberately not themed:** `UiPrimitiveNode.KIND_CLASSES` and the sticky-note
colours. These are the *content being designed* — a wireframe mockup and the
user's chosen note colours — not app chrome. Flipping them with the app theme
would alter the user's artboard. Only `StickyNoteNode`'s selection ring gained a
light variant, since that is chrome. Flag it if you'd rather they follow the theme.

**Open item — resolved.** `setNodeRef` is confirmed correct on the installed
dnd-kit: `@dnd-kit/core@6.3.1` declares it on `useDroppable`/`useDraggable`, and
`@dnd-kit/sortable@10.0.0` on `useSortable`. No change needed; the existing
kanban destructuring was never wrong.

**Verification (mobile — DevTools 390×844, then a real device)**
- Each board: header does not overflow; no horizontal page scroll; canvas fills the viewport with the URL bar both shown and hidden (`100dvh` check).
- UI design: open palette drawer, **tap** a primitive → it lands on canvas, drawer closes. Desktop drag still works.
- DB schema: one-finger drag by handle; pinch-zoom; handle-to-handle connect — all by touch.
- Kanban: vertical swipe scrolls (no accidental drag); 200ms long-press on the grip then move → drags between columns; columns snap one-per-screen.
- Milestones: mobile shows the vertical list; tap opens the edit sheet with working date inputs.
- Both themes on all four boards + `/workspace/[groupId]` → no dark-on-dark or black-on-white.

---

## Commit sequence

1. `fix: notifications label in dark mode` (+ the wider `text-black` sweep) — **FIX-1**
2. `feat: draggable bug report launcher` — **FIX-2**
3. `fix: db schema tables can be moved and connected` — **FIX-3** (a)(b)
4. `perf: throttle workspace drag broadcasts` — **FIX-3** (c), also guards planning op size
5. `feat: theme-aware workspace canvases` — **FIX-5** theme half
6. `feat: responsive workspace layouts with mobile drawers` — **FIX-5** layout half
7. `feat: date-scaled milestone timeline with progress` — **FIX-4**

Each is independently revertable. 3 and 4 are tested together — 4 prevents the desync that 3 would otherwise expose.

**No new dependencies.** `@xyflow/react` 12.11.2, `@dnd-kit/core` v6 + `sortable` v10, `next-themes`, `lucide-react`, `uuid` are all installed.
