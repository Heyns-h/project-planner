---
type: reference
status: active
created: 2026-09-30
updated: 2026-10-20
---

> [!info] Current version
> **v1** — installable offline-first web app (PWA) that keeps projects, sub-projects and tasks as markdown notes in this vault and syncs through the GitHub API. Spec: [project-planner-blueprint-v0-2](project-planner-blueprint-v0-2.md).

**Location**
- Folder: `Project-Planner` (a sibling of the vault folder)
- Repo: `https://github.com/Heyns-h/project-planner` (public, app code only)
- Live app: `https://heyns-h.github.io/project-planner/`
- Test data: `Heyns-h/planner-sandbox` (private)

## Goal

Plan and track projects, sub-projects and tasks from phone and computer, offline or online, with every item stored as an ordinary note in this vault. Done when blueprint v0.2 Phases 0–5 pass their acceptance criteria against the real vault.

## Scope

**In scope:** the web app; the note format for planner nodes (`<domain>/07-planner/`); sync with the vault repo; bubble view, focus highlight and search.

**Out of scope:** moving the vault off Obsidian (its own plan, after Phase 1); Google Drive integration beyond links; multi-user.

## Versions

| Version | Status | Summary |
| --- | --- | --- |
| v1 | active | Web app per blueprint v0.2. Blueprint v0.1 (Obsidian plugin) is kept in `v1/` as superseded history |

## Notes

- [project-planner-blueprint-v0-3](project-planner-blueprint-v0-3.md) — **the spec (current, approved 2026-10-20)**: private hub repo, planner-owned format, project homes
- [project-planner-blueprint-v0-2](project-planner-blueprint-v0-2.md) — superseded by v0.3 on 2026-10-20
- [project-planner-plan-phase-0-1](project-planner-plan-phase-0-1.md) — implementation plan, Phases 0 and 1 (accepted 2026-10-01)
- [project-planner-plan-phase-2](project-planner-plan-phase-2.md) — implementation plan, Phase 2: bubble view and drill-in (approved 2026-10-01)
- [2026-09-30-project-planner-verification](2026-09-30-project-planner-verification.md) — every *verify* item checked against official docs
- [2026-09-30-project-planner-dotpm-trial](2026-09-30-project-planner-dotpm-trial.md) — the dotpm plugin trial and why it was dropped
- [project-planner-blueprint-v0-1](project-planner-blueprint-v0-1.md) — superseded Obsidian-plugin blueprint

## Assets

None.

## Decisions

| Date | Decision | Why |
| --- | --- | --- |
| 2026-09-30 | dotpm trialled and dropped | Views not liked; stores relations at both ends, moves files, broke links on rename |
| 2026-09-30 | Web app (PWA) instead of an Obsidian plugin | Obsidian barely used; phone and computer used equally; offline required |
| 2026-09-30 | Relations stored once, on the child side | Fewer files touched per edit, fewer merge conflicts |
| 2026-09-30 | Nodes in `<domain>/07-planner/`; categories dropped | Vault guide shape; domain plus tags cover grouping |
| 2026-09-30 | Preact 10.29.x; 90-day token; 30 s polling while visible | Stability; least exposure; near-live updates at no rate-limit cost |
| 2026-09-30 | App repo public, planning docs kept here | The docs describe the vault |
| 2026-09-30 | **Phase 0 accepted** (laptop and S23: install, connect to sandbox, 7 nodes, offline) | Acceptance run by Heyns |
| 2026-09-30 | People are read from `06-people/` folders only | Finding `type: person` anywhere would mean downloading every note |
| 2026-10-01 | **First real writes to the sandbox accepted** (phone and laptop edits, one new project) | Each commit changed only the edited line, plus `updated` on the first edit of the day; vault-check 3 passes |
| 2026-10-01 | Conflict dialog offers keep mine / take theirs / go back to base; a deleted or read-only note only allows discarding | Blueprint §8.4: nothing resolved automatically; a decision becomes a fresh op from the repo's value |
| 2026-10-01 | **Phase 1 accepted** (laptop two profiles, S23 airplane-mode round trip, same-field conflict, restart survival; 10 sandbox commits, each changing only the edited lines). One gap carried forward: the tag vocabulary can be read and applied but new tags cannot be added from the app yet (the `addTag` op exists without UI) | Acceptance run by Heyns against blueprint §11 |
| 2026-10-01 | One commit per push (several action batches listed in the body), not one per action | Fewer commits; the body still records each action |
| 2026-10-01 | **Phase 2 plan approved.** Arcs/stubs stay in Phase 4; drill-in by double-click / tap-again / Open; breadcrumb pushes forward; bubble view by default with the toggle always visible; empty or all-done projects shrink and darken but stay until archived; new tags need name and meaning | Heyns's answers to plan §9 |
| 2026-10-01 | Bubble view: typed links drawn now as lines (solid within a domain, dotted across); fill by level from muted orange to muted brown, status on the rim | Heyns at the 2a checkpoint; plan Phase 2 §9 items 7–8 |
| 2026-10-01 | **2a look approved.** Inherited blocking only when every open task beneath is blocked; otherwise the progress wheel is tinted. Tag-based colours to come later (hook kept) | Heyns approving 2a; plan Phase 2 §9 items 9–10 |
| 2026-10-02 | Bubble view shows one level only, free-floating; each bubble names its node and summarises what is inside (count, attachments, due pressure with a pulsing/steady red bubble) | Heyns after the laptop part of the 2d run; plan Phase 2 §9 items 11–13 |
| 2026-10-02 | Tap opens a radial (Edit · Open) instead of the Inspector; the rim ring shows tasks beneath by state (due, near due, blocked, open, done) with segments sized by count; the red due-bubbles are gone | Heyns after the phone check; plan Phase 2 §9 items 14–15 |
| 2026-10-02 | Sub-task type added under tasks; bubbles list counts by type below their own; sandbox seeded to 39 planner notes across the three domains | Heyns; plan Phase 2 §9 item 16 |
| 2026-10-05 | Phone: double-tap drills down, hold opens the radial (Edit only for now); the radial closes on camera movement, not on touch | Heyns from the S23; plan Phase 2 §9 item 17 |
| 2026-10-20 | **Blueprint v0.3 approved** (hub repo, planner-owned format, project homes) with review findings 1–7 applied; Phase 2½ started: app on the hub layout, §4.8 rules in validate.ts and tools/planner-check.sh, home fields, sandbox reshaped | Heyns; blueprint v0.3 §11 |
| 2026-10-20 | **Phase 2½ accepted**: two-device test on the reshaped sandbox (four one-line edits, offline round trip with a task born in nodes/cintoo/, same-field conflict caught on the second pusher, a project home set) and planner-check.sh clean. One sync fix on the way: an unchanged ref now still fetches indexed content files missing from the cache | Acceptance run by Heyns; v0.3 §11 |

## Related

- Code domain index (retired with the Obsidian vault, 2026-11-03) — domain index
- [vault guide](https://github.com/Heyns-h/Vault/blob/main/_vault-guide.md) — structure, frontmatter and naming
