import { nodeText } from './repo';

// A 300-node synthetic tree for layout and performance checks: 12 projects,
// each with 4 workstreams of 5 tasks (12 + 48 + 240). Generic names only.
// Also used to seed the preview's IndexedDB for the Chrome Performance profile.

const STATUSES = ['active', 'idea', 'done', 'active', 'on-hold'] as const;

export function bigFiles(projects = 12, subs = 4, tasks = 5): Record<string, string> {
  const out: Record<string, string> = {};
  for (let p = 1; p <= projects; p++) {
    const domain = p % 2 ? 'alpha' : 'beta';
    const folder = p % 2 ? '01-Alpha/07-planner/' : '02-Beta/07-planner/';
    const pStem = `big-p${p}`;
    // Every sixth project is finished, to exercise the dim/floor path.
    out[`${folder}${pStem}.md`] = nodeText({ id: `B${p}`, type: 'project', title: `Project ${p}`, domain, status: p % 6 === 0 ? 'done' : 'active' });
    for (let s = 1; s <= subs; s++) {
      const sStem = `${pStem}-s${s}`;
      out[`${folder}${sStem}.md`] = nodeText({ id: `B${p}-${s}`, type: 'subproject', title: `Workstream ${p}.${s}`, domain, parent: pStem });
      for (let t = 1; t <= tasks; t++) {
        const status = p % 6 === 0 ? 'done' : STATUSES[(p + s + t) % STATUSES.length]!;
        out[`${folder}${sStem}-t${t}.md`] = nodeText({
          id: `B${p}-${s}-${t}`,
          type: 'task',
          title: `Task ${p}.${s}.${t}`,
          domain,
          parent: sStem,
          status,
          ...(t === 1 ? { due: '2026-10-20' } : {}),
        });
      }
    }
  }
  return out;
}
