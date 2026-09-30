import type { DomainDef, RepoFile } from '../../src/core/types';

// Synthetic repo in the v0.2 shape. Generic domain names only: this repo is public.

export const DOMAINS: DomainDef[] = [
  { id: 'alpha', folder: '01-Alpha', label: 'Alpha' },
  { id: 'beta', folder: '02-Beta', label: 'Beta' },
];

export const TODAY = '2026-10-01';

interface N {
  id: string;
  type: 'project' | 'subproject' | 'task';
  title: string;
  domain: string;
  status?: string;
  parent?: string;
  owner?: string;
  due?: string;
  blockedBy?: string[];
  references?: string[];
  tags?: string[];
}

export function nodeText(n: N): string {
  const link = (s?: string) => (s ? `"[[${s}]]"` : '""');
  const links = (l?: string[]) => `[${(l ?? []).map((s) => `"[[${s}]]"`).join(', ')}]`;
  return `---
type: ${n.type === 'project' ? 'project' : 'note'}
domain: ${n.domain}
project: ""
version: ""
status: ${n.status ?? 'active'}
tags: [${(n.tags ?? []).join(', ')}]
created: 2026-09-30
updated: 2026-09-30
aliases:
  - ${n.title}
planner_id: ${n.id}
planner_type: ${n.type}
parent: ${link(n.parent)}
priority: medium
owner: ${link(n.owner)}
people: []
start: 2026-09-30
due: ${n.due ?? '""'}
blocked_by: ${links(n.blockedBy)}
relates: []
references: ${links(n.references)}
drive: []
---
`;
}

const A = '01-Alpha/07-planner/';
const B = '02-Beta/07-planner/';

export const FILES: Record<string, string> = {
  [A + 'campaign.md']: nodeText({ id: 'N1', type: 'project', title: 'Campaign', domain: 'alpha', owner: 'someone' }),
  [A + 'hive.md']: nodeText({ id: 'N2', type: 'subproject', title: 'Hive', domain: 'alpha', parent: 'campaign' }),
  [A + 'paint-gangers.md']: nodeText({ id: 'N3', type: 'task', title: 'Paint gangers', domain: 'alpha', parent: 'hive', due: '2026-10-10', tags: ['painting'] }),
  [A + 'build-terrain.md']: nodeText({ id: 'N4', type: 'task', title: 'Build terrain', domain: 'alpha', parent: 'hive', status: 'idea' }),
  [A + 'buy-glue.md']: nodeText({ id: 'N5', type: 'task', title: 'Buy glue', domain: 'alpha', parent: 'build-terrain', status: 'done' }),
  [B + 'q4-sourcing.md']: nodeText({ id: 'N6', type: 'project', title: 'Q4 sourcing', domain: 'beta', owner: 'someone' }),
  [B + 'confirm-quote.md']: nodeText({
    id: 'N7',
    type: 'task',
    title: 'Confirm quote',
    domain: 'beta',
    parent: 'q4-sourcing',
    status: 'active',
    due: '2026-09-20', // before TODAY → overdue
    blockedBy: ['paint-gangers'], // cross-domain
    references: ['some-reference'],
  }),
  '02-Beta/06-people/someone.md': `---
type: person
domain: beta
project: ""
version: ""
status: active
tags: []
created: 2026-09-30
updated: 2026-09-30
aliases:
  - Someone
---
`,
  '01-Alpha/_alpha-tags.md': `---
type: reference
domain: alpha
project: ""
version: ""
status: active
tags: []
created: 2026-09-30
updated: 2026-09-30
aliases: []
---

## Vocabulary

| Tag | Means | Added |
| --- | --- | --- |
| \`painting\` | Painting | 2026-09-30 |
| \`terrain\` | Terrain | 2026-09-30 |

## Related
`,
};

/** Names of ordinary notes present in the repo but not downloaded. */
export const INDEX_ONLY = ['03-Gamma/04-resources/some-reference.md', 'README.md'];

export function repoFiles(extra: Record<string, string> = {}): RepoFile[] {
  return Object.entries({ ...FILES, ...extra }).map(([path, content]) => ({ path, sha: 'x', content }));
}

export function indexPaths(extra: Record<string, string> = {}): string[] {
  return [...Object.keys({ ...FILES, ...extra }), ...INDEX_ONLY];
}
