# project-planner

An offline-first planner web app whose data is markdown notes in a private git repository, read and written through GitHub's API. Done looks like: the app is installed on every device, works offline, and syncs cleanly when the connection returns.

Notes go in notes/ with the four-key frontmatter. Working files go in the Drive folder linked from README.md, never in this repository. Open sessions here, not at the home vault.

Toolchain: Node 22.12 or later, Vite, Vitest; `npm run build` typechecks and builds, and a push to `main` deploys to GitHub Pages. `docs/`, `test-vault/` and `sandbox-clone/` are local-only and ignored; the sandbox data repository is `Heyns-h/planner-sandbox`. The app's own icons under `public/icons/` are source and stay tracked.
