import { describe, expect, it } from 'vitest';
import { ancestors, buildGraph, childrenOf, descendants, nodeByStem, roots } from '../../src/core/graph';
import { formatLink, parseLink, parseLinkList } from '../../src/core/links';
import { parseNode } from '../../src/core/parse';
import { computeRollups } from '../../src/core/rollup';
import { slugify, uniqueStem } from '../../src/core/slug';
import { parseTagTable } from '../../src/core/tags';
import { wouldCycle } from '../../src/core/validate';
import { DOMAINS, FILES, indexPaths, nodeText, repoFiles, TODAY } from '../fixtures/repo';

const graph = (extra: Record<string, string> = {}) => buildGraph(repoFiles(extra), indexPaths(extra), DOMAINS);
const node = (g: ReturnType<typeof graph>, stem: string) => {
  const n = nodeByStem(g, stem);
  if (!n) throw new Error(`no node ${stem}`);
  return n;
};

describe('links', () => {
  it('reads bare stems, aliases, headings and hand-typed paths', () => {
    expect(parseLink('[[place-po]]')).toBe('place-po');
    expect(parseLink('[[place-po|Place PO]]')).toBe('place-po');
    expect(parseLink('[[place-po#Notes]]')).toBe('place-po');
    expect(parseLink('[[Projects/X/_tasks/test-3|test 3]]')).toBe('test-3');
    expect(parseLink('place-po')).toBeNull();
    expect(parseLinkList(['[[a]]', 'b', '[[c]]'])).toEqual({ stems: ['a', 'c'], bad: ['b'] });
    expect(formatLink('a')).toBe('[[a]]');
  });
});

describe('slugs', () => {
  it('are kebab-case ASCII', () => {
    expect(slugify('Confirm freight quote')).toBe('confirm-freight-quote');
    expect(slugify('Café & Crème — Q4!')).toBe('cafe-and-creme-q4');
    expect(slugify('   ')).toBe('untitled');
  });

  it('are unique against every note in the repo, not only planner files', () => {
    const taken = new Set(['some-reference', 'task', 'task-2']);
    expect(uniqueStem('Some reference', taken)).toBe('some-reference-2');
    expect(uniqueStem('Task', taken)).toBe('task-3');
    expect(uniqueStem('Fresh', taken)).toBe('fresh');
  });
});

describe('tag lists', () => {
  it('read the Vocabulary table, ignoring placeholders and other sections', () => {
    expect(parseTagTable('## Vocabulary\n\n| Tag | M |\n|---|---|\n| `a` | x |\n| — | — |\n| `b` | y |\n\n## Related\n| `c` | z |')).toEqual(['a', 'b']);
    expect(parseTagTable('no table')).toEqual([]);
  });
});

describe('parse', () => {
  it('reads a v0.2 node with no problems', () => {
    const n = parseNode({ path: '02-Beta/07-planner/confirm-quote.md', sha: 'x', content: FILES['02-Beta/07-planner/confirm-quote.md']! }, DOMAINS)!;
    expect(n).toMatchObject({
      id: 'N7',
      stem: 'confirm-quote',
      title: 'Confirm quote',
      plannerType: 'task',
      domain: 'beta',
      status: 'active',
      parent: 'q4-sourcing',
      due: '2026-09-20',
      blockedBy: ['paint-gangers'],
      references: ['some-reference'],
      readOnly: false,
    });
    expect(n.problems).toEqual([]);
  });

  it('flags missing guide keys, a title: key and dotpm-style values', () => {
    const content = '---\nplanner_id: X\ntitle: Old\nstatus: todo\nplanner_type: subtask\n---\n';
    const n = parseNode({ path: '01-Alpha/07-planner/old.md', sha: 'x', content }, DOMAINS)!;
    const codes = n.problems.map((p) => `${p.code}:${p.field ?? ''}`);
    expect(codes).toContain('missing-key:aliases');
    expect(codes).toContain('title-key:title');
    expect(codes).toContain('bad-value:status');
    expect(codes).toContain('bad-value:planner_type');
    expect(n.domain).toBe('alpha'); // falls back to the folder's domain
    expect(n.readOnly).toBe(false); // warnings only
  });

  it('makes files with conflict markers read-only', () => {
    const content = FILES['01-Alpha/07-planner/hive.md'] + '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n';
    const n = parseNode({ path: '01-Alpha/07-planner/hive.md', sha: 'x', content }, DOMAINS)!;
    expect(n.readOnly).toBe(true);
  });
});

describe('graph', () => {
  const g = graph();

  it('derives children and roots from parent (stored once, on the child)', () => {
    expect(roots(g).map((n) => n.stem)).toEqual(['campaign', 'q4-sourcing']);
    expect(childrenOf(g, 'N2').map((n) => n.stem)).toEqual(['build-terrain', 'paint-gangers']);
    expect(ancestors(g, 'N5').map((n) => n.stem)).toEqual(['build-terrain', 'hive', 'campaign']);
    expect(descendants(g, 'N1').length).toBe(4);
  });

  it('derives blocks across domains from blocked_by', () => {
    expect(g.blocks.get('N3')).toEqual(['N7']);
  });

  it('loads people and tag lists', () => {
    expect(g.people.get('someone')?.name).toBe('Someone');
    expect(g.tags.get('alpha')?.tags).toEqual(['painting', 'terrain']);
  });

  it('resolves links against every note name, including notes not downloaded', () => {
    expect(node(g, 'confirm-quote').problems).toEqual([]);
    const broken = graph({ '02-Beta/07-planner/x.md': nodeText({ id: 'N9', type: 'task', title: 'X', domain: 'beta', parent: 'q4-sourcing', blockedBy: ['missing-note'] }) });
    expect(node(broken, 'x').problems.map((p) => p.code)).toEqual(['unresolved-link']);
  });

  it('warns on hierarchy rules and detects cycles', () => {
    const bad = graph({
      '01-Alpha/07-planner/sub-under-task.md': nodeText({ id: 'S1', type: 'subproject', title: 'S', domain: 'alpha', parent: 'paint-gangers' }),
      '01-Alpha/07-planner/loop-a.md': nodeText({ id: 'L1', type: 'task', title: 'A', domain: 'alpha', parent: 'loop-b' }),
      '01-Alpha/07-planner/loop-b.md': nodeText({ id: 'L2', type: 'task', title: 'B', domain: 'alpha', parent: 'loop-a' }),
    });
    expect(node(bad, 'sub-under-task').problems.map((p) => p.code)).toContain('hierarchy');
    expect(node(bad, 'loop-a').problems.map((p) => p.code)).toContain('cycle');
    expect(wouldCycle(g, 'N2', 'buy-glue')).toBe(true); // hive under its own grandchild
    expect(wouldCycle(g, 'N5', 'q4-sourcing')).toBe(false);
  });

  it('flags a duplicated planner_id instead of merging the two files', () => {
    const dup = graph({ '01-Alpha/07-planner/copy.md': nodeText({ id: 'N3', type: 'task', title: 'Copy', domain: 'alpha', parent: 'hive' }) });
    const copy = node(dup, 'copy');
    expect(copy.readOnly).toBe(true);
    expect(node(dup, 'paint-gangers').readOnly).toBe(false);
  });
});

describe('roll-up (blueprint §4.6)', () => {
  const g = graph();
  const r = computeRollups(g, TODAY);

  it('counts descendant tasks, archived excluded; a leaf task counts itself', () => {
    // campaign: paint-gangers (active), build-terrain (idea), buy-glue (done) → 1/3
    expect(r.get('N1')).toMatchObject({ done: 1, total: 3, percent: 33 });
    expect(r.get('N5')).toMatchObject({ done: 1, total: 1, percent: 100 });
    const archived = computeRollups(graph({ '01-Alpha/07-planner/old.md': nodeText({ id: 'A1', type: 'task', title: 'Old', domain: 'alpha', parent: 'hive', status: 'archived' }) }), TODAY);
    expect(archived.get('N1')?.total).toBe(3);
  });

  it('shows blocked when waiting on an unfinished task, and propagates upwards', () => {
    expect(r.get('N7')?.blocked).toBe(true);
    expect(r.get('N7')?.waitingOn.map((n) => n.stem)).toEqual(['paint-gangers']);
    expect(r.get('N6')?.blocked).toBe(true); // parent of a blocked child
    expect(r.get('N1')?.blocked).toBe(false);
  });

  it('stops blocking once the dependency is done', () => {
    const done = graph({ '01-Alpha/07-planner/paint-gangers.md': nodeText({ id: 'N3', type: 'task', title: 'Paint gangers', domain: 'alpha', parent: 'hive', status: 'done' }) });
    expect(computeRollups(done, TODAY).get('N7')?.blocked).toBe(false);
  });

  it('marks overdue on the node and every ancestor', () => {
    expect(r.get('N7')?.overdue).toBe(true);
    expect(r.get('N6')?.overdue).toBe(true);
    expect(r.get('N1')?.overdue).toBe(false); // paint-gangers due 10-10, not yet
  });
});
