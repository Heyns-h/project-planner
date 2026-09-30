# Project Planner

An installable, offline-first planner for projects, sub-projects and tasks. Every item is a markdown note in a private git repo; the app reads and writes it through GitHub's API and keeps working offline, syncing when the connection returns.

This repo holds only the app. It contains no planner data, and needs a GitHub token (entered per device, stored only in that browser) to see any. Which domains (top-level areas) a repo has is configuration, not code.

## Develop

Requires Node 22.12 or later.

```bash
npm install
npm run dev        # dev server
npm test           # unit tests
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173/project-planner/
```

Pushes to `main` run typecheck, tests and build, then deploy to GitHub Pages.
