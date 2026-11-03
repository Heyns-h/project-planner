---
type: reference
status: done
created: 2026-09-30
updated: 2026-10-01
---

> [!note] Blueprint v0.2 — verification record
> Moved from the app repo's `docs/` on 2026-09-30. The app repo is public; these notes stay private here.

Checked 2026-09-30 against official documentation (docs.github.com, git-scm.com, MDN, web.dev, developer.chrome.com, library docs and the npm registry). Status is **Confirmed**, **Changed** (the blueprint's assumption was wrong or out of date, and the correction is given), **Partial** (only part could be confirmed), or **Not found** (no official source; do not rely on it).

## GitHub

| # | Item | Status | Finding | Source |
|---|---|---|---|---|
| G1 | Read branch ref | Confirmed | `GET /repos/{o}/{r}/git/ref/heads/main` → `object.sha` | docs.github.com/en/rest/git/refs |
| G2 | Recursive tree | Confirmed | `GET …/git/trees/{sha}?recursive=1`, with a `truncated` flag. The limit is 100,000 entries or 7 MB; past that, fetch sub-trees one at a time without `recursive` | docs.github.com/en/rest/git/trees |
| G3 | Read blob | Confirmed | `GET …/git/blobs/{sha}` returns base64. `application/vnd.github.raw+json` returns raw bytes. Blobs up to 100 MB | docs.github.com/en/rest/git/blobs |
| G4 | Blob SHA formula | Confirmed | SHA-1 of `"blob <byte length>\0" + content`. The length is in bytes, not characters | git-scm.com, Git Internals: Git Objects |
| G5 | Write: tree, commit, ref | Confirmed | `POST …/git/trees` with `base_tree`. Each entry may carry inline `content`, so separate blob calls are not needed. `sha: null` deletes a file. `POST …/git/commits` with `parents`. `PATCH …/git/refs/heads/main` with `force: false` | docs.github.com/en/rest/git/{trees,commits,refs} |
| G5a | Error for a non-fast-forward ref update | **Not found** | The docs list only 409 and 422 without saying which applies. The app treats **either as "branch moved": pull, rebase, retry** | docs.github.com/en/rest/git/refs |
| G6 | Token permissions | Confirmed, one caveat | Contents: read covers the reads, Contents: write covers the writes. **Writing under `.github/workflows/` also needs Workflows: write**, so the app never writes there. "Metadata read added automatically" was not found in the docs, although the token form adds it | docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens |
| G7 | Token lifetime | Changed | Expiry can be 1–366 days, or none (allowed on personal accounts). Unused tokens are removed after a year. The limit is 50 fine-grained tokens per account | docs.github.com/en/authentication/…/managing-your-personal-access-tokens |
| G8 | Rate limits | Confirmed | 5,000 requests per hour. **A 304 on a conditional request with a valid `Authorization` header does not count.** Secondary limits: 900 points per minute per endpoint (GET = 1, writes = 5), and **content-creating requests are capped at 80 per minute and 500 per hour**. Over-limit returns 403 or 429 with `retry-after` | docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
| G9 | Calling the API from a browser | Confirmed | Cross-origin requests are allowed from any origin, including the `Authorization` and `If-None-Match` headers. `ETag` and `x-ratelimit-*` are readable | docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests |
| G10 | GitHub Pages | Confirmed | Free for **public** repos. Private repos need **GitHub Pro**, and the site is still public. Deploy with `actions/deploy-pages` (`pages: write`, `id-token: write`) | docs.github.com/en/pages |
| G11 | Tokens in browser storage | Not found | No guidance specific to browsers. General advice only: treat tokens like passwords, least privilege, short expiry, a plan to revoke them | docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure |
| G12 | API version header | Not checked by us; reported by the verifier | The reference now shows `X-GitHub-Api-Version: 2026-03-10`. Confirm when writing `github.ts` | docs.github.com/en/rest |

## Browser and installable app

| # | Item | Status | Finding | Source |
|---|---|---|---|---|
| B1 | Install criteria | Changed | Manifest with `name`/`short_name`, 192 px and 512 px icons, `start_url`, and `display: standalone`, over HTTPS, plus user engagement. **A service worker is no longer required to install**, but it is still what makes the app open offline | web.dev/articles/install-criteria |
| B2 | App shell caching | Confirmed | Cache API in the service worker. Workbox v7.4.1, now maintained by Chrome's Aurora team | MDN Cache, developer.chrome.com/docs/workbox |
| B3 | IndexedDB and quota | Confirmed | Available in pages and workers. Chrome allows up to 60% of disk per origin. Check with `navigator.storage.estimate()` | MDN Storage quotas |
| B4 | `navigator.storage.persist()` | Changed | **No prompt. Chrome decides silently** (engagement, installed). It is not guaranteed even when installed. Eviction wipes IndexedDB and the Cache API together | web.dev/articles/persistent-storage |
| B5 | Background Sync | Confirmed, Chromium-only | `registration.sync.register()` works in Chrome and Edge. Periodic sync needs the app installed and Chrome controls the timing. Not in Firefox or Safari | MDN Background Synchronization API |
| B6 | `online` / `offline` | Confirmed, with caveats | `navigator.onLine` is only a hint. Whether you are online is decided by whether the fetch works | MDN Navigator.onLine |
| B7 | `visibilitychange` | Confirmed | The change to `hidden` is the last event you can rely on, so save the queue then | MDN visibilitychange |
| B8 | `navigator.vibrate()` | Confirmed | Android Chrome yes, Safari no. Needs a prior user gesture. Silent mode may suppress it | MDN Navigator.vibrate |
| B9 | Android back gesture in an installed app | **Partial** | No official guidance. History entries pushed **without a user gesture are skipped**, and if all are skipped, back closes the app. Only push entries from user actions. Must be tested on the S23 | chromium.googlesource.com/…/history_manipulation_intervention.md |
| B10 | Custom gestures | Confirmed | Pointer Events plus `touch-action: none` on the gesture surface | MDN touch-action, Pinch zoom gestures |
| B11 | CSP in `<meta>` | Confirmed | `script-src 'self'` and `connect-src https://api.github.com` work in a meta tag. **`frame-ancestors`, `sandbox` and reporting do not** | MDN CSP guide |
| B12 | Custom headers on GitHub Pages | Not found (i.e. not possible) | Not documented as possible on github.com; available only on Enterprise Server | GitHub community discussion 54257 |

## Libraries

| # | Item | Status | Version / licence | Finding |
|---|---|---|---|---|
| L1 | d3-hierarchy | Confirmed | 3.1.2, ISC | `hierarchy().sum()` (required before pack), `.sort()`, `pack().size().padding()`, then `x`, `y`, `r` |
| L2 | d3-zoom | Confirmed, with an important detail | 3.0.0, ISC | Pinch and double-tap are built in. It uses mouse and touch events, not Pointer Events, and **calls `stopImmediatePropagation()` on events it consumes**. Node long-press and drag must be excluded through `zoom.filter` (or have listeners registered first) |
| L3 | d3-selection / d3-transition | Confirmed | 3.0.0 / 3.0.1 | `.transition().duration(150)` |
| L4 | yaml (eemeli) | Confirmed, with one setting | 2.9.1, ISC | Round-trip tested on a v0.2 node: changing `status` changes **only that line**, **provided `toString({ flowCollectionPadding: false })` is used**. Without it, `[a]` becomes `[ a ]`. With the default YAML 1.2 schema, dates stay strings. Never use schema `1.1` |
| L5 | ULID | Confirmed | `ulid` 3.0.2, MIT | `ulid()`, `monotonicFactory()`. Uses browser crypto. Preferred over `ulidx` |
| L6 | Fuzzy search | Confirmed, with a limit | uFuzzy 1.0.19, MIT (~7.5 KB); Fuse.js 7.5.0, Apache-2.0 | uFuzzy is fast but built for short phrases. Neither publishes a benchmark for 1,000 notes with bodies |
| L7 | Preact | **Changed** | **11.0.0 released 2026-09-30**; 10.29.8 is the last 10.x; MIT | The Vite plugin is **`@preact/preset-vite`** 2.10.6. v11 is ESM-only and changes `useRef` typing and `useEffect` cleanup timing. d3 is integrated through `useRef` + `useEffect` (refs guide) |
| L8 | Vite / PWA plugin | Confirmed | vite 8.3.1; vite-plugin-pwa 1.3.0 (Workbox 7.4.1) | `generateSW` or `injectManifest`; `registerType: 'prompt'` or `'autoUpdate'` |
| L9 | Vitest / fake-indexeddb | Confirmed | vitest 5.0.2 (**Node ≥ 22.12**); fake-indexeddb 6.2.5 | The laptop has Node 24.19. **The desktop is unchecked** |
| L10 | Obsidian URI | Confirmed (Android implied) | — | `obsidian://open?vault=…&file=…`, every value `encodeURIComponent`-encoded (so `/` becomes `%2F`). The help pages moved to obsidian.md/help |
| L11 | d3-zoom event handling (added 2026-10-01 for Phase 2) | Confirmed | 3.0.0; @types 3.0.9 | From d3js.org/d3-zoom: listens to `mousedown`/`dblclick`/`wheel`/`touchstart`/`touchmove`/`touchend`/`touchcancel` on the selection and `mousemove`/`mouseup`/`click` on the window; "the propagation of all consumed events is immediately stopped". `clickDistance` default **0** (any movement suppresses the following click). `dblclick` and double-tap start a 250 ms zoom transition by default — remove with `.on('dblclick.zoom', null)` to use double-click for drill-in. Default `filter` ignores secondary buttons and ctrl+non-wheel. `scaleExtent` default `[0, ∞]`. `zoom.transform(selection, t)` applies instantly; with a transition it needs d3-transition. Touch listeners are only registered where `navigator.maxTouchPoints` or `ontouchstart` is truthy |
| L12 | d3-hierarchy pack (added 2026-10-01) | Confirmed | 3.1.2; @types 3.1.7 | From d3js.org/d3-hierarchy: `root.sum()` must be called before `pack(root)`; recommended `sort((a, b) => b.value - a.value)`; `pack.size()` default `[1, 1]`; `pack.radius` null → leaf radius from `value`, scaled to fit; `pack.padding` constant or function, approximate when radius is derived; output `x`, `y` (centre) and `r`. No DOM dependency, so it runs in Vitest on Node |
| L13 | d3-selection types | Confirmed | 3.0.0; @types 3.0.12 | Needed only to attach the zoom behaviour (`select(svg).call(zoom)`). Versions checked on the npm registry 2026-10-01 |

## Design consequences (applied to blueprint v0.2)

1. **A push is three write requests**: create a tree with inline contents, create a commit, update the ref. That fits comfortably under 80 per minute and 500 per hour. Queued edits are batched per push, not one commit per keystroke.
2. **409 or 422 on the ref update means the branch moved**: pull, rebase the queue, retry with backoff.
3. **The app never writes under `.github/`.**
4. **Polling uses `If-None-Match` on the ref**, so an unchanged branch costs nothing against the hourly limit.
5. **Local data may be evicted**, and `persist()` is only a request. The UI shows the unsynced count at all times, sync runs as soon as possible after edits, and the queue is flushed on `visibilitychange → hidden`. GitHub is the durable copy.
6. **Background Sync is an optional extra only.** The main triggers are app start, returning to the foreground, the `online` event, the timer, and after edits.
7. **Android back**: only push history entries in response to user actions. Must be tested on the S23 in Phase 2.
8. **Bubble view gestures**: `touch-action: none` on the SVG. d3-zoom's `filter` excludes node targets, so long-press and drag on nodes work.
9. **CSP goes in a `<meta>` tag** because GitHub Pages cannot set headers. Framing cannot be blocked by `frame-ancestors`, so the app refuses to run (and never asks for the token) when `window.top !== window.self`.
10. **Frontmatter writer**: the `yaml` Document API, default schema, `flowCollectionPadding: false`. No custom line editor needed. A round-trip test on the real vault notes goes in the unit tests.
11. **Search**: uFuzzy over titles, aliases and linked-note titles, plus a plain case-insensitive substring scan over bodies. Benchmarked at 1,000 nodes in Phase 3.
12. **Preact 10.29.x is pinned** for stability. Move to 11 in a later polish pass, once its 11.x line has had point releases. Confirmed by Heyns 2026-09-30.
13. **Token expiry**: 90 days (confirmed by Heyns 2026-09-30), with the app warning 14 days ahead. A non-expiring token is possible but not recommended for a token that sits in a browser.
14. **Node ≥ 22.12** is required for development (Vitest 5). The laptop is fine; the desktop needs checking before development happens there.
