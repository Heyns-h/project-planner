---
type: plan
status: active
created: 2026-09-30
updated: 2026-09-30
---

> [!note] Implementation plan — Phases 0 and 1
> Moved from the app repo's `docs/` on 2026-09-30. The app repo is public; these notes stay private here.

Version 1 · 2026-09-30 · **For Heyns's approval.** Nothing is built until this is approved.

Spec: [blueprint v0.2](project-planner-blueprint-v0-2.md) · Evidence: [verification record](2026-09-30-project-planner-verification.md) (codes G/B/L).

---

## 1. Scope

**Phase 0 — Plumbing.** Repo, build and CI deploy to GitHub Pages. Installable on the S23 and the laptop. Token entry, pull from the sandbox repo, parse nodes, show a node count. Opens with cached data in airplane mode.

**Phase 1 — Data model, list view, offline editing and sync.** Graph with incremental refresh. List view with hierarchy, status, owner, domain, due and roll-up progress. Quick add and the Inspector create and edit nodes whose files match blueprint §4 and pass `vault-check.sh` checks 3 and 4. People and tag registries. Offline edits queue, survive a restart, and sync as one commit per push. Field-level conflicts go to a dialog. Nothing is lost or silently overwritten in the two-device test.

**Out of scope:** bubble view, drill-in, focus, search, drag/duplicate/undo, and Adopt (Phases 2–4). d3 is not installed until Phase 2.

---

## 2. Repos and what Heyns creates

| Repo | Visibility | Holds | Who creates |
|---|---|---|---|
| `Heyns-h/project-planner` | **Public** | App source and CI. Deployed to `https://heyns-h.github.io/project-planner/` | Heyns (guided), empty, no README. Claude pushes the first commit **after approval** |
| `Heyns-h/planner-sandbox` | Private | Test data in the vault shape | Heyns (guided earlier, not created yet). Claude seeds it **after showing the content** |
| `Heyns-h/Vault` | Private | The real vault | Untouched in Phases 0–1 |

**The app repo is public**, so nothing from the real vault goes in it. Test fixtures are synthetic or derived from `test-vault/`. `test-vault/` (its own nested git repo) and a local sandbox clone are gitignored in the app repo.

Two tokens, both fine-grained, 90 days, Contents read/write, one repo each: `planner-sandbox` now, `Vault` at switch-over. They are entered on each device in the app's setup screen and never pasted into chat or files.

---

## 3. Tooling (versions from the verification record)

| Package | Version | Why |
|---|---|---|
| `preact` | `~10.29` (pinned, L7) | UI |
| `@preact/preset-vite` | `^2.10` | JSX, dev tools |
| `vite` | `^8.3` | Build (L8) |
| `vite-plugin-pwa` | `^1.3` | Manifest and service worker via Workbox, `generateSW`, `registerType: 'prompt'` so an update never reloads mid-edit (L8) |
| `yaml` | `^2.9` | Frontmatter, Document API, `flowCollectionPadding: false` (L4) |
| `ulid` | `^3.0` | `planner_id` (L5) |
| `typescript` | current 5.x | Strict mode |
| `vitest` | `^5.0` | Tests. Needs **Node ≥ 22.12** (L9). Laptop 24.19 ✓, desktop unchecked |
| `fake-indexeddb` | `^6.2` | IndexedDB in tests (L9) |

IndexedDB is used through a small wrapper of our own (`store/db.ts`, about 100 lines), with no library. Nothing else at runtime. CI runs on Node 24.

---

## 4. File layout (Phases 0–1 only)

```
project-planner/
  .github/workflows/deploy.yml   typecheck → test → build → deploy-pages (G10)
  .gitignore                     node_modules, dist, test-vault/, sandbox-clone/
  index.html                     CSP <meta> first in <head> (B11)
  vite.config.ts                 base '/project-planner/', preact, PWA manifest
  public/icons/                  192 and 512 px icons (B1)
  docs/                          blueprint, verification, trial, this plan
  src/
    main.tsx                     frame check (refuse if framed) → mount App
    core/                        no browser or UI imports; runs in Node
      types.ts
      frontmatter.ts             split file ↔ {yaml Document, body}; stringify options
      parse.ts                   file → PlannerNode | Person | TagList | OtherNote
      serialize.ts               apply field edits to a Document; new-node template
      slug.ts                    kebab-case; repo-wide uniqueness with -2, -3 …
      graph.ts                   indices; derived children and `blocks`; incremental update
      rollup.ts                  progress, derived blocked, overdue
      validate.ts                nine keys, no title:, bare-stem links resolve, hierarchy rules, cycles
      ops.ts                     Op kinds, apply to files, three-way field check
      status.ts                  stored ↔ label mapping (blueprint §4.3)
      tags.ts                    parse the Vocabulary table in _<domain>-tags.md
    store/
      db.ts                      IndexedDB wrapper: files, queue, meta, settings, secrets
    sync/
      github.ts                  the 6 endpoints only; ETag cache; retry-after
      engine.ts                  pull, rebase, push, retry; state machine
      triggers.ts                start, visible, online, 30 s timer while visible, after-edit debounce
    ui/
      App.tsx                    routes: Setup | Planner
      Setup.tsx                  owner/repo/branch, token, token expiry date, device label
      StatusBar.tsx              sync state, unsynced count, last sync, token-expiry warning
      ListView.tsx               tree table, collapse, sort, status/domain filters
      QuickAdd.tsx
      Inspector.tsx              side panel ≥ 900 px, bottom sheet below
      Pickers.tsx                person, tag, parent, node-link pickers
      ConflictDialog.tsx
      Settings.tsx               forget token and local data
      theme.css                  palette tokens (blueprint §9.3)
  tests/
    fixtures/                    synthetic notes in the v0.2 shape
    fake-github.ts               in-memory git object store serving the 6 endpoints
    core/*.test.ts  sync/*.test.ts  store/*.test.ts
```

---

## 5. Key types (sketch)

```ts
// core/types.ts
type Domain = 'necromunda' | 'cintoo' | 'code' | 'system';
type PlannerType = 'project' | 'subproject' | 'task';
type StoredStatus = 'idea' | 'active' | 'on-hold' | 'done' | 'archived';
type Stem = string;                  // file name without .md, repo-unique for planner files

interface RepoFile { path: string; sha: string; content: string }   // sha = git blob SHA (G4)

interface PlannerNode {
  id: string;                        // planner_id (ULID)
  path: string; stem: Stem;
  title: string;                     // aliases[0] ?? stem
  plannerType: PlannerType;
  domain: Domain; status: StoredStatus;
  parent: Stem | null;               // from "[[stem]]"
  priority: 'low' | 'medium' | 'high';
  owner: Stem | null; people: Stem[];
  tags: string[]; start: string | null; due: string | null;   // YYYY-MM-DD strings (L4)
  blockedBy: Stem[]; relates: Stem[]; references: Stem[]; drive: string[];
  created: string; updated: string;
  body: string;
  problems: Problem[];               // validation findings; conflict markers → readOnly
  readOnly: boolean;
}

interface Person { stem: Stem; path: string; name: string; domain: Domain }
interface TagList { domain: Domain; path: string; tags: string[] }

interface Graph {
  nodes: Map<string, PlannerNode>;             // by id
  byStem: Map<Stem, string>;                   // stem → id
  children: Map<string, string[]>;             // derived
  blocks: Map<string, string[]>;               // derived from blockedBy
  people: Map<Stem, Person>; tags: Map<Domain, TagList>;
  allStems: Set<Stem>;                         // every .md in the repo, for link checks
}

type Field = keyof Pick<PlannerNode, 'title' | 'status' | 'parent' | 'priority' | 'owner'
  | 'people' | 'tags' | 'start' | 'due' | 'blockedBy' | 'relates' | 'references' | 'drive'>;

type Op =
  | { kind: 'set'; nodeId: string; field: Field; from: unknown; to: unknown }
  | { kind: 'body'; nodeId: string; from: string; to: string }
  | { kind: 'create'; node: NewNode; path: string }       // path fixed at creation
  | { kind: 'createPerson'; person: NewPerson; path: string }
  | { kind: 'addTag'; domain: Domain; tag: string; meaning: string };

interface QueuedOp { opId: string; batchId: string; op: Op; at: string; device: string }

interface Conflict { opId: string; nodeId: string; field: Field | 'body' | 'deleted';
  base: unknown; mine: unknown; theirs: unknown }

type SyncState =
  | { s: 'idle'; lastSync: string | null }
  | { s: 'pulling' | 'pushing' }
  | { s: 'offline'; since: string }
  | { s: 'conflicts'; items: Conflict[] }
  | { s: 'error'; message: string; retryAt?: string };
```

---

## 6. How the hard parts work

**Parse and serialize.** Frontmatter is parsed into a `yaml` Document with the default 1.2 schema. Edits call `doc.set` / `doc.setIn` and write out with `toString({ flowCollectionPadding: false })`. `updated` is set to today only when it differs. New nodes are written from a fixed key order (blueprint §4.2) with empty values present. The test on a synthetic file asserts that one field change produces a one-line diff.

**Uniqueness and links.** Slugs are checked against `allStems`, every `.md` in the repo, not only planner files. Links are written as `"[[stem]]"`. `validate.ts` mirrors `vault-check.sh` check 3 (nine keys, no `title:`) and check 4 (every `[[x]]` resolves to a stem). An op that would produce an invalid file is refused before it is queued.

**Ops, not file diffs.** Every UI action produces ops sharing one `batchId`. The ops are applied locally at once (optimistic) and stored in `queue`. On sync, `engine.ts`:

1. Checks the ref with `If-None-Match` (G8). On a 304, skip to step 4.
2. Fetches the tree (G2); if it is truncated, walks sub-trees. Fetches only changed blobs, raw (G3).
3. Re-parses the changed files and updates the graph incrementally.
4. Rebases the queue in order. `set`: remote value equals `from` → apply; equals `to` → drop; otherwise → conflict. `create`: path now taken → re-slug. `body`: the remote body must equal `from`, otherwise conflict (no line-level merging of bodies in v1).
5. If any changes remain: one tree with inline contents, one commit, one ref PATCH `force: false` (G5). 409 or 422 → back to 1, with backoff, up to 5 times. 403/429 → wait for `retry-after`.
6. On success: advance `meta.lastSync`, clear the pushed ops, refresh the base versions.

Conflicted ops stay in the queue, flagged, while the rest sync. The conflict dialog resolves each one to mine, theirs or an edited value, which becomes a fresh `set` op.

**Durability.** The queue is written to IndexedDB **before** the UI shows the edit as saved, and again on `visibilitychange → hidden` (B7). `persist()` is called once after setup and its result shown in Settings (B4).

**Token expiry.** Setup asks for the expiry date shown when the token was made, and the status bar warns 14 days before. *To verify in Phase 0:* whether GitHub returns the token's expiry in a response header. If it does, the date is read automatically instead.

---

## 7. Sandbox seed data (shown to Heyns before any push)

A small copy of the vault's shape, synthetic content only:

```
_vault-guide.md                       copy of the guide (for reference; no private content)
00-System/Tools/vault-check.sh        copy, to run checks 3 and 4 against the sandbox
01-Necromunda/_necromunda-tags.md     vocabulary table with 2 tags
01-Necromunda/07-planner/             necromunda (project) → fiddlestix (subproject)
                                      → test-1, test-2 (tasks), test-3 (sub-task of test-2)
02-Cintoo/_cintoo-tags.md
02-Cintoo/06-people/heyns.md          type: person
02-Cintoo/07-planner/                 q4-sourcing (project) → confirm-freight-quote (task)
                                      blocked_by: "[[test-1]]"   ← cross-domain link test
03-Code/_code-tags.md
03-Code/04-resources/some-reference.md   an ordinary note, for `references`
```

Every file passes checks 3 and 4 before it is pushed. `_vault-guide.md` is copied only if Heyns agrees; the sandbox is private, but it is still a second copy.

---

## 8. Testing

**Automated (every push, in CI):**
- `core`: parse and serialize round-trips (a one-field edit is a one-line diff; dates stay strings; key order kept), slug uniqueness, graph derivation (children, `blocks`), roll-up (archived excluded, derived blocked, overdue), hierarchy rules and cycle rejection, conformance with checks 3 and 4, and tag-table parsing.
- `sync` against `fake-github.ts` (implements G1–G5 and G8: ETag/304, `truncated`, 409/422 on a non-fast-forward, 429 with `retry-after`):
  1. Offline edits to **different fields** of one node on two devices → both land, no conflict.
  2. **Same field**, different values → one conflict, everything else pushed.
  3. Edit against a **remote delete** → conflict.
  4. **Push race**: the ref moves between commit and PATCH → retry succeeds, one commit.
  5. **External edit** (simulated Claude or hand edit) to another field → rebased cleanly.
  6. **Create collision**: the same slug created on two devices → second re-slugged, both kept.
  7. **Restart mid-queue**: the queue survives, then syncs.
  8. **Rate limit**: 429 → waits, then succeeds.
- `store` with `fake-indexeddb`: schema, queue ordering, forget-all.

**Manual on the laptop (Chrome), end of Phase 0 and Phase 1:**
- Install from the Pages URL, enter the sandbox token, see the node count.
- DevTools → Network → Offline, then reload: the app opens with its data.
- Phase 1: create and edit through the UI, then `git pull` a local `sandbox-clone/` (gitignored), run `vault-check.sh` (checks 3 and 4; check 8 is expected to fail outside the real vault) and read `git log -p` to confirm one line per field change.
- **Two-device test on one machine:** two Chrome profiles act as two devices, both offline, then reconnect.

**Manual on the S23 (Chrome), end of Phase 0 and Phase 1:**
- Open the Pages URL, Install, enter the token from your password manager.
- Airplane mode → open the app → data shown → make edits → close → reopen (queue kept) → airplane mode off → synced, commit visible on GitHub.
- **Phone vs laptop:** edit the same node on both while the phone is offline, one different field and one same field → one clean merge and one conflict dialog.
- Portrait and landscape; touch targets at least 44 px; the Inspector bottom sheet is usable one-handed.
- The Android back gesture is **not** tested until Phase 2, because there is no drill-in yet.

---

## 9. Build order and checkpoints

| Step | Delivers | Needs from Heyns | Checkpoint |
|---|---|---|---|
| 0a | Scaffold, `core/types.ts`, CI workflow, theme tokens, a blank installable shell | Create `project-planner` (public, empty). Set Pages → Source: **GitHub Actions**. Approve the first push | — |
| 0b | Setup screen, `github.ts` (pull only), `db.ts`, node count, offline shell | Sandbox repo + token. Approve the seed content (§7) | **✔ Phase 0 acceptance** on laptop and S23 |
| 1a | `core/`: parse, serialize, slug, graph, rollup, validate, status, tags, with tests | — | — |
| 1b | `ops.ts`, queue in `db.ts`, optimistic apply | — | — |
| 1c | `engine.ts` push/rebase/retry + all 8 sync scenarios green | — | **✔ Show test results** before any UI writes |
| 1d | ListView, QuickAdd, Inspector, pickers, StatusBar | — | — |
| 1e | ConflictDialog, token-expiry warning, Settings (forget) | — | — |
| 1f | Acceptance run: laptop, two profiles, S23 | ~30 min on the phone | **✔ Phase 1 acceptance** against blueprint §11; list anything not met, then stop |

Nothing is written to `Heyns-h/Vault` in either phase.

---

## 10. Risks and unknowns

| Item | Handling |
|---|---|
| The error returned for a non-fast-forward is undocumented (G5a) | Treat 409 and 422 alike; the push-race test and the first real race in the sandbox confirm it |
| `X-GitHub-Api-Version` value (G12) | Confirmed from the reference when writing `github.ts`; fall back to omitting the header |
| Token expiry header | Checked in 0b; the typed-in date is the fallback |
| Eviction of local data (B4) | Unsynced count always visible; sync soon after edits |
| Body conflicts are all-or-nothing | Acceptable for v1; line-level body merging may come later |
| Desktop Node version | Heyns checks at home; only matters for developing there |
| Pages URL is public | Anyone can load the app, but it holds no data. It needs a token to see anything |
