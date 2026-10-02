import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/core/graph';
import { layout, typesBelow } from '../../src/core/layout';
import { computeRollups } from '../../src/core/rollup';
import { allowedParent } from '../../src/core/validate';
import { DOMAINS, indexPaths, nodeText, repoFiles, TODAY } from '../fixtures/repo';

// Decision 16 (2026-10-02): sub-tasks under tasks; bubbles list what is
// beneath them by type, only the types below their own.

const A = '01-Alpha/07-planner/';

describe('sub-tasks', () => {
  it('parse accepts planner_type subtask and the hierarchy rules place it under a task', () => {
    const g = buildGraph(
      repoFiles({
        [A + 'prime.md']: nodeText({ id: 'S1', type: 'subtask', title: 'Prime', domain: 'alpha', parent: 'paint-gangers', status: 'done' }),
        [A + 'stray.md']: nodeText({ id: 'S2', type: 'subtask', title: 'Stray', domain: 'alpha', parent: 'hive' }),
      }),
      indexPaths(),
      DOMAINS,
    );
    expect(g.nodes.get('S1')?.plannerType).toBe('subtask');
    expect(g.nodes.get('S1')?.problems).toEqual([]);
    expect(g.nodes.get('S2')?.problems.map((p) => p.message)).toEqual(['A sub-task should sit under a task']);
    expect(allowedParent('task', 'subtask')).toMatch(/should not sit under a sub-task/);
    expect(allowedParent('subtask', 'task')).toBeNull();
  });

  it('counts sub-tasks like tasks in progress and the ring', () => {
    const g = buildGraph(
      repoFiles({
        [A + 'prime.md']: nodeText({ id: 'S1', type: 'subtask', title: 'Prime', domain: 'alpha', parent: 'paint-gangers', status: 'done' }),
        [A + 'wash.md']: nodeText({ id: 'S2', type: 'subtask', title: 'Wash', domain: 'alpha', parent: 'paint-gangers' }),
      }),
      indexPaths(),
      DOMAINS,
    );
    const r = computeRollups(g, TODAY);
    expect(r.get('N3')).toMatchObject({ done: 1, total: 2, percent: 50 }); // paint gangers rolls up its sub-tasks
    expect(r.get('N1')).toMatchObject({ done: 2, total: 5 }); // campaign: 3 tasks + 2 sub-tasks
    const l = layout(g, r, null, 800, 600, TODAY);
    const campaign = l.nodes.find((n) => n.node.id === 'N1')!;
    expect(campaign.below).toEqual({ project: 0, subproject: 1, task: 3, subtask: 2 });
    expect(campaign.ring?.total).toBe(5);
  });

  it('lists only the types below a bubble’s own type', () => {
    expect(typesBelow('project')).toEqual(['subproject', 'task', 'subtask']);
    expect(typesBelow('subproject')).toEqual(['task', 'subtask']);
    expect(typesBelow('task')).toEqual(['subtask']);
    expect(typesBelow('subtask')).toEqual([]);
  });
});
