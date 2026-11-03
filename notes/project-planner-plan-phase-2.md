---
type: plan
status: active
created: 2026-10-01
updated: 2026-10-01
---

> [!note] Implementation plan — Phase 2: bubble view and drill-in
> Version 1 · 2026-10-01 · **Approved by Heyns 2026-10-01** with the answers in §9. Follows [project-planner-plan-phase-0-1](project-planner-plan-phase-0-1.md) (Phases 0 and 1 accepted 2026-10-01).

Spec: [blueprint v0.2](project-planner-blueprint-v0-2.md) §5.1, §5.3, §9.1 and §11 · Evidence: [verification record](2026-09-30-project-planner-verification.md) (B9, B10, L1–L3, and L11–L13 added for this plan).

---

## 1. Scope

**Phase 2 — Bubble view and drill-in** (blueprint §11): circle pack of the current view root's projects and their sub-projects one level deep, sized by open tasks, coloured by status, with a progress ring and labels that hide when small. Pan and pinch-zoom. Drill-in makes a node the view root; a breadcrumb and the browser/Android back go up one level. Switching between bubble and list keeps the drill-in level and the selection.

**Carried forward from Phase 1:** adding a new tag to a domain's vocabulary table from the app (the `addTag` op exists, the UI does not).

**Out of scope, by the blueprint's own phase list:** typed-link arcs and out-of-view stubs (§5.1 describes them, §11 puts them in **Phase 4** with drag, duplicate and undo); focus highlight and search (Phase 3). The bubble view is built so arcs can be drawn on top later without re-layout. Nothing is written to `Heyns-h/Vault`.

---

## 2. What changes for the user

| Now (Phase 1) | After Phase 2 |
|---|---|
| One view: the list | Header toggle **Bubble · List**; the last used view is remembered per device |
| The list always starts at the top-level projects | A **view root**: all projects, or one node you drilled into. Both views show the same root |
| — | **Breadcrumb** under the header: `All › Necromunda › Fiddlestix`. Tapping a crumb goes there |
| — | **Drill in**: desktop double-click a bubble (or a list row); phone: tap a selected bubble again; both: **Open** in the Inspector header |
| — | Browser back / Android back gesture goes **up one level**; at the top level it leaves the app as usual |
| Tags: pick from the domain's list only | Tags picker gains **Add tag…**: name plus what it means; the row lands in `_<domain>-tags.md` in the same commit as the edit that uses it |

---

## 3. Tooling added

| Package | Version (checked 2026-10-01) | Why |
|---|---|---|
| `d3-hierarchy` | `^3.1.2` (L1, L12) | `hierarchy().sum().sort()` and `pack()` — layout only, no DOM, so it runs in Vitest on Node |
| `d3-zoom` | `^3.0.0` (L2, L11) | Pan, wheel, pinch, double-tap |
| `d3-selection` | `^3.0.0` (L3) | `select(svg).call(zoom)`; d3-zoom needs it |
| `@types/d3-hierarchy` `@types/d3-zoom` `@types/d3-selection` | `3.1.7` / `3.0.9` / `3.0.12` | Types (dev only) |

Not added: `d3-transition` (no animated zoom in this phase; CSS handles the small transitions), `d3-shape` (the progress ring is a stroked circle with `stroke-dasharray`, no arc generator needed), `jsdom`/`happy-dom` (history glue stays thin and is tested on devices; the pure parts are unit-tested in Node). All of d3 is bundled, so the CSP's `script-src 'self'` is unchanged. d3 sets SVG attributes, never `style=""`, so `style-src 'self'` holds too.

---

## 4. File layout (additions)

```
src/
  core/
    layout.ts            pure: graph + root id → pack input tree, open-task weights,
                         minimum sizes, two-level depth; wraps d3-hierarchy
  app/
    nav.ts               pure: view root ↔ URL hash (#/ and #/<stem>); history glue:
                         pushState on user drill-in, popstate → root
  ui/
    BubbleView.tsx       one Preact component; useRef(svg) + useEffect for d3-zoom;
                         circles, rings, labels rendered by Preact from the layout
    Breadcrumb.tsx
    ViewToggle.tsx       Bubble · List segmented control in the header
    TagDialog.tsx        name + "means" for a new tag
tests/
  core/layout.test.ts
  app/nav.test.ts
  fixtures/big.ts        300-node synthetic tree for the performance check (generic names)
```

`ListView` gets a `root` prop (shows that node's subtree) and a double-click/Open path into drill-in. `Inspector` gets an **Open** button. `Session` gets `addTag(domain, tag, meaning)`; `App` owns `view`, `root` and `selectedId`.

---

## 5. How the hard parts work

**Layout (`core/layout.ts`).** Input: the graph and the view root (null = all projects). Output: a tree two levels deep — the root's children, and each child's children — with one weight per node: its open descendant tasks (`idea`, `active`, `on-hold`; done and archived are not counted). `hierarchy(tree).sum(w).sort((a, b) => b.value - a.value)` then `pack().size([w, h]).padding(…)` (L12). Every node is given a **floor weight** so a project with no tasks still gets a visible circle, and an empty root shows an "add a project" message instead of nothing. Children at level two are drawn but not opened further; a small count badge says how much is underneath. **The layout is recomputed from the graph on every render and never stored** (blueprint §5.1): `useMemo` on graph, root and the SVG's size. Blocked status is shown with the `on-hold` colour; derived-blocked (a blocker not done) gets the rust ring from the roll-up, so colours match the list.

**Rendering.** Preact renders the `<svg>`, one `<g class="pl-world">` for the camera, and inside it one `<g data-node>` per circle: fill by status, a `stroke-dasharray` ring for percent done, and a `<text>` label. Labels are hidden when the on-screen radius (`r × k`) is below a threshold; the threshold check runs on d3-zoom's `end` event and on a coarse scale bucket during `zoom`, so dragging never re-renders every label. d3 owns only the camera: the zoom handler sets `transform` on `.pl-world` directly; Preact is not re-rendered during a pan (blueprint §9.1: 60 fps with 300 visible nodes, labels degrade first).

**Gestures (B10, L2, L11).** d3-zoom is attached to the `<svg>` with `touch-action: none`. Facts from the d3-zoom reference that shape the design (L11): it registers mouse, touch and wheel listeners (not Pointer Events), **stops the propagation of every event it consumes**, consumes `dblclick` itself (default double-click zoom), and suppresses the `click` after a pan only when `clickDistance` is set (default 0 means any movement cancels the click). So:
- `clickDistance(6)`: a tap or click that moved less than 6 px is a tap; more is a pan.
- `.on('dblclick.zoom', null)` removes d3's double-click zoom so the app can use double-click for drill-in.
- `scaleExtent([0.5, 8])`; `translateExtent` left open; `filter` keeps the default for this phase (no node drag yet). Phase 4 revisits `filter` for long-press and drag.
- Taps and clicks on `[data-node]` go to Preact handlers; tapping empty space clears the selection.

**Drill-in and history (blueprint §5.3, B9).** The view root lives in `App` state and in the URL hash (`#/` or `#/<stem>`), so a reload and a shared link land on the same level. On a **user** drill-in (double-click, tap-selected-again, Open, breadcrumb) the app calls `history.pushState({ root }, '', '#/<stem>')`; `popstate` sets the root from the state and resets the camera. Entries are pushed only from user actions, because Chrome skips entries added without a gesture and would otherwise close the app on back (B9). At the top level no entry is pushed, so back leaves the app, as any site. A breadcrumb tap **pushes** the ancestor as a new entry rather than calling `history.go(-k)`, so it works when the stack has no matching entries (direct link, reload). Toggling Bubble · List does not push an entry. **B9 has no official guidance, so the back gesture is the headline test on the S23 at the end of the phase.**

**View toggle keeps state.** `view`, `root` and `selectedId` are `App` state shared by both views; the camera belongs to the bubble view and resets on root change. `view` and `root` are also saved per device in `localStorage` (`pl:view`, `pl:root`) for the next start; the hash wins over the saved root when present.

**Add tag.** `Picker` already supports `onCreate`; for tags it opens `TagDialog` (name, kebab-cased as typed, and "means"). `Session.addTag` queues `{ kind: 'addTag', domain, tag, meaning }` and then the `set tags` op in **one batch**, so the table row and the note edit land in the same commit, following the vault guide's rule that a new tag is added to the list "in the same edit". `addTagRow` (already in `serialize.ts`) appends one row to the Vocabulary table or replaces the placeholder row, and refuses a duplicate. The tag list is already a cached content path, so no new sync work.

---

## 6. Testing

**Automated (CI):**
- `core/layout`: weights count only open tasks; floor weight gives empty projects a circle; exactly two levels; root switching; archived nodes excluded; sort is by value descending; coordinates fit `[0, w] × [0, h]`.
- `app/nav`: hash ↔ root round trip, unknown stem falls back to the top level, the no-push-at-top rule, and the "push only on user action" guard (a pure function decides whether an entry is pushed).
- `serialize.addTagRow`: one row added, placeholder replaced, duplicate refused (extends the existing test).
- `ops`: an `addTag` + `set tags` batch applies together and is held together on a conflict.

**Manual, laptop (Chrome):**
- Bubble view of the sandbox: seven-plus nodes, sizes and colours as expected; wheel zoom, drag pan, double-click drill-in, breadcrumb, browser back, view toggle keeps root and selection.
- **Performance:** seed the preview's IndexedDB with `fixtures/big.ts` (300 nodes) and record a Chrome Performance profile while panning and pinch-zooming: target 60 fps, no long tasks over 50 ms. If missed, labels are simplified first; Canvas is the documented fallback (blueprint §3).
- Add a tag from the Inspector, then `git pull` the sandbox clone: one commit, two files, the tag table gained exactly one row.

**Manual, S23 (installed app):**
- Pinch-zoom and one-finger pan; tap selects; tap again drills in; Open in the Inspector drills in.
- **Back gesture goes up one level, and at the top level leaves the app** (B9). Also the back button in Chrome when not installed.
- Portrait and landscape; the breadcrumb and toggle fit; labels legible at the default zoom.

---

### 6.1 Measurements taken at 2c (laptop, Chrome, 2026-10-01)

300-node fixture, 64 circles visible at the top level, hidden browser pane (so no paint timing; JavaScript cost only):

| What | Result |
|---|---|
| d3-zoom wheel handler (camera transform written to the world group), 40 events | avg 1.4 ms, max 3.9 ms |
| Wheel event that crosses a scale bucket, including the Preact label re-render | avg 4.1 ms, max 5.9 ms |
| Drill-in (layout recomputed for the new root) | not separately timed; sub-frame on the laptop |

Both are well inside a 16.7 ms frame. Paint and compositing were not measurable with the pane hidden; the S23 run in 2d is the real test, with Chrome's frame-rate overlay (`chrome://flags` → FPS counter, or DevTools remote profiling) if anything stutters.

---

## 7. Build order and checkpoints

| Step | Delivers | Needs from Heyns | Checkpoint |
|---|---|---|---|
| 2a | d3 installed; `core/layout.ts` with tests; static `BubbleView` (no gestures) rendering the sandbox; 300-node fixture | — | **✔ Look of the bubble view** — screenshots of the sandbox and of 300 nodes, before interaction work |
| 2b | Pan/zoom, selection, drill-in (double-click, tap-again, Open), `nav.ts` with history, breadcrumb, view toggle, list rooted at the view root | — | — |
| 2c | Add-tag dialog and `Session.addTag`; performance profile at 300 nodes | — | **✔ Show the profile numbers** |
| 2d | Acceptance run on laptop and S23 per §6 | ~20 min on the phone | **✔ Phase 2 acceptance** against blueprint §11; list anything not met, then stop |

Each step is one commit to the public app repo after the usual scan for vault content; the sandbox is the only repo the app writes to.

---

## 8. Risks and unknowns

| Item | Handling |
|---|---|
| Android back in the installed app (B9, no official guidance) | Designed to the documented intervention (push only on user gesture). Tested on the S23 in 2d; if back still closes the app, the fallback is an always-visible Up button and no history entries at all |
| SVG performance at 300 nodes on the phone | d3 only moves one `<g>` during gestures; labels degrade first; Canvas fallback stays on the table |
| d3-zoom uses touch events and consumes them (L2, L11) | Default `filter` this phase; `clickDistance(6)`; `dblclick.zoom` removed. Phase 4's drag and long-press will need `filter` to exclude `[data-node]` |
| Two-level depth hides deep trees | The level-two badge shows how much is beneath; drill-in is one tap away. Depth stays fixed in v1 |
| A tag typed with spaces or capitals | Kebab-cased before writing, shown back to the user before saving |
| `start_url` is `/project-planner/` and the hash carries the root | Hash routing needs no server support on Pages; the service worker's navigation fallback is unaffected |

---

## 9. Decisions (answered by Heyns 2026-10-01; plan approved)

1. **Arcs and stubs stay in Phase 4**, as blueprint §11 lists them, even though §5.1 describes them with the bubble view. — Agreed.
2. **Drill-in gestures:** desktop double-click; phone tap-a-selected-bubble; **Open** in the Inspector header for both. Double-click also drills in from a list row. — Agreed.
3. **Breadcrumb pushes forward** (a new history entry) rather than walking back through history. — Agreed.
4. **Default view** on a device's first start: bubble; afterwards the last used view. — Agreed, on condition that a view selector is always visible (the Bubble · List toggle in the header).
5. **Empty or all-done projects** shrink to the floor size **and are drawn in a darker shade**; nothing disappears on its own. Projects stay in the view until decommissioned (archived). — Decided.
6. **New tag needs a name and a meaning** (the table's "Means" column). — Decided.

Added at the 2a checkpoint (Heyns, 2026-10-01), after seeing the first screenshots:

7. **Lines between connected items, now rather than in Phase 4.** Bubbles always keep a gap, and a typed link (blocked-by, relates, references) between anything inside circle A and anything inside circle B is drawn as one line between A and B: **solid within a domain, dotted across domains**; blocked-by in rust with a dot at the blocker, the others in the link colour. Links inside one circle, or between a circle and its own parent, are not drawn. Out-of-view stubs stay in Phase 4. This narrows decision 1.
8. **Muted colours, by level not by status.** Fill runs from a muted warm orange (projects) through ochre (sub-projects) to muted brown (tasks), one step darker when nested, so a circle never shares a tone with the circle around it. **Status becomes the rim colour** (gold in progress, rust blocked, olive done, quiet grey not started); the progress ring stays; no-open-tasks still dims.

Added when Heyns approved the 2a look (2026-10-01):

9. **Inherited blocking only when a node's own progress is impeded.** A project or sub-project gets the dashed rust rim when it is itself on-hold or waiting, or when **every open task beneath it** is blocked (itself, or through an on-hold parent below the node). When only some are, the node is not "blocked"; instead the **progress wheel is tinted** (`--pl-partial`) and the list shows an "N blocked" badge. This replaces the blueprint §4.6 rule that any blocked child propagates upwards.
10. **Tag-based colour logic is coming** (Phase 3 or later, rules to be decided). The bubble renderer keeps one `toneClass(node)` hook for it, so tag rules will not touch the layout.

Added after the laptop part of 2d (Heyns, 2026-10-02; laptop checks all passed):

11. **One level, free-floating.** A bubble shows the node at the current level, named, with nothing drawn inside it; drill-in shows the next level. The circles are packed with a gap and then spread apart so they float rather than tile. Area follows (open tasks + 1)^0.6, so a finished project stays a readable circle beside a busy one. This supersedes "sub-projects one level deep" in blueprint §5.1 and plan §5.
12. **What is inside, under the name:** items one level down; attachments (Drive links on the node and everything beneath it); and **due pressure**: for every open item in the subtree with a due date, time left = (due − today) ÷ (due − start) × 100, with `created` standing in for a missing start. Items under 25 % → a small red bubble with the count, **pulsing**; once any is under 10 % (or overdue) the bubble is **steady**. Nothing is counted for done or archived items.
13. **Phone drift fixed:** the app shell is a fixed-height column and the bubble canvas is positioned absolutely, so its size can never feed back into the box it measures.

Added after the phone check (Heyns, 2026-10-02):

14. **A tap opens a radial, not the Inspector** (Heyns, 2026-10-02, after the phone check: a single tap opened the task, so tap-again could never drill down). Tapping a bubble shows two buttons beside it at screen size — **Edit** (Inspector) and **Open** (drill down). Tapping elsewhere, panning or zooming closes it. Desktop double-click still drills in; Enter opens, Space shows the radial. Supersedes the tap-again gesture in decision 2.
15. **The ring shows the tasks beneath, by state.** The red inner due-bubbles from decision 12 are gone. The rim ring is now a full ring split into segments sized by count — **due** (under 10 % of the start→due span left, or overdue; red), **near due** (under 25 %; orange), **blocked** (on hold or waiting, itself or through a parent below the node; plum), **open** (steel blue, `#4f7fb0`; Heyns 2026-10-02, was gold) and, kept so progress stays visible, **done** (olive, quiet). Each task counts once, most pressing state first. A legend sits in the corner of the view. "N inside · M files" stays under the name.
16. **Sub-tasks, and counts by type** (Heyns, 2026-10-02). A fourth planner type, `subtask`, sits under a task; it counts like a task for progress and the ring. Under a bubble's name, "N inside" becomes one line per type **below the bubble's own type** — a project lists Sub-projects / Tasks / Sub-tasks, a sub-project Tasks / Sub-tasks, a task Sub-tasks — plus Files when there are Drive links; as many lines as fit at the current zoom. The sandbox was seeded with 29 example notes (39 planner notes in all) across the three domains so every state shows. Blueprint §4.5 gains the rule "a sub-task sits under a task".
17. **Hold for the radial, double-tap to drill** (Heyns, 2026-10-05, from the phone: Edit and Open in the radial did not respond; double-tap drilled down and that is the gesture wanted). On touch: a tap only highlights, a **hold (≈ 450 ms)** opens the radial, which for now holds **Edit** only, and a **double-tap** drills down. With a mouse: click opens the radial, double-click drills. Root cause of the dead buttons: d3-zoom fires `start` on every touchstart and mousedown, and the radial was being closed on `start`; it now closes only on real camera movement. Supersedes decision 14's tap-opens-radial.
