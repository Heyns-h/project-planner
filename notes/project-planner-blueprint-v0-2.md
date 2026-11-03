---
type: reference
status: active
created: 2026-09-30
updated: 2026-09-30
---

> [!note] Project Planner & Tracker — Blueprint v0.2
> Moved from the app repo's `docs/` on 2026-09-30. The app repo is public; these notes stay private here.

Version 0.2 · 2026-09-30 · Owner: Heyns · **Draft for review**

Supersedes [v0.1](project-planner-blueprint-v0-1.md) (Obsidian plugin). v0.1 is kept for reference. What changed and why is in section 13. Every *verify* item was checked on 2026-09-30; codes like (G5), (B9) and (L4) refer to the [verification](2026-09-30-project-planner-verification.md).

---

## 0. Read this first (instructions for Claude Code)

1. **`_vault-guide.md` at the vault root is the authority** on folder structure, frontmatter and naming for anything written into the vault. Where this blueprint conflicts with it, the guide wins. Flag the conflict rather than choosing silently.
2. **Verify every API against current documentation** before using it. Items marked *verify* are the author's belief, not fact. Never invent an endpoint, method or browser capability.
3. **Ask, don't assume.** Anything ambiguous goes to Heyns before it is built.
4. **Never write to the real vault repo during development.** Development and tests run against a sandbox repo (section 10). The app touches `Heyns-h/Vault` only after Heyns approves it, per phase.
5. **No secrets in any repo.** The GitHub token lives only in each device's browser storage. It never goes in code, in config, in a URL or in a log.
6. Scratch for this project stays in this project folder. Scratch for vault work goes in `.work/` at the vault root.

---

## 1. Goal

A personal planner for projects, sub-projects and tasks. It runs as an **installable web app (PWA)** on phone and computer alike, works **offline**, and syncs when the connection returns.

Every item is an ordinary markdown note **in the vault's git repo**, so the plan is versioned, readable by Claude sessions and editable by hand, and it survives the app.

Single user for now (Heyns). The data is designed so multi-user can be added later without restructuring.

---

## 2. Decisions already made

| Topic | Decision | Since |
|---|---|---|
| Form | Installable web app (PWA), not an Obsidian plugin | v0.2 |
| Devices | Phone (Samsung S23 Ultra, Chrome) and laptop/desktop, used equally | v0.2 |
| Offline | Full read and edit offline; edits queue and sync on reconnect | v0.2 |
| Storage | One markdown note per node, **in the `Heyns-h/Vault` repo**; frontmatter holds structured data | v0.1 |
| Sync | The app talks to GitHub's REST API directly. Laptop and desktop clones pick changes up with their normal pull | v0.2 |
| Auth | GitHub fine-grained personal access token, limited to the one repo, entered once per device | v0.2 |
| Hosting | Static site on GitHub Pages from a **public** app repo, with Cloudflare Pages as fallback. Pages is free for public repos (G10). The code is public; the data never enters the app repo | v0.2 |
| Relations | **Stored once**, on the child or dependent side. Reverse directions are derived in memory (trial lesson 1) | v0.2 |
| Files never move | Moving, archiving and re-parenting change a property, never a path | v0.2 |
| Obsidian | Not required by the app. Whether the vault moves off Obsidian is a separate project (section 12) | v0.2 |
| Users | Just Heyns. People are picked from person notes | v0.1 |
| Shared documents | Google Drive links stored on the node, opened with a button. No Drive API in v1 | v0.1 |
| Overview | Nested circles (circle packing) with link arcs, switchable to a collapsible tree list | v0.1 |
| Touch | Tap = focus, tap again or "Open" = drill in, long-press = drag | v0.1 |
| Search | Structured tokens plus free text, highlighted like focus | v0.1 |
| Extras | Roll-up, typed links, people as entities, archive not delete, timeline later | v0.1 |
| Palette | Dark autumn (section 9) | v0.1 |
| dotpm | Trialled and dropped. Findings in [dotpm-trial.md](2026-09-30-project-planner-dotpm-trial.md) | v0.2 |

---

## 3. Architecture

```
 phone / laptop / desktop browser (installed PWA)
 ┌────────────────────────────────────────────────────┐
 │ UI (views, inspector, dialogs)                     │
 │   │                                                │
 │ core (framework-free TypeScript)                   │
 │   parse → graph → rollup / focus / query           │
 │   ops  → writer (minimal-diff frontmatter edits)   │
 │   │                                                │
 │ local store (IndexedDB)                            │
 │   file cache · base versions · op queue · settings │
 │   │                                                │
 │ sync engine ── GitHub REST API ── Heyns-h/Vault    │
 └────────────────────────────────────────────────────┘
 service worker: caches the app shell so it opens offline
```

- **TypeScript, bundled with Vite 8** with `vite-plugin-pwa` (Workbox) for the service worker (L8). All dependencies are bundled, so there are no third-party scripts at runtime. Development needs **Node ≥ 22.12** (L9).
- **UI layer: Preact** (decided 2026-09-30), via `@preact/preset-vite`. Pinned to **10.29.x**; 11.0 was released on 2026-09-30 and is adopted later (L7; confirmed by Heyns 2026-09-30). The bubble view is one Preact component that hands its SVG element to d3.
- **`core/` has no UI or browser dependencies**, so it can be unit-tested in Node. If an Obsidian plugin or CLI is ever wanted, it can reuse `core/`.
- **Rendering:** SVG via d3 (`d3-hierarchy` 3 pack, `d3-zoom` 3, `d3-selection`/`d3-transition` 3; L1–L3). d3-zoom consumes the events it handles, so its `filter` excludes node elements and node long-press/drag uses Pointer Events with `touch-action: none` (L2, B10). Fall back to Canvas for the bubble view if SVG misses the mobile performance target.
- **Frontmatter writer:** edits must change only the lines they mean to change, keeping key order and quoting (trial lesson 3). Use the `yaml` package's Document API with the default YAML 1.2 schema, written out with `toString({ flowCollectionPadding: false })`. Tested: a one-field change is a one-line diff (L4). Never use schema 1.1, which turns dates into timestamps.
- **IDs:** ULID via the `ulid` package, `monotonicFactory()` (L5), stored as `planner_id`.

### Module outline

```
src/
  core/
    types.ts        Node, Person, Status, Op, Conflict
    parse.ts        markdown file → Node (frontmatter + body)
    serialize.ts    minimal-diff frontmatter edits; new-file template
    graph.ts        indices: by id, by file stem, children, derived reverse links
    rollup.ts       progress / blocked / overdue
    ops.ts          semantic operations + inverses (for undo)
    validate.ts     hierarchy rules, cycles, vault-guide conformance
    query.ts        search tokens → predicate
    focus.ts        focus set for a node or a search
    slug.ts         kebab-case file names, uniqueness
  store/
    db.ts           IndexedDB schema and access
  sync/
    github.ts       thin REST client (only the endpoints in §8)
    engine.ts       pull, rebase queued ops, push as one commit, retry
    conflicts.ts    field-level conflict detection
  ui/
    App.tsx  PlannerView  ListView  BubbleView  Inspector
    QuickAdd  DropDialog  DuplicateDialog  ConflictDialog  Settings
    theme.css
  sw.ts             service worker
```

---

## 4. Data model

### 4.1 Node = one note

A node is a `project`, `subproject` or `task`, held in `planner_type`. Its place in the hierarchy comes from `parent`, **not from the folder**. The app recognises a node by `planner_id`, wherever the file lives.

**Folder for new nodes: `<domain>/07-planner/`**, flat, one per domain, created when a domain gets its first node (decided 2026-09-30). This adds a standard `07-planner/` slot to the domain shape in `_vault-guide.md` §3. That guide amendment is made in the real vault at switch-over, with Heyns's approval, and not before.

**File name:** a kebab-case slug of the title (guide §6). If the name is already taken anywhere in the repo, a numeric suffix is added (`-2`), so a bare-stem wikilink always resolves (trial lesson 4). **The file is never renamed after creation.** A title change edits `aliases[0]` only. This removes the rename/broken-link failure seen with dotpm.

### 4.2 Properties

The guide's nine keys come first, then the planner's. The shape is fixed: empty values stay present rather than being omitted (guide §5).

```yaml
---
type: note                          # guide: project for planner projects, note otherwise
domain: cintoo                      # guide: inherited from the root project
project: ""                         # guide: empty (see 4.6)
version: ""
status: active                      # guide values; UI labels in 4.3
tags: []                            # from the domain's _<domain>-tags.md list
created: 2026-09-25
updated: 2026-09-30
aliases:
  - Confirm freight quote           # aliases[0] = display title
planner_id: 01J8Z6K2Q4...           # ULID, never changes
planner_type: task                  # project | subproject | task
parent: "[[sourcing-q4-range]]"     # empty for top-level projects
priority: medium                    # low | medium | high
owner: "[[heyns]]"
people: []
start: 2026-09-20
due: 2026-10-05
blocked_by: ["[[place-po]]"]        # stored on the dependent only
relates: []                         # stored once, on the node where it was created; undirected
references: []                      # other vault notes
drive: []                           # Google Drive URLs
---
Free markdown body. No H1 heading (guide §7).
```

Rules:

- **No `title:` key** (guide §5). The display title is `aliases[0]`, falling back to the file stem.
- **All wikilinks use bare file stems**, never paths, so `vault-check.sh` check 4 resolves them.
- **Each relation is stored once.** `parent` lives on the child; children are derived. `blocked_by` lives on the dependent; `blocks` is derived. `relates` is stored on one side and read as undirected. There are no parent-side lists (`taskIds`, `subtaskIds`) — the cause of dotpm's extra writes and merge conflicts.
- **Dates are `YYYY-MM-DD`.** `updated` changes at most once a day per node, which keeps diffs quiet.
- Multi-user later: add `assignee` and `visibility`. Nothing needs restructuring.

### 4.3 Status

The files store the guide's vocabulary. The UI shows planner labels:

| Stored (`status:`) | Shown as | Counts as done |
|---|---|---|
| `idea` | Not started | no |
| `active` | In progress | no |
| `on-hold` | Blocked | no |
| `done` | Done | yes |
| `archived` | Archived | excluded from roll-up |

A node with an unfinished `blocked_by` target is also *shown* as blocked, whatever its stored status. That is derived, never written.

### 4.4 Registries

- **People:** every note with `type: person`, anywhere in the repo. A new person is created in `<domain>/06-people/` in the shape of `tpl-person.md`, written directly (not through Templater).
- **Tags:** the picker offers only the node's domain list, parsed from the Vocabulary table in `_<domain>-tags.md`. The app does not invent tags. Adding one means editing that list, which the app may offer to do as part of the same commit.
- **Categories:** dropped (2026-09-30). Domain plus the domain tag lists cover grouping.
- **Cross-domain links:** the graph spans the whole repo and links use repo-unique bare stems, so `parent`, `blocked_by`, `relates` and `references` work between domains. Folders only decide where a file sits. A node's `domain` follows its root project, so a task parented under another domain's project takes that domain.

### 4.5 Hierarchy rules

- `project`: no parent. Nesting under another project is allowed with a warning.
- `subproject`: parent is a project or subproject.
- `task`: parent is any node. Tasks may have sub-tasks.
- **No cycles.** Any move that makes a node its own ancestor is rejected.

### 4.6 Roll-up

- Progress % = the share of descendant tasks that are done, archived excluded.
- A parent is shown as blocked if any direct child is blocked, and as overdue if any descendant is past due and not done.
- **Computed in memory and never written to files.**
- `project:` stays empty on planner nodes. Filling it with the root project's slug would make every move rewrite a whole subtree. Registered vault projects are linked by adoption instead: a planner project **is** the project's `_<slug>-moc.md` index, which gains the planner keys (decided 2026-09-30; "Adopt" action in Phase 4).

---

## 5. Views

Carried over from v0.1 section 5, with platform changes only.

### 5.1 Overview — bubble mode
Top-level projects as circles, sized by open descendant task count (with a minimum size), each showing its sub-projects one level deep, with labels hidden below a size threshold. Coloured by status, with a progress ring. Typed links drawn as arcs: blocked-by = rust, relates = slate teal, references = dotted. **Layout is computed on every render and never stored.** Pan and pinch-zoom via d3-zoom.

### 5.2 Overview — list mode
A collapsible tree table: Title · Type · Status · Owner · Domain · Due · Progress. Sort and filter per column, and the same focus behaviour. Toggling between bubble and list keeps the drill-in level, selection and search.

### 5.3 Drill-in
Desktop: double-click. Mobile: tap an already-focused node, or "Open" in its action bar. The node becomes the view root. A breadcrumb walks back up. **Each drill-in pushes a browser history entry**, so the Android back gesture and the browser back button go up one level. History entries are pushed **only in response to user actions**, because Chrome skips entries added without a user gesture and would otherwise close the app on back (B9; no official guidance, so this is tested on the S23 in Phase 2). Links that point outside the current view appear as labelled stubs at the edge, and tapping one jumps there.

### 5.4 Focus highlight
The focus set is the node, its ancestors, its descendants, and nodes directly linked to it (one hop, any link type) with their ancestor paths. Everything else drops to 40% opacity, over about 150 ms. Desktop: hover, and click locks the focus until Escape or a click on empty space. Mobile: tap, and tap empty space to clear. Setting: link hop depth, default 1, maximum 3.

### 5.5 Search
Always-visible bar. Tokens are ANDed: `@name`, `#tag`, `domain:`, `status:`, `due:<7d`, `due:overdue`, `type:`, plus free text (fuzzy match on title, body and the titles of linked notes). Removable chips. Matches and their ancestor paths are highlighted like focus, hidden matches add a count badge to the visible ancestor, and a result list jumps to a match. **Under 100 ms at 1,000 nodes.** Bodies are already in the local cache, so they are indexed lazily from there. Matching: uFuzzy over titles, aliases and linked-note titles, plus a case-insensitive substring scan over bodies. uFuzzy is built for short phrases (L6). Benchmarked at 1,000 nodes in Phase 3.

---

## 6. Creating and editing

- **Quick add:** a "+" button. Choose type, title and parent (default: the current view root). Everything else is optional. `domain` is inherited from the root project, and a new top-level project asks for it.
- **Inspector:** a side panel on desktop, a bottom sheet on mobile. It edits every property, typed links (pickers that search nodes and vault notes), and Drive links (with an "Open" button). **"View note"** opens the file on GitHub. While Obsidian stays installed, an optional "Open in Obsidian" uses an `obsidian://open?vault=…&file=…` link, with each value `encodeURIComponent`-encoded (L10).
- Edits save on field blur, with debounce, as **ops** into the local queue (section 8). They show immediately. The badge "N changes not synced" stays visible until they are pushed.
- **Archive, not delete:** Archive sets `status: archived` and hides the node by default. A true delete is only available from the archive filter, with confirmation, and removes the file in a commit. Git history is the recovery path.

---

## 7. Duplicate, move, link, undo

Carried over from v0.1 section 7, restated for single-sided relations:

- **Drag and drop:** desktop drag; mobile long-press, with a haptic tick via `navigator.vibrate()`: works on Android Chrome after a user gesture, is silently absent elsewhere (B8). On drop, the dialog offers **Move here / Link here / Cancel**.
  - **Move** changes only the dragged node's `parent`: one line in one file. Descendants follow automatically. A move that would create a cycle is rejected with a message.
  - **Link** opens a type picker (`relates` by default, `blocked_by` either way round) and writes the link on the correct side.
- **Duplicate:** options for children (none / direct / all), links (none / copy), and destination. Copies get new `planner_id`s and new unique file names, " (copy)" is added to `aliases[0]`, status resets to `idea`, and `created`/`updated` are set to today. Links between copied descendants are remapped to the copies.
- **Undo:** a session stack of the last 20 actions, each stored as an op batch with its inverse. Undoing an action that has not been pushed yet removes it from the queue. Undoing one that has been pushed queues its inverse as a new change. Git history remains the long-term safety net.

---

## 8. Offline and sync

The core of v0.2. Everything else depends on it being right.

### 8.1 Local store (IndexedDB)

| Store | Holds |
|---|---|
| `files` | path → content, git blob SHA, and the **base** content as of the last sync |
| `queue` | pending ops in order: `{opId, nodeId, kind, field, from, to, at}` |
| `meta` | last synced commit SHA, repo, branch, device label |
| `settings` | device-local view state: last view, zoom, filters, expanded rows (trial lesson 5) |
| `secrets` | the token. Never exported, never logged |

Call `navigator.storage.persist()` and record the result. Chrome grants or refuses it silently and never guarantees it (B4). Eviction would wipe the cache **and the unsynced queue**, so: the unsynced count is always visible, sync runs soon after every edit, and the queue is written before `visibilitychange → hidden` (B7). GitHub is the durable copy.

### 8.2 Pull

1. `GET` the branch ref. If the SHA equals `meta.lastSync`, stop.
2. `GET /git/trees/{sha}?recursive=1` for the new commit (G2). Keep `.md` paths. If `truncated` is true (over 100,000 entries or 7 MB), fall back to walking sub-trees.
3. For each path whose blob SHA differs from the cached one, `GET /git/blobs/{sha}` with the raw media type (G3). Unchanged files cost nothing. Blob SHAs can be computed locally to confirm the cache: SHA-1 of `"blob <byte length>\0" + content` (G4).
4. Re-parse the changed files, update the graph incrementally, keep the current view.

Only planner nodes, person notes and tag lists are parsed in full. Other notes are indexed by stem and alias so wikilinks resolve and `references` can be picked.

### 8.3 Push — one action batch = one commit

1. Pull (8.2).
2. **Rebase the queue:** replay each queued op onto the fresh content. An op is `set field F of node N from A to B`.
   - Remote `F` still equals `A` → apply.
   - Remote `F` already equals `B` → drop the op (already there).
   - Remote `F` is something else → **conflict** (8.4).
   - The node was deleted remotely → conflict.
3. Build the commit in **three write requests** (G5): `POST /git/trees` on `base_tree` with inline `content` (and `sha: null` for deletions), `POST /git/commits` with the pulled commit as parent, then `PATCH /git/refs/heads/<branch>` with `force: false`. This stays well within GitHub's cap of 80 content-creating requests a minute and 500 an hour (G8). The app never writes under `.github/` (G6).
4. If the ref update returns **409 or 422**, treat it as "the branch moved": someone pushed in between (a desktop's auto-push or a Claude session). The exact error is not documented (G5a). Go back to 1. Honour `retry-after` on 403/429. Retry with backoff, up to a limit, then leave the queue in place and show a notice.
5. Commit message: `planner: <summary> (<device>)`, for example `planner: move 'Confirm freight quote' (phone)`.

**When sync runs:** on app open, on the browser's `online` event, when the app returns to the foreground, after edits (debounced, about 10 s), and **every 30 seconds while the app is visible**, paused while hidden (decided 2026-09-30). An unchanged ref costs nothing against the hourly limit (G8), and at 2 requests a minute the per-minute limit (900 points) is nowhere near. Expected delay, phone to laptop: about 10–40 s. Edits that reach GitHub through Obsidian Git on a desktop arrive on its auto-commit timer (currently 10 min). Background Sync (Chromium-only, B5) may be added as an extra but is not relied on. `navigator.onLine` is only a hint; a sync attempt that fails simply stays queued (B6).

**Edits made outside the app** (by hand, by Claude, or by Obsidian Git on a desktop) are expected and allowed. The app sees them once they reach GitHub. While open, it checks the branch ref cheaply with a conditional request (`If-None-Match`). A 304 does not count against the hourly limit (G8) and runs a pull as soon as the ref moves. It cannot see an edit that is still unpushed on another machine.

### 8.4 Conflicts

- Detected per field, never per file, so edits to different fields of the same node on two devices merge cleanly.
- A conflict pauses only that op. The conflict dialog shows **yours / theirs / base** and you choose. **Nothing is resolved automatically.**
- **Unparseable files or git conflict markers** (`<<<<<<<`) → the node shows a warning badge and is read-only until fixed.

### 8.5 Coexistence with the rest of the vault

- Claude sessions, the desktops' Obsidian Git and hand edits may all change planner files. The app treats them like any remote change, and the op rebase in 8.3 handles them.
- The app never writes outside planner nodes, person notes it creates, and domain tag lists (with confirmation).
- **Every file the app writes must pass `vault-check.sh` checks 3 and 4.** `validate.ts` enforces this before an op can be queued.
- Line endings are LF, matching the vault's `.gitattributes`.

---

## 9. Mobile, PWA and theme

### 9.1 Mobile (Samsung S23 Ultra)
- Touch targets at least 44 px. Inspector as a bottom sheet. Toolbar collapses to icons.
- 60 fps pan/zoom with 300 visible nodes. Labels degrade before anything else.
- Portrait and landscape both tested.
- Installable from Chrome: manifest with name, 192 px and 512 px icons, `start_url`, `display: standalone`, served over HTTPS (B1). A service worker is no longer required to install, but the app needs one to open offline.

### 9.2 Security
- The token is a fine-grained PAT limited to `Heyns-h/Vault`, with **Contents: read and write** only, plus the read-only metadata permission the token form adds automatically (G6). Expiry: **90 days** (decided 2026-09-30; 1–366 or none are possible, G7). The app warns 14 days before, on each device.
- A strict Content Security Policy **in a `<meta>` tag**, because GitHub Pages cannot set headers (B11, B12): `script-src 'self'`, `connect-src https://api.github.com`, no inline scripts. `frame-ancestors` does not work in a meta tag, so the app refuses to run, and never asks for the token, when it is inside a frame (`window.top !== window.self`). Links, bodies and titles are rendered as text, never as HTML, so a crafted note cannot run script and steal the token.
- The settings page has "Forget token and local data" per device.

### 9.3 Theme — dark autumn
Palette unchanged from v0.1 section 10. Colours are CSS custom properties scoped to the app:

```css
:root {
  --pl-bg: #1C1714; --pl-surface: #26201B; --pl-surface-2: #312821;
  --pl-border: #4A3B30; --pl-text: #EDE3D6; --pl-muted: #A8988A;
  --pl-accent: #D9772B; --pl-highlight: #E8B04A; --pl-blocked: #B5482E;
  --pl-done: #7E8A4A; --pl-progress: #C9962E; --pl-link: #4F7C82;
  --pl-plum: #7A3E4F; /* was --pl-category; now the domain accent */ --pl-dim: 0.4;
}
```

Status colours as v0.1. **The contrast check still has to be done** (WCAG AA, especially `--pl-muted` on `--pl-surface`).

---

## 10. Development and testing

- **App repo:** this folder becomes `Heyns-h/project-planner`, public, deployed by a GitHub Actions workflow to Pages.
- **Sandbox data repo:** a private `Heyns-h/planner-sandbox`, seeded from `test-vault/` and rewritten into the v0.2 format. All development and phone testing runs against it with its own token. The real vault is switched on per phase, after Heyns approves.
- **Unit tests (Vitest 5 with fake-indexeddb; L9)** for everything in `core/`: parse/serialize round-trips on real vault notes (a one-field edit must be a one-line diff), graph, roll-up, cycles, slug uniqueness, and the conformance rules.
- **Sync tests** against an in-memory fake of the GitHub endpoints in 8.2–8.3, covering: offline edits on two devices to different fields, the same field, a delete against an edit, a push race, a truncated tree and an expired token.
- **Manual tests** each phase: laptop Chrome, desktop, and the S23 installed app, including airplane mode → edit → reconnect.

---

## 11. Build phases and acceptance criteria

**Phase 0 — Plumbing**
- Repo, build, CI deploy to Pages. Installable on the S23 and the laptop.
- Token entry, pull from the sandbox repo, parse nodes, show a node count.
- Opens and shows cached data in airplane mode.

**Phase 1 — Data model, list view, offline editing and sync**
- Graph built from the repo, refreshed incrementally on pull.
- List view with hierarchy, status, owner, due and roll-up progress.
- Quick add and the Inspector create and edit nodes. Files match section 4 and pass `vault-check.sh` checks 3 and 4.
- The people and tag registries work.
- Offline edits queue, survive an app restart, and sync on reconnect as one commit per action batch.
- Field-level conflicts appear in the conflict dialog. Nothing is lost or silently overwritten in the two-device test.

**Phase 2 — Bubble view and drill-in**
- Circle pack as specified. Drill-in, breadcrumb, and back gesture/button. Toggling views keeps state.

**Phase 3 — Focus and search**
- Focus set with 40% dimming (hover on desktop, tap on mobile). Tokens, highlighting, count badges and the result list, within the speed target.

**Phase 4 — Links, drag, duplicate, undo**
- Typed-link arcs and out-of-view stubs. Move/Link drop dialog with cycle prevention. Duplicate with id and link remapping. Undo stack. Archive flow.

**Phase 5 — Polish**
- Drive link buttons, contrast pass, mobile performance pass, token-expiry warning, settings page.
- **Switch from the sandbox to `Heyns-h/Vault`** (if not done earlier by agreement).

**Later (not v1)**
- Timeline / Gantt by start and due.
- Drive folder contents in the Inspector (needs Google sign-in).
- Multi-user fields and views.

---

## 12. Open questions for Heyns

Answered 2026-09-30:

| # | Question | Answer |
|---|---|---|
| 1 | Node folder | **`<domain>/07-planner/`** (flat, per domain). Needs a guide §3 amendment at switch-over |
| 2 | Section 4 as written | **Confirmed** |
| 3 | Categories | **Dropped** in favour of domain + tags |
| 4 | Names | **`project-planner`** for app and repo |
| 5 | Sandbox repo and token | **Yes.** Heyns creates them, guided |
| 6 | UI layer | **Preact**; d3 owns the bubble SVG inside one component |
| 7 | Edits outside the app | **Allowed.** The app picks them up and syncs (8.3) |
| 8 | Planner project = registered project index | **Yes**, via "Adopt" in Phase 4 |
| 9 | Moving the vault off Obsidian | Out of scope. Its own plan after Phase 1 |

## 13. Changes from v0.1

| Area | v0.1 | v0.2 | Why |
|---|---|---|---|
| Form | Obsidian plugin | Installable web app | Heyns rarely uses Obsidian; phone and computer are used equally |
| Sync | Obsidian Git on every device | App ↔ GitHub API; desktops pull as normal | Avoids Obsidian Git on Android; enables offline editing on the phone |
| Offline | Implicit (local vault) | IndexedDB cache, op queue, field-level merge | Required by Heyns |
| `title:` | Stored | Removed; `aliases[0]` | Vault guide §5 |
| `type` / `status` | Planner values | Guide values + `planner_type` + UI labels | Vault guide §5 |
| `blocks` / `blocked_by` | Symmetric, both stored | `blocked_by` only; `blocks` derived | Trial lesson 1, accepted 2026-09-30 |
| Renames | File follows title | File never renamed | Trial: renames broke links |
| Folders | `Planner/Nodes/` | `<domain>/07-planner/` | Vault guide §2, §3, §6 |
| Categories | Registry note | Dropped; domain + tags | Heyns, 2026-09-30 |
| People | `Planner/People/`, `planner_person` flag | Any `type: person` note | Vault guide §5 |
| View state | `data.json` or local storage | IndexedDB, per device | Trial lesson 5; no synced churn |
| Plugin id | Open | Not applicable | No plugin |
| Trash | Obsidian trash | Delete in a commit; git history is recovery | No Obsidian |
