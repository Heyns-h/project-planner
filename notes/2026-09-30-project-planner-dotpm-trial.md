---
type: note
status: done
created: 2026-09-30
updated: 2026-09-30
---

> [!note] dotpm trial — plan and findings
> Moved from the app repo's `docs/` on 2026-09-30. The app repo is public; these notes stay private here.

Started 2026-09-30. Decision it feeds: adopt dotpm as the planner's data and editing layer, or build our own (blueprint as written).

## Stages

1. **Trial dotpm as-is** (this document). Throwaway vault, no changes to the real vault.
2. **Companion plugin: bubble view, focus highlight, search.** Required regardless of the trial outcome. If dotpm is adopted, this is a separate, read-only plugin over dotpm's notes (blueprint sections 5.1, 5.3–5.5, theme in section 10). If dotpm is rejected, these fold back into the full blueprint build. Not started until stage 1 is decided.
3. Adopt in the real vault: guide amendments, plugin id, `.gitignore`/`vault-check.sh` changes. Each needs Heyns's approval.

## Setup

| Item | Value |
|---|---|
| Test vault | `Project-Planner/test-vault/` (own local git repo, no remote) |
| Plugin | dotpm 2.5.2, id `project-manager`, from the GitHub release at `dotpm/obsidian-pm` |
| `main.js` sha256 | `a274b39f1fb501c7e4532d334adc6f19f8c9330a9124a42ee70c7e36bbc639c5` |
| Obsidian (laptop) | 1.13.7 (dotpm needs ≥ 1.13.0) |
| Seed | `heyns.md`, a vault-guide-shaped person note |
| Baseline commit | `3b08eea` — `git diff` / `git log -p` against it shows exactly what dotpm writes |

## Checklist

Fill in the result column as we go. "Guide" refers to `_vault-guide.md` in the real vault.

| # | Check | Result |
|---|---|---|
| 1 | Loads on laptop without errors (console clean) | |
| 2 | Create project, sub-project, task, sub-task. Record the exact frontmatter and file/folder names it writes | |
| 3 | Can the projects folder be set to a guide-style path (e.g. `02-cintoo/07-planner`)? | |
| 4 | Can statuses be set to the guide's values (`idea/active/on-hold/done/archived`)? | |
| 5 | Does it tolerate the guide's nine keys being added by hand (`domain`, `aliases`, …) and keep them on save? | |
| 6 | Does it accept kebab-case file names, or does it rename files to the title? | |
| 7 | Does `heyns.md` work as an assignee? What does it write into `assignees`? | |
| 8 | Git noise: edit one field → how many files and lines change? Any volatile data (timestamps, positions, ordering)? | |
| 9 | What goes in `.obsidian/plugins/project-manager/data.json`? Would it churn if tracked? | |
| 10 | Move a task to another parent: one property change, or file moves? | |
| 11 | Dependencies: what does it write, and at both ends or one? | |
| 12 | Archive and undo behave as documented | |
| 13 | Table view good enough to stand in for the blueprint's list view (5.2)? | |
| 14 | Android: copy the test vault to the phone, open, repeat 1, 2 and 13 | |
| 15 | Local API / MCP server stays off by default (desktop only, bearer token) | |
| 16 | Does the file format look stable enough for a stage-2 plugin to read? (docs/tasknotes.md upstream, changelog churn) | |

## Findings

### Round 1 — 2026-09-30, laptop (snapshot commit `d73628f`)

Heyns created: project **Necromunda** → sub-project **Hive Arcos** → tasks `test 1`, `test 2` → sub-task `test 3`; a second `test 3` directly under Necromunda (tag `taggy`); dependency `test 1` → Necromunda's `test 3`. `heyns.md` was left untouched.

What dotpm wrote:

```
Projects/Necromunda/Necromunda.md                  project
Projects/Necromunda/_tasks/test-3.md               task
Projects/Necromunda/Hive Arcos/Hive Arcos.md       sub-project = project with parent:
Projects/Necromunda/Hive Arcos/_tasks/test-1.md    task
Projects/Necromunda/Hive Arcos/_tasks/test-2.md    task
Projects/Necromunda/Hive Arcos/_tasks/test-3.md    type: subtask, parentId: test-2
.obsidian/plugins/project-manager/data.json        settings + view state
```

Results against the checklist:

| # | Result |
|---|---|
| 1 | Loads and writes on the laptop. Console not inspected yet. |
| 2 | See above. Projects: `pm-project, id, title, color, icon, taskIds, parent, customFields, teamMembers, savedViews, createdAt, updatedAt`. Tasks: `pm-task, projectId, parentId, id, title, type (task/subtask), status, priority, start, due, progress, assignees, tags, subtaskIds, dependencies, createdAt, updatedAt`. Ids are 16-char base36. |
| 3 | Partly. The root folder is a setting (`projectsFolder`), but below it the folders are named after project titles (`Hive Arcos/`) and sub-projects nest as folders. |
| 4 | Status ids are configurable in settings (defaults `todo/in-progress/blocked/review/done/cancelled`). Guide values not tried yet. |
| 5 | **Not tested.** Round 2. |
| 6 | Mixed. Task files are slugged (`test-1.md`); project files and folders keep the title (`Hive Arcos.md`). Behaviour on rename not tested. |
| 7 | Not tested: nobody was assigned, and dotpm looks for people in a `People/` folder (setting `peopleFolder`) that doesn't exist. |
| 8 | **Noisy.** (a) Both ends of every relation are stored: the project lists `taskIds`, each task has `projectId`; the parent lists `subtaskIds`, the child has `parentId`. Adding a dependency to `test 1` also rewrote `Hive Arcos.md` (same `updatedAt`, 08:20:24). (b) The quoting style differs between writes: `test-1.md` (edited twice) has unquoted values and `parentId:` as null, while the notes written once are fully quoted with `""`. So a second writer reformats the frontmatter. (c) `createdAt`/`updatedAt` are ISO timestamps with milliseconds. (d) The body is generated and duplicates frontmatter (`## Tasks` / `## Subtasks` checklists, `Project:` / `Parent:` lines). |
| 9 | **Mixed.** Real settings (statuses, priorities, folders) sit alongside per-device view state (`projectFilters`, `scopeViews`, `collapsedTasks`, `collapsedProjects`, `lastAutoArchiveDate`, `lastSeenVersion`) **and `localApiToken`, a secret**. |
| 10 | Not tested. Folder nesting suggests moving a sub-project moves files. Round 2. |
| 11 | Stored one-way, only on the dependent task: `dependencies: ["[[Projects/Necromunda/_tasks/test-3\|test 3]]"]`. Good for git. |
| 12 | Not tested. |
| 13 | Heyns to judge. |
| 14 | Not started. |
| 15 | `localApiEnabled: false` by default. ✓ |
| 16 | Readable: `pm-project`/`pm-task` flags, stable `id`, `parent`/`parentId`/`projectId`, `dependencies`. The duplicated relations mean a reader should trust the child side (`parentId`, `projectId`, `parent`) and ignore the parent-side lists. |

Additional observations:

- **Duplicate file names.** Two `test-3.md` exist. dotpm uses a full-path link where the name is ambiguous (`[[Projects/Necromunda/_tasks/test-3|…]]`) but a short link elsewhere (`[[test-3|test 3]]`). A short link written earlier becomes ambiguous as soon as a second file with the same name appears.
- **Icons are written into the heading.** The body starts with `# lucide-angry Necromunda`: the icon id is rendered as literal text in an H1.
- `start` defaults to the creation date.

Conflicts with `_vault-guide.md` if used in the real vault as-is: `title:` key (§5); `type: task/subtask` (§5 list); none of the nine required keys (§5, fails `vault-check` check 3); H1 in the body (§7); spaces and capitals in project file and folder names (§6); full-path wikilinks (§6 says wikilinks, and `vault-check` check 4 only resolves bare file names, so these fail); a new top-level `Projects/` folder (§2).

### Round 2 — 2026-09-30, laptop (prep `04c3431`, snapshot `8692cf6`)

Heyns changed `test 2`'s status and priority, assigned Heyns to `test 1`, moved `test 1` to Necromunda, renamed Hive Arcos → **Fiddlestix**, archived a task, relabelled the statuses, and turned on *Automatically update internal links* in the test vault.

| # | Result |
|---|---|
| 4 | **Labels only.** The status settings changed the display labels, but the stored ids stayed `todo/in-progress/blocked/review/done`, so files still contain dotpm's values, never the guide's. The relabelling also misaligned them: the id `review` is labelled "done" but is not marked complete, and the id `done` is labelled "archived". Whether the ids can be edited is not known. |
| 5 | **Keys kept, file reformatted.** The guide keys added to `test-2` survived with their values, but were moved to the end of the frontmatter. Every value lost its quotes, and the inline list became a block list. One status change rewrote 20+ lines. |
| 6 | **Renames move files and folders.** `Hive Arcos/Hive Arcos.md` → `Fiddlestix/Fiddlestix.md`, and the `_tasks/` folder moved with it. |
| 7 | ✓ `assignees: ["[[heyns]]"]`: a guide-style person note in `People/` works, linked by bare file name. |
| 8 | Quoting changes back and forth between writes: `test-1` went from unquoted back to fully quoted when it moved. A move touched 3 files (old project, new project, the task, which also changed folder). |
| 10 | **Moves move files.** `test 1` moved from `Hive Arcos/_tasks/` to `Necromunda/_tasks/`, and both projects' `taskIds` were rewritten. |
| 12 | **Archive moves the file** into `_tasks/Archive/`. The archived note's content was unchanged. The archived task (`test 3`) is still in `Archive/`, so either undo did not restore it or undo was not tried. Heyns to confirm. |
| 13 | **Rejected.** Heyns is not a fan of the table, Gantt or board views. |

**Broken links after the rename.** Four references still point at Hive Arcos, whose file no longer exists:

```
Fiddlestix/_tasks/test-2.md          projectId: "[[Hive Arcos|Hive Arcos]]"
Fiddlestix/_tasks/test-2.md          subtaskIds: "[[Projects/Necromunda/Hive Arcos/_tasks/test-3|…]]"
Fiddlestix/_tasks/test-2.md          body: Project: [[Hive Arcos|Hive Arcos]]
Fiddlestix/_tasks/Archive/test-3.md  projectId: "[[Hive Arcos|Hive Arcos]]"
```

This happened even though *Automatically update internal links* was on in `app.json`. Not established: whether the setting was switched on before or after the rename, and whether dotpm renames through the link-updating API. Either way, the data is left inconsistent.

### Decision — 2026-09-30

**dotpm dropped** (Heyns). Lesson 1 accepted: it replaces the symmetric `blocks`/`blocked_by` rule in blueprint §4.2. `test-vault/` is kept for testing our own plugin.

Reasons: Heyns rejected its views, and its file format goes against blueprint §8 (both ends of relations stored, file moves on rename/move/archive, reformatting on every write) as well as most of `_vault-guide.md`. Reading its format for the stage-2 bubble view would also mean inheriting the broken links above.

What the trial taught, to carry into our own build:

1. **Store each relation once, on the child or dependent side**: `parent` on the child, `blocked_by` on the dependent. Derive `children` and `blocks` in memory. This departs from the blueprint's §4.2 rule that `blocks`/`blocked_by` stay symmetric. Two stored ends double the files touched and create merge-conflict hotspots.
2. **Never move files** on move, archive or rename-of-parent. Hierarchy is a property; archive is a status.
3. **One writer that preserves key order and quoting**, so a status change is a one-line diff. Obsidian's `processFrontMatter` may reserialise the whole block; to verify in step 4.
4. **Stable id plus links by bare file name**, with unique file names enforced at creation, so links never need paths.
5. **Device-local view state and no secrets in `data.json`.**
6. **Link integrity after renames** must be tested explicitly, not assumed from the Obsidian setting.

Concern for git sync across three devices (blueprint §8): because both ends of each relation are stored, every task added to a project also rewrites the project note's `taskIds` line. Two devices adding tasks to the same project between syncs will make a merge conflict on that line, and Obsidian Git has `mergeStrategy: none`.
