---
type: reference
status: archived
created: 2026-09-25
updated: 2026-09-30
---

> [!note] Project Planner & Tracker — Blueprint for Claude Code
> Moved from the app repo's `docs/` on 2026-09-30. The app repo is public; these notes stay private here.

Version 0.1 · 2026-09-25 · Owner: Heyns

---

## 0. Read this first (instructions for Claude Code)

1. **Read `_vault-guide.md` at the vault root before creating any files or folders.** It is the authority on folder structure, frontmatter conventions and naming. Where this blueprint proposes a folder name or property name that conflicts with the guide, the guide wins — flag the conflict to Heyns rather than silently choosing.
2. **Verify every API against current documentation.** This blueprint names Obsidian API methods and libraries that the author believes exist (marked *verify*). Check each one in the current Obsidian developer docs / library docs before using it. Do not invent methods.
3. **Ask, don't assume.** If something here is ambiguous, ask Heyns before building it.
4. **Scratch files** go in `.work/` at the vault root (gitignored). Never leave working files at the vault root.
5. **Build the plugin source outside the vault** (its own project folder / repo). Only the built output (`main.js`, `manifest.json`, `styles.css`) goes into the vault's plugin folder.

---

## 1. Goal

A personal project, sub-project and task planner that lives **inside the Obsidian vault** as a community-style plugin. Every item is an ordinary markdown note, so it is versioned and synced by the vault's existing git setup, and readable/editable in Obsidian even without the plugin.

Single user for now (Heyns). Designed so multi-user can be added later without restructuring the data.

---

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Where it runs | Obsidian plugin, desktop (laptop + desktop PC) and Android (Samsung S23 Ultra) |
| Storage | One markdown note per node in the vault; properties (YAML frontmatter) hold structured data |
| Sync | Existing Obsidian Git auto pull/push (every 5–10 min) on laptop and desktop; Obsidian Git on Android. The plugin never runs git itself |
| Users | Just Heyns. People are picked from a maintained list |
| Shared documents | Google Drive project folder links stored on the node; opened via button. No Drive API integration in v1 |
| Overview layout | Nested circles (circle packing) with link arcs drawn over; switchable to a collapsible list/tree table |
| Touch | Tap = focus/highlight, tap again or "Open" = drill in, long-press = drag |
| Search | Structured tokens + free text, highlights matches the same way as focus |
| Extras accepted | Status/progress roll-up, typed links, people as entities, archive not delete, timeline view (later phase) |
| Palette | Dark autumn (section 10) |

---

## 3. Architecture

- **Obsidian plugin in TypeScript**, using the official sample plugin template as the starting point (*verify current template repo*).
- `manifest.json` → `isDesktopOnly: false` so it loads on Android (*verify field*).
- **No Node or Electron APIs** (`fs`, `path`, `child_process`). Everything goes through Obsidian's Vault / MetadataCache / FileManager APIs so it works on mobile.
- **Custom view** registered as a workspace view (`ItemView`, *verify*), opened from a ribbon icon and a command.
- **Rendering:** SVG via d3 (`d3-hierarchy` for circle packing, `d3-zoom` for pan/zoom, `d3-selection`). *Verify current d3 API.* If SVG performance is poor on mobile with 300+ nodes, fall back to Canvas for the bubble view.
- **Reading data:** frontmatter via the metadata cache (*verify: `app.metadataCache.getFileCache(file)?.frontmatter`*). Build an in-memory graph on load. Update it incrementally on vault events (create / modify / rename / delete, *verify event names*).
- **Writing data:** frontmatter edits via the atomic frontmatter helper (*verify: `app.fileManager.processFrontMatter`*). Body text via the Vault API.
- **Search:** Obsidian's built-in fuzzy search helper if suitable (*verify: `prepareFuzzySearch`*), else a small library such as Fuse.js (*verify*).

### Module outline (suggested)

```
src/
  main.ts            plugin entry, commands, ribbon, settings tab
  model/
    types.ts         Node, Link, Person, Status types
    graph.ts         in-memory graph: parents, children, links, indices
    loader.ts        vault → graph; incremental updates on vault events
    writer.ts        all file writes (single choke point, batched)
    rollup.ts        status / progress aggregation
  views/
    PlannerView.ts   host view, toolbar, breadcrumb, view toggle
    BubbleView.ts    circle-pack + link arcs
    ListView.ts      tree table
    Inspector.ts     edit panel (side panel desktop, bottom sheet mobile)
    DropDialog.ts    Move / Link / Cancel
    DuplicateDialog.ts
  search/
    query.ts         parse tokens (@ # status: due: free text)
    match.ts         run query against graph + note bodies
  focus.ts           compute highlight set for a node or a search
  theme.css          palette tokens + component styles
```

---

## 4. Data model

### 4.1 Node = one note

A node's **type** is `project`, `subproject` or `task`. Location in the hierarchy comes from the `parent` property, **not from the folder**. Moving a node in the planner changes one property instead of moving files, which keeps git diffs small and avoids broken links.

Proposed folder: `Planner/Nodes/` (flat). **Confirm against `_vault-guide.md`.**

File name: a readable slug of the title. Renaming a title may rename the file. Obsidian updates wikilinks on rename if that setting is on (*verify the setting, and confirm Heyns has it on*).

### 4.2 Properties (frontmatter)

```yaml
---
planner_id: 01J8Z6K2Q4...        # stable unique id (ULID), never changes
type: task                        # project | subproject | task
title: Confirm freight quote
parent: "[[Sourcing - Q4 range]]" # empty for top-level projects
status: in-progress               # not-started | in-progress | blocked | done | archived
priority: medium                  # low | medium | high
owner: "[[Heyns]]"               # from people registry
people: ["[[Supplier contact A]]"]
category: Sourcing                # from category registry
tags: [freight, q4]
start: 2026-09-20
due: 2026-10-05
blocks: ["[[Place PO]]"]
blocked_by: []
relates: ["[[Container booking]]"]
references: ["[[Supplier terms 2026]]"]   # vault notes
drive: ["https://drive.google.com/drive/folders/..."]
created: 2026-09-25T10:14
updated: 2026-09-25T10:14
---
Free markdown body: description, notes, checklists.
```

Notes:

- Property names above are proposals. **Align them with the vault guide's frontmatter conventions** (for example, whether tags use a prefix, and date format).
- Links are **typed by property name** (`blocks`, `blocked_by`, `relates`, `references`). Flat lists work better in Obsidian's Properties UI than nested objects.
- `blocks` / `blocked_by` must stay symmetric. The writer updates both ends in one batch.
- `planner_id` lets the plugin recognise its own notes, and survive renames even if a wikilink breaks.
- Multi-user later: add `assignee` and `visibility` properties. No restructuring needed.

### 4.3 Registries

- **People:** one note per person in `Planner/People/` (confirm with the vault guide), each with `planner_person: true` and optional `role` / `company`. The owner and people pickers only offer these notes. Adding a person from the picker creates the note.
- **Categories:** a single note, `Planner/Categories.md`, with a `categories:` list property. The picker only offers this list, and an admin action lets Heyns add or rename categories.

### 4.4 Hierarchy rules

- `project`: no parent (top level). It may later be nested under another project. Allow this, but warn.
- `subproject`: parent is a project or a subproject.
- `task`: parent is any node. Tasks may have sub-tasks.
- **No cycles:** reject any move that makes a node its own ancestor.

### 4.5 Roll-up

- A parent's progress % is the share of its descendant tasks that are done (archived excluded).
- A parent is shown as **blocked** if any direct child is blocked, and as **overdue** if any descendant is past due and not done.
- Roll-up is computed in memory and **never written to files**, so there is no git churn.

---

## 5. Views

### 5.1 Overview — bubble mode

- Shows top-level projects only, as circles. Size = open descendant task count (with a minimum size so empty projects stay tappable).
- Each circle shows its sub-projects as nested circles, one level deep, with labels hidden below a size threshold.
- Colour by status (section 10). A progress ring on the outer edge.
- Typed links are drawn as curved arcs between circles: blocks = rust, relates = slate teal, references = dotted.
- **The layout is computed on every render and positions are never stored.**
- Pan and pinch-zoom via d3-zoom.

### 5.2 Overview — list mode

- A collapsible tree table. Columns: Title · Type · Status · Owner · Category · Due · Progress.
- Sort and filter per column. Same focus/highlight behaviour as bubble mode.
- The toggle between bubble and list keeps the current drill-in level, selection and search.

### 5.3 Drill-in (isolate)

- Desktop: double-click. Mobile: tap an already-focused node, or tap "Open" in its action bar.
- The node becomes the view root and shows its children (and their children in bubble mode).
- A breadcrumb trail at the top walks back up. The Android back gesture goes up one level (*verify how Obsidian mobile exposes back navigation to a view*).
- Links that point outside the current view appear as stubs at the edge, labelled with the target's name. Tapping one jumps to that node's location.

### 5.4 Focus highlight

The **focus set** for a node is:

- the node itself
- all of its ancestors (the path to the top)
- all of its descendants
- nodes directly linked to it (one hop, any link type), plus their ancestor path

Everything outside the focus set drops to **40% opacity**. Links inside the set are drawn at full strength. Transition time: about 150 ms.

- Desktop: triggered by hover. Clicking locks the focus until Escape or clicking empty space.
- Mobile: triggered by tap. Tapping empty space clears it.
- Setting: link hop depth (default 1, maximum 3).

### 5.5 Search

The search bar sits at the top of the view and is always visible. Query syntax:

| Token | Meaning |
|---|---|
| `@name` | owner or people contains that person |
| `#category` or `#tag` | category or tag match |
| `status:blocked` | status filter |
| `due:<7d`, `due:overdue` | due-date filter |
| `type:task` | type filter |
| free text | fuzzy match on title, body, and the titles of linked vault notes |

Tokens are combined with AND. Chips show under the bar and each can be removed individually.

- Matches plus their ancestor paths are highlighted like focus. Everything else drops to 40%.
- If a match is hidden inside a collapsed or out-of-view node, the visible ancestor gets a count badge (for example "3").
- Result list dropdown: tap a result to jump to it and drill to its parent.
- Search should feel instant (under 100 ms) at 1,000 nodes. Index note bodies lazily.

---

## 6. Creating and editing

- **Quick add:** a "+" button, or the command palette. Choose the type, title and parent (defaulting to the current view root). Other fields are optional.
- **Inspector:** a side panel on desktop and a bottom sheet on mobile. It lets you edit every property, the linked items (with typed-link pickers that search nodes and vault notes), and the Drive links (paste a URL; an "Open" button opens it in the browser / Drive app). An "Open note" button opens the underlying markdown note.
- Edits save on field blur, with debounce, through `writer.ts`.
- **Archive, not delete:** "Archive" sets status to archived and hides the node by default (a filter can show archived nodes). A true delete is only available from the archive view, with confirmation. It moves the note to Obsidian's trash (*verify the trash API behaviour on mobile*).

---

## 7. Duplicate, move, link

### 7.1 Drag and drop

- Desktop: drag a node onto another node. Mobile: long-press to pick up, then drop.
- On drop, a dialog asks: **Move here** / **Link here** / **Cancel**.
  - **Move** sets the dragged node's `parent` to the target. Descendants come along automatically, because their parent is still the moved node. Blocked with a message if it would create a cycle.
  - **Link** opens a link-type picker (`relates` by default, `blocks`, `blocked_by`) and adds the link.
- Valid drop targets are highlighted during the drag.

### 7.2 Duplicate

The dialog offers these options:

- Include children? (none / direct / all descendants)
- Keep links? (none / copy links to the same targets)
- Where to put it? (same parent by default, or pick one)

New notes get new `planner_id`s and "(copy)" appended to their titles. Status resets to not-started, and `created`/`updated` are set to now. Internal links between the copied descendants are remapped to the copies.

### 7.3 Undo

- Keep a session undo stack of the last 20 actions (move, link, duplicate, archive, edit), each stored as a reversible batch of file changes.
- Git history remains the long-term safety net.

---

## 8. Sync and git behaviour

The plugin **never runs git**. Obsidian Git on each device handles commit, pull and push. The plugin's job is to make that painless:

1. **One file per node.** Edits touch only the nodes involved.
2. **Batched writes.** Every action (move, duplicate, bulk edit) goes through `writer.ts` as one batch, written together, so it tends to land in one commit.
3. **Nothing volatile in synced files.** No layout positions, no roll-up values, no "last opened" data in notes.
4. **Device-local view state.** Last view, zoom, filters and expanded rows are kept per device. Check where Obsidian stores plugin data (*verify: `.obsidian/plugins/<id>/data.json`*). If that file is in the repo and would churn, keep view state in local storage instead (*verify the recommended Obsidian API for device-local storage*), and keep only real settings in `data.json`.
5. **Recommended `.gitignore` entries** (confirm with Heyns before changing): `.obsidian/workspace.json`, `.obsidian/workspace-mobile.json` (*verify the file names*). These change constantly per device and cause most vault merge conflicts.
6. **Conflict detection.** If a node file contains git conflict markers (`<<<<<<<`), show it with a warning badge and exclude it from edits until fixed. Never auto-resolve.
7. **External edits.** If a note changes on disk (after a pull), refresh the graph incrementally without losing the current view.

### Getting the plugin onto all devices

Once the built plugin sits in `.obsidian/plugins/<plugin-id>/` and that folder is committed, git carries it to the laptop, desktop and phone. Heyns then enables it once per device. Confirm the plugins folder is actually tracked in the repo.

---

## 9. Mobile requirements (Samsung S23 Ultra)

- Touch targets are at least 44 px.
- Inspector as a bottom sheet. Toolbar collapses to icons.
- Long-press to drag, with haptic feedback if available (*verify*).
- Performance target: 60 fps pan/zoom with 300 visible nodes. Degrade labels before anything else.
- Test in both portrait and landscape.
- Obsidian Git on Android only syncs while Obsidian is open. The plugin should refresh cleanly after a pull on app open.

---

## 10. Theme — dark autumn

Define these as CSS custom properties scoped to the planner view:

```css
.planner-view {
  --pl-bg:        #1C1714; /* deep bark */
  --pl-surface:   #26201B; /* walnut */
  --pl-surface-2: #312821; /* chestnut */
  --pl-border:    #4A3B30; /* dark oak */
  --pl-text:      #EDE3D6; /* parchment */
  --pl-muted:     #A8988A; /* ash */
  --pl-accent:    #D9772B; /* burnt orange — selection, primary buttons */
  --pl-highlight: #E8B04A; /* amber — search matches, focus glow */
  --pl-blocked:   #B5482E; /* rust — blocked, overdue, "blocks" links */
  --pl-done:      #7E8A4A; /* moss */
  --pl-progress:  #C9962E; /* ochre — in progress */
  --pl-link:      #4F7C82; /* slate teal — relates links */
  --pl-category:  #7A3E4F; /* plum — category accent */
  --pl-dim:       0.4;     /* opacity for non-focused nodes */
}
```

| Status | Colour |
|---|---|
| not-started | `--pl-muted` outline, surface fill |
| in-progress | `--pl-progress` |
| blocked | `--pl-blocked` |
| done | `--pl-done` |
| archived | hidden by default; muted at 40% when shown |

- **Contrast check required:** verify WCAG AA for text and background pairs (especially `--pl-muted` on `--pl-surface`) and adjust if needed. These values have not been validated yet.
- The palette applies inside the planner view only and does not override the rest of Obsidian's theme.

---

## 11. Build phases and acceptance criteria

**Phase 1 — Data model and list view**

- Plugin loads on desktop and Android.
- It reads all node notes and builds the graph, and live-updates on vault changes.
- The list view shows the hierarchy with status, owner and due columns, plus roll-up progress.
- Quick add and the Inspector create and edit nodes. Files match section 4.
- The people and category registries work.

**Phase 2 — Bubble view and drill-in**

- Circle-pack overview of top-level projects, sized and coloured as specified.
- Drill-in, breadcrumb and back navigation work on desktop and mobile.
- Toggling between bubble and list keeps state.

**Phase 3 — Focus and search**

- Focus set and 40% dimming work (hover on desktop, tap on mobile).
- Search tokens, highlighting, count badges and the result list all work, meeting the speed target.

**Phase 4 — Links, drag, duplicate, undo**

- Typed links with arcs and out-of-view stubs.
- Move/Link drop dialog with cycle prevention.
- Duplicate dialog with child and link options and id remapping.
- Undo stack.
- Archive flow.

**Phase 5 — Polish**

- Drive link buttons, conflict-marker detection, contrast pass, mobile performance pass.
- Settings tab (folders, hop depth, defaults).

**Later (not v1)**

- Timeline / Gantt view by start and due dates.
- Listing Google Drive folder contents in the Inspector (needs Google sign-in).
- Multi-user fields and views.

---

## 12. Open questions for Claude Code to raise with Heyns

1. Exact folders and property names, after reading `_vault-guide.md`.
2. Is `.obsidian/plugins/` tracked in the vault repo? May the workspace files be added to `.gitignore`?
3. Is the "Automatically update internal links" setting on?
4. Should existing vault notes (for example the current project notes) be importable as nodes? If so, how are they mapped?
5. Plugin id and display name.

---

## Appendix A — Android setup for Obsidian Git (for Heyns, not Claude Code)

Steps as understood at the time of writing. **Verify each step against the current Obsidian Git plugin documentation**, because mobile support has changed over time.

1. Create a **fine-grained GitHub personal access token** limited to the `Heyns-h/Vault` repo, with read/write Contents permission. Store it somewhere safe.
2. Install Obsidian on the phone and create a new, empty vault.
3. In that vault, enable community plugins, install **Obsidian Git**, and enable it.
4. Use Obsidian Git's clone command. Enter the repo's HTTPS URL, your GitHub username and the token as the password. As far as I know, SSH isn't supported on mobile — verify.
5. Once cloned, restart Obsidian and open the vault.
6. In the Obsidian Git settings, turn on pulling when Obsidian starts and set the auto pull/push interval (match your 5–10 minutes). Check the exact setting names in the plugin.
7. First run: large vaults can be slow or run out of memory during the mobile clone. If that happens, check the plugin docs for workarounds before retrying.
8. Habit: open Obsidian and let it pull before editing, and let it push before closing. Background sync does not run while the app is closed.
