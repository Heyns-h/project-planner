---
type: reference
status: active
created: 2026-10-17
updated: 2026-10-20
---

> [!note] Project Planner & Tracker — Blueprint v0.3
> **Approved by Heyns 2026-10-20.** This is the working spec; [v0.2](project-planner-blueprint-v0-2.md) is superseded. This note moves with the other planning docs to the hub repo's `docs/` when section 14 runs.

Version 0.3 · drafted 2026-10-17 on the desktop, revised 2026-10-20 on the laptop (review findings 1–7 applied, agreed by Heyns) · Owner: Heyns · **Approved 2026-10-20**

Supersedes [v0.2](project-planner-blueprint-v0-2.md). One change of direction drives everything here: **the planner gets its own private hub repo and owns its own format**, instead of living inside the vault and deferring to `_vault-guide.md`. The vault is being slimmed to a Claude-config repo and Obsidian retired, so anything the planner borrowed from the vault would lose its source.

Sections marked *unchanged* still read as in v0.2. Section 13 lists every change and why. Verification codes such as (G5) and (B9) refer to the [verification](2026-09-30-project-planner-verification.md).

---

## 0. Read this first (instructions for Claude Code)

1. **This blueprint is the authority** on the hub repo's structure, the node format and naming. `_vault-guide.md` no longer applies to planner data. Where this blueprint and the code disagree, flag it rather than choosing silently.
2. **Verify every API against current documentation** before using it. Items marked *verify* are the author's belief, not fact. Never invent an endpoint, method or browser capability.
3. **Ask, don't assume.** Anything ambiguous goes to Heyns before it is built.
4. **Never write to the hub repo during development.** Development and tests run against the sandbox repo (section 10). The app touches the hub only after Heyns approves it.
5. **No secrets in any repo.** The GitHub token lives only in each device's browser storage. It never goes in code, in config, in a URL or in a log.
6. Scratch for this project stays in the app folder. Nothing from the hub or the sandbox goes into the public app repo.

---

## 1. Goal

A personal planner for projects, sub-projects, tasks and sub-tasks. It runs as an **installable web app (PWA)** on phone and computer alike, works **offline**, and syncs when the connection returns.

Every item is an ordinary markdown note **in a private hub repo**, so the plan is versioned, readable by Claude sessions and editable by hand, and it survives the app.

**The hub is the one place every project is planned from.** Each project lives wherever it lives — its own GitHub repo, a Google Drive folder, a plain folder — and its top-level planner node records where. A Claude session opened at a project finds its node from that record (section 4.7).

Single user for now (Heyns). The data is designed so multi-user can be added later without restructuring.

---

## 2. Decisions already made

| Topic | Decision | Since |
|---|---|---|
| Form | Installable web app (PWA), not an Obsidian plugin | v0.2 |
| Devices | Phone (Samsung S23 Ultra, Chrome) and laptop/desktop, used equally | v0.2 |
| Offline | Full read and edit offline; edits queue and sync on reconnect | v0.2 |
| **Storage** | One markdown note per node, **in a dedicated private hub repo** (working name `Heyns-h/planner-hub`); frontmatter holds structured data | **v0.3** |
| **Connection model** | **Hub, not spread out.** All planner notes in one repo; each project node records its home (`repo`, `folder`, `drive`). Projects carry nothing | **v0.3** |
| **Format owner** | **The planner owns its schema**, enforced by `validate.ts` and mirrored by the hub's `tools/planner-check.sh` | **v0.3** |
| Sync | The app talks to GitHub's REST API directly. Machines with a local clone pick changes up with a normal pull | v0.2 |
| Auth | GitHub fine-grained personal access token, limited to the hub repo, entered once per device | v0.2, repo changed v0.3 |
| Hosting | Static site on GitHub Pages from a **public** app repo, Cloudflare Pages as fallback (G10). The code is public; the data never enters the app repo | v0.2 |
| Relations | **Stored once**, on the child or dependent side. Reverse directions are derived in memory | v0.2 |
| Files never move | Moving, archiving and re-parenting change a property, never a path | v0.2 |
| **Obsidian** | **Not used.** No Obsidian links, plugins or timers anywhere in the design | **v0.3** |
| Users | Just Heyns. People are picked from person notes in `people/` | v0.1, folder changed v0.3 |
| Shared documents | Google Drive links stored on the node, opened with a button. No Drive API in v1 | v0.1 |
| Overview | Bubble view (one level, free-floating) with a collapsible tree list; see the Phase 2 plan for the approved look | v0.1, revised in Phase 2 |
| Touch | Phone: double-tap drills in, hold opens the radial; desktop: double-click drills in | Phase 2, decision 17 |
| Search | Structured tokens plus free text, highlighted like focus | v0.1 |
| Extras | Roll-up, typed links, people as entities, archive not delete, timeline later | v0.1 |
| Palette | Dark autumn (section 9) | v0.1 |
| dotpm | Trialled and dropped. Findings in [dotpm-trial.md](2026-09-30-project-planner-dotpm-trial.md) | v0.2 |

---

## 3. Architecture

Unchanged from v0.2 §3 except for the data repo:

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
 │ sync engine ── GitHub REST API ── hub repo         │
 └────────────────────────────────────────────────────┘
 service worker: caches the app shell so it opens offline
```

Stack, rendering, writer and IDs are as v0.2 §3 (Vite 8, Preact 10.29.x, d3, `yaml` Document API with schema 1.2, ULID `planner_id`).

**Module changes:** `validate.ts` now states the rules itself (section 4.8) instead of mirroring `vault-check.sh`. `tags.ts` reads `tags/<domain>.md`. People are read from `people/`. `slug.ts` checks uniqueness against `nodes/`, `people/` and `docs/` (section 4.1).

---

## 4. Data model

### 4.1 Hub layout and file names

```
planner-hub/                    private
├── README.md                   what the hub is; points at this blueprint
├── CLAUDE.md                   rules for sessions opened at the hub (section 8.5)
├── nodes/
│   └── <domain>/               planner notes, flat, one folder per domain
├── people/                     one note per person, flat
├── tags/
│   └── <domain>.md             vocabulary table; a domain exists if its file exists
├── docs/                       blueprints, plans, verification, trials — never parsed as nodes
└── tools/
    └── planner-check.sh        the rules of 4.8, runnable outside the app
```

- **A node's place in the hierarchy comes from `parent`, not from the folder.** The folder only records the node's domain at creation.
- **The stored `domain` is the birth domain and is never rewritten.** It is set at creation — from the parent, or chosen for a new top-level project — and records where the node was born, like the folder. The domain a node is *shown* under (filters, the ring, the tag list the picker offers) is the **effective domain, derived in memory from its root project** the same way children and `blocks` are derived. So a cross-domain move changes one line (`parent`): no subtree is rewritten and no file moves.
- **Domains** are the files in `tags/`. The file stem is the domain id (`necromunda`) and the file's `aliases[0]` is its display label (`Necromunda`). Adding a domain means adding `tags/<domain>.md`. Starting set: `cintoo`, `code`, `necromunda` (the sandbox's three).
- **File name:** a kebab-case slug of the title. If the name is already taken in `nodes/`, `people/` or `docs/`, a numeric suffix is added (`-2`), so a bare-stem link always resolves to one file. **The file is never renamed after creation.** A title change edits `aliases[0]` only.
- `docs/` is outside the planner's graph. Its notes are not nodes and need no planner keys, and the node checks skip them — but their stems **count for uniqueness**, because a `[[stem]]` may point at them (4.8, rules 3 and 7).

### 4.2 Properties

The shape is the one v0.2 used, kept so existing sandbox files and the Phase 1 writer stay valid. What changed is **who defines it**: this section, not the vault guide. Empty values stay present rather than being omitted, so every node has the same shape — with one exception: the two home keys (`repo`, `folder`) exist on project nodes only.

```yaml
---
type: note                          # project for planner projects, note otherwise
domain: cintoo                      # one of the tags/ files; set at creation, never rewritten (4.1)
project: ""                         # always empty on nodes (see 4.6)
version: ""                         # always empty on nodes
status: active                      # vocabulary in 4.3
tags: []                            # from tags/<domain>.md
created: 2026-09-25
updated: 2026-09-30
aliases:
  - Confirm freight quote           # aliases[0] = display title
planner_id: 01J8Z6K2Q4...           # ULID, never changes
planner_type: task                  # project | subproject | task | subtask
parent: "[[sourcing-q4-range]]"     # empty for top-level projects
priority: medium                    # low | medium | high
owner: "[[heyns]]"
people: []
start: 2026-09-20
due: 2026-10-05
blocked_by: ["[[place-po]]"]        # stored on the dependent only
relates: []                         # stored once; read as undirected
references: []                      # other hub notes, including docs/
drive: []                           # Google Drive URLs (shared documents)
repo: ""                            # projects only — home: GitHub owner/name (4.7)
folder: ""                          # projects only — home: folder name, machine-independent (4.7)
---
Free markdown body. No H1 heading; the display title is aliases[0].
```

Rules:

- **No `title:` key.** The display title is `aliases[0]`, falling back to the file stem.
- **Links are `[[stem]]`**, bare file stems, never paths. This is the planner's own link format, resolved by `graph.ts`; it is not tied to any editor.
- **Each relation is stored once.** `parent` lives on the child; children are derived. `blocked_by` lives on the dependent; `blocks` is derived. `relates` is stored on one side and read as undirected. No parent-side lists.
- **Dates are `YYYY-MM-DD`.** `updated` changes at most once a day per node.
- `type`, `project` and `version` are kept for shape compatibility only. Dropping them is possible later and is **not** part of v0.3 (section 12, question 4).
- `repo` and `folder` exist **only on `planner_type: project`** nodes (4.7). Other types do not carry them at all, so an edit to a task never touches them and a one-field edit stays a one-line diff. New projects are written with both keys, empty when unknown; a project written before v0.3 gains them on the first edit of either field.
- Multi-user later: add `assignee` and `visibility`. Nothing needs restructuring.

### 4.3 Status

Unchanged from v0.2 §4.3: stored `idea | active | on-hold | done | archived`, shown as Not started / In progress / Blocked / Done / Archived. Archived is excluded from roll-up. Blocking derived from an unfinished `blocked_by` target is shown, never written.

### 4.4 Registries

- **People:** every note in `people/` with `type: person`. A new person is created there directly by the app, with the nine keys of 4.2 and an empty planner block. Reading one folder keeps the 2026-09-30 decision that people are not searched for across the whole repo.
- **Tags:** the picker offers only the node's domain list, parsed from the Vocabulary table in `tags/<domain>.md`. **Add tag…** (Phase 2 plan) appends a row there in the same commit as the edit that uses it. The app never invents a tag silently.
- **Categories:** dropped (2026-09-30). Domain plus tags cover grouping.
- **Cross-domain links:** the graph spans `nodes/` and `people/`, and stems are unique across both, so every relation works between domains.

### 4.5 Hierarchy rules

- `project`: no parent. Nesting under another project is allowed with a warning.
- `subproject`: parent is a project or subproject.
- `task`: parent is a project or subproject. A task under a task is **allowed with a warning**: it predates sub-tasks, and new work under a task is a `subtask`.
- `subtask`: parent is a task. Counts like a task for progress and the ring (Phase 2 decision 16).
- **No cycles.** Any move that makes a node its own ancestor is rejected.

### 4.6 Roll-up

Unchanged from v0.2 §4.6: progress is the share of descendant tasks and sub-tasks that are done, archived excluded; computed in memory, never written. Blocking and overdue roll-up as approved in the Phase 2 plan (inherited blocking only when every open task beneath is blocked).

`project:` stays empty on nodes, for the same reason as before: filling it with the root's slug would make every move rewrite a subtree. The effective domain (4.1) is derived in memory for the same reason.

**"Adopt" is withdrawn.** v0.2 planned for a planner project to *be* a vault project's `_<slug>-moc.md` index. Those index notes go with Obsidian. Its job — tying a planner project to a real project — is done by 4.7.

### 4.7 Project homes

A top-level project records where its work lives. Three properties, any combination, all optional:

| Property | Holds | Example | Resolves on |
|---|---|---|---|
| `repo` | GitHub `owner/name` | `Heyns-h/finance-tracker` | Any machine: compare with `git remote get-url origin` |
| `folder` | A folder **name**, never a path | `Finance-Tracker` | Any machine: compare with the working directory's last segment |
| `drive` | Google Drive folder URL (existing key) | `https://drive.google.com/drive/folders/…` | Opened with a button |

- **Never store an absolute path.** The two machines keep things at different paths (`C:\Users\heyns\…` and `C:\Users\User\…`); a path is right on one and wrong on the other.
- `repo` is the strongest match and should be filled for every project that has one. `folder` is for projects that are not git repos, such as Drive-synced folders.
- A project with none of the three is fine — an idea need not have a home yet.
- Sub-projects inherit their root's home. They do not carry their own in v0.3.
- **Inspector:** a "Home" group on project nodes edits the three fields and shows `repo` as a link to GitHub.
- **Uniqueness warning, not a rule:** two projects with the same `repo` or `folder` get a warning badge, because the back-link in 8.6 would be ambiguous.

### 4.8 Conformance rules

`validate.ts` refuses an op that would produce a file breaking these, and `tools/planner-check.sh` checks the same rules on the whole hub, so a hand or Claude edit can be checked before it is pushed.

1. Every file in `nodes/` and `people/` has frontmatter with the keys of 4.2 that apply to it — the home keys `repo` and `folder` on projects only, none on people — in that order, none omitted, no `title:`.
2. `domain` is one of the `tags/` files; `status`, `priority` and `planner_type` take only the listed values.
3. Every `[[stem]]` in a node's frontmatter resolves to a file in `nodes/`, `people/` or `docs/`.
4. Hierarchy rules of 4.5 hold and there are no cycles.
5. Every tag on a node is in its domain's vocabulary.
6. `repo` matches `owner/name`; `folder` contains no `/`, `\` or drive letter.
7. Stems are unique across `nodes/`, `people/` and `docs/`.

---

## 5. Views

Unchanged from v0.2 §5, as revised by the approved Phase 2 decisions (one-level bubble view, radial menu, segmented ring, counts by type). The Phase 2 plan is the authority on the bubble view until it is folded into a later blueprint.

Addition: a project node with a home shows a small home marker (repo or folder) in list view and under its bubble name. Tapping it opens the GitHub repo or Drive folder.

---

## 6. Creating and editing

As v0.2 §6, with two changes:

- **"Open in Obsidian" is removed.** "View note" opens the file on GitHub, in the hub.
- **Quick add** for a new top-level project asks for domain and, optionally, its home (4.7).

---

## 7. Duplicate, move, link, undo

Unchanged from v0.2 §7. Duplicating a project **clears** `repo` and `folder` on the copy, so two projects never claim the same home by accident.

---

## 8. Offline and sync

### 8.1 – 8.4

Unchanged from v0.2 §8.1–8.4 (IndexedDB stores, pull by tree and blob SHA, one commit per push through three write requests, field-level conflicts, nothing resolved automatically), with the repo changed to the hub.

One wording change in §8.3: the edits that can arrive between pull and push now come from **a Claude session or a hand edit on a machine with a hub clone**. There is no Obsidian Git timer anywhere; the earlier note about a 10-minute auto-commit delay no longer applies.

### 8.5 Other writers

- Claude sessions and hand edits may change hub files. The app treats them like any remote change, and the op rebase in 8.3 handles them.
- **Rules for a writer outside the app**, held in the hub's `CLAUDE.md`: pull before editing; edit frontmatter one field at a time without reordering keys; run `tools/planner-check.sh`; commit and push straight away so the app sees the change within one polling interval. An unpushed edit is invisible to the app and is the likeliest source of a conflict.
- The app never writes outside `nodes/`, `people/` and `tags/`; the only write to `tags/` is **Add tag…**, whose dialog is the confirmation. It never writes under `docs/`, `tools/` or `.github/` (G6).
- Line endings are LF, set by the hub's `.gitattributes`.

### 8.6 Back-link from a project

A project carries no planner file. The link back is one rule in the user-level `CLAUDE.md` that every Claude Code session on the machine loads:

> When the session's working directory is a project, look in the hub for a node with `planner_type: project` whose `repo` equals this folder's `origin` remote, or whose `folder` equals this folder's name. If one is found, read it and its open tasks before starting, and say which node it is.

- **How a session reaches the hub:** a local clone of the hub on each machine, linked at `~/.claude/planner` the same way the vault is linked at `~/.claude/vault`, so the rule never needs a machine path. *Verify when built:* whether a session can read through the junction alone. Today the vault is readable in project sessions because it is listed in `permissions.additionalDirectories`, not proven through its junction, so expect to list the hub clone the same way on both machines.
- The lookup is a text search over `nodes/` (`repo:` and `folder:` lines); no index file is generated.
- No match is not an error. The session says so once and carries on; the project can be given a home from the app later.

---

## 9. Mobile, PWA and theme

### 9.1 Mobile

Unchanged from v0.2 §9.1.

### 9.2 Security

As v0.2 §9.2, with the token limited to the **hub repo** (Contents: read and write, plus the automatic read-only metadata permission; 90-day expiry; warning 14 days before). Strict CSP in a `<meta>` tag; refuses to run inside a frame; bodies and titles rendered as text, never as HTML.

The hub holds only planner data and its docs, so the token's reach is smaller than v0.2's, which would have covered the whole vault.

### 9.3 Theme

Unchanged from v0.2 §9.3. The contrast check is still to be done.

---

## 10. Development and testing

- **App repo:** `Heyns-h/project-planner`, public, deployed to Pages. Unchanged.
- **Sandbox repo:** `Heyns-h/planner-sandbox`, private. **Reshaped to the hub layout** of 4.1: planner notes move from `<NN-Domain>/07-planner/` to `nodes/<domain>/`, people to `people/`, tag lists to `tags/<domain>.md`. The copies of `_vault-guide.md` and `vault-check.sh` are removed and replaced by `tools/planner-check.sh`. This is a one-off restructuring commit, shown to Heyns before it is pushed, and made **only when every device shows nothing unsynced**: a queued `create` carries its path and would otherwise write into the old folder.
- **Unit tests:** as v0.2, plus the rules of 4.8, the home fields of 4.7, and `subtask` hierarchy rules. Test fixtures move to the hub layout.
- **Manual tests:** each phase, laptop Chrome, desktop, and the S23 installed app, including airplane mode → edit → reconnect.

---

## 11. Build phases and acceptance criteria

Phases 0 and 1 are accepted and are not re-run. Phase 2 is in progress.

**Phase 2½ — Hub layout** *(new; small, between Phase 2 and Phase 3)*
- App reads and writes the hub layout of 4.1. Paths in `tags.ts`, the people reader and `slug.ts` updated.
- `validate.ts` implements 4.8 (including stem uniqueness across `docs/` and the warning for a task under a task); `tools/planner-check.sh` added to the sandbox and passes on it.
- The effective domain is derived from the root project (4.1); the stored `domain` is no longer rewritten by anything.
- Home fields (4.7) in the Inspector and the data model.
- Sandbox reshaped (section 10).
- **Accepted when:** the Phase 1 two-device test passes again on the reshaped sandbox, and `planner-check.sh` passes on it.

**Phase 3 — Focus and search.** Unchanged. Search gains a `home:` token (`home:none` finds projects without one).

**Phase 4 — Links, drag, duplicate, undo.** As v0.2, **without Adopt**.

**Phase 5 — Polish and switch-over**
- Drive link buttons, contrast pass, mobile performance pass, token-expiry warning, settings page.
- **Switch from the sandbox to the hub repo.** The hub holds only planner data, so switching risks no other notes; it may be done earlier by agreement.
- The back-link rule (8.6) and the `~/.claude/planner` link set up on both machines.

**Later (not v1):** timeline / Gantt; Drive folder contents in the Inspector; multi-user.

---

## 12. Open questions for Heyns

| # | Question | Proposed answer |
|---|---|---|
| 1 | Hub repo name | `Heyns-h/planner-hub`. Any name works; it appears in the token and the app settings only |
| 2 | When to switch from sandbox to hub | Phase 5 as planned, or right after Phase 2½ since the hub holds no other notes |
| 3 | Who sets up the `~/.claude/planner` link | The hub ships its own small link script, rather than extending the vault's `resolve-skills.sh` |
| 4 | Drop `type`, `project`, `version` from nodes | Not now. They cost nothing and keep Phase 1 files valid |
| 5 | Sub-projects with their own home | Not in v0.3. Add only if a real case appears |
| 6 | Seed the hub with real projects | After switch-over, one top-level project per real project folder or repo, each with its home filled |

---

## 13. Changes from v0.2

| Area | v0.2 | v0.3 | Why |
|---|---|---|---|
| Data repo | `Heyns-h/Vault` | Private hub repo | Vault slimmed to Claude config; Obsidian retired |
| Format authority | `_vault-guide.md` | This blueprint, `validate.ts`, `planner-check.sh` | The guide is being retired; the planner must not depend on it |
| Folder for nodes | `<domain>/07-planner/` | `nodes/<domain>/` | No vault domain shape to fit into; no guide amendment needed |
| People | `<domain>/06-people/`, `tpl-person.md` shape | `people/`, shape defined in 4.2 | One folder; no Templater templates |
| Tags | `_<domain>-tags.md` | `tags/<domain>.md` | Same table, owned by the hub |
| Validation | Mirror `vault-check.sh` checks 3 and 4 | Rules of 4.8 | Planner states its own rules |
| Planner types | project, subproject, task | **+ subtask** | Phase 2 decision 16, folded in |
| Home keys | — | `repo`, `folder` on project nodes only | Keeps a one-field edit a one-line diff on every other node (review finding 1) |
| Domain | Stored, inherited from the root | Stored at birth, never rewritten; effective domain derived from the root | A cross-domain move changes one line (review finding 4) |
| Stem uniqueness | Every `.md` in the vault | `nodes/`, `people/` and `docs/` | A link into `docs/` must resolve to one file (review finding 2) |
| Linking to projects | "Adopt" a project's MOC (Phase 4) | `repo` / `folder` / `drive` home on the project (4.7) | MOCs go with Obsidian; works for repos and Drive alike |
| Project → planner | Not designed | One user-level `CLAUDE.md` rule (8.6) | Every project connects without a file in each repo |
| Obsidian | Optional "Open in Obsidian"; Obsidian Git timing in sync notes | Removed | Obsidian not used |
| Token reach | Whole vault | Hub only | Smaller exposure |
| Planning docs | In the vault | Hub `docs/` | Private, next to the data they describe |

## 14. Moving the planning docs

When this draft is approved:

1. Create the hub repo (private, empty), guided.
2. Move this note, v0.1, v0.2, the Phase 0–1 and Phase 2 plans, the verification and the dotpm trial into `docs/`, and the project index into `docs/README.md`. Git history does not follow a file across repos, so the hub commit message names the vault commit the files came from.
3. Their `[[…]]` links to vault notes (`_vault-guide`, `_code-moc`) are left as written: these docs are history, and `docs/` is outside the link check.
4. Delete the originals from the vault in one commit after the hub copy is pushed and checked.

Do this on the laptop, or after the laptop has pushed: all recent planner work was made there.
