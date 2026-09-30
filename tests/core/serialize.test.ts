import { describe, expect, it } from 'vitest';
import { GUIDE_KEYS, parseNode } from '../../src/core/parse';
import { buildGraph } from '../../src/core/graph';
import { applyEdits, newNodeContent } from '../../src/core/serialize';
import type { Field } from '../../src/core/types';
import { DOMAINS, FILES, indexPaths, repoFiles } from '../fixtures/repo';

const PATH = '02-Beta/07-planner/confirm-quote.md';
const ORIGINAL = FILES[PATH]!;

/** Lines that differ between two versions of a file, as [before, after]. */
function changed(before: string, after: string): [string, string][] {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b.length).toBe(a.length); // flat keys: an edit never adds or removes lines
  return a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i] ?? '']] as [string, string][]));
}

describe('applyEdits — one field, one line (trial lesson 3)', () => {
  const sameDay = '2026-09-30'; // equals `updated`, so only the field line moves

  const cases: [Field, unknown, string][] = [
    ['status', 'done', 'status: done'],
    ['priority', 'high', 'priority: high'],
    ['parent', 'campaign', 'parent: "[[campaign]]"'],
    ['owner', 'someone', 'owner: "[[someone]]"'],
    ['parent', null, 'parent: ""'],
    ['due', '2026-11-01', 'due: 2026-11-01'],
    ['start', null, 'start: ""'],
    ['blockedBy', ['paint-gangers', 'hive'], 'blocked_by: ["[[paint-gangers]]", "[[hive]]"]'],
    ['blockedBy', [], 'blocked_by: []'],
    ['people', ['someone'], 'people: ["[[someone]]"]'],
    ['tags', ['freight'], 'tags: [freight]'],
    ['drive', ['https://drive.google.com/x'], 'drive: [https://drive.google.com/x]'],
    ['title', 'Confirm the quote', '  - Confirm the quote'],
  ];

  for (const [field, value, expected] of cases) {
    it(`${field} → ${JSON.stringify(value)}`, () => {
      const out = applyEdits(ORIGINAL, [{ field, value }], sameDay);
      const diff = changed(ORIGINAL, out);
      expect(diff.length).toBe(1);
      expect(diff[0]?.[1]).toBe(expected);
    });
  }

  it('moves `updated` on a new day: two lines', () => {
    const out = applyEdits(ORIGINAL, [{ field: 'status', value: 'done' }], '2026-10-02');
    expect(changed(ORIGINAL, out).map(([, b]) => b)).toEqual(['status: done', 'updated: 2026-10-02']);
  });

  it('keeps extra aliases and the body', () => {
    const withAliases = ORIGINAL.replace('aliases:\n  - Confirm quote\n', 'aliases:\n  - Confirm quote\n  - CQ\n') + '\nBody.\n';
    const out = applyEdits(withAliases, [{ field: 'title', value: 'New' }], '2026-09-30');
    expect(out).toContain('aliases:\n  - New\n  - CQ\n');
    expect(out.endsWith('\nBody.\n')).toBe(true);
  });

  it('refuses files it cannot parse safely', () => {
    expect(() => applyEdits('no frontmatter', [{ field: 'status', value: 'done' }], '2026-09-30')).toThrow();
    expect(() => applyEdits(ORIGINAL + '<<<<<<< HEAD\n', [{ field: 'status', value: 'done' }], '2026-09-30')).toThrow();
  });
});

describe('newNodeContent', () => {
  const content = newNodeContent(
    { id: '01TEST', plannerType: 'task', title: 'Order: 12 crates # rush', domain: 'beta', parent: 'q4-sourcing', owner: 'someone', blockedBy: ['paint-gangers'], due: '2026-10-20', body: 'Notes.' },
    '2026-10-01',
  );

  it('writes the guide keys first, then the planner keys, with no title:', () => {
    const keys = content.split('\n').filter((l) => /^[a-z_]+:/.test(l)).map((l) => l.split(':')[0]);
    expect(keys.slice(0, 9)).toEqual([...GUIDE_KEYS]);
    expect(keys).toEqual([...GUIDE_KEYS, 'planner_id', 'planner_type', 'parent', 'priority', 'owner', 'people', 'start', 'due', 'blocked_by', 'relates', 'references', 'drive']);
  });

  it('parses back to the same node with no problems, inside a real graph', () => {
    const path = '02-Beta/07-planner/order-12-crates-rush.md';
    const g = buildGraph(repoFiles({ [path]: content }), indexPaths({ [path]: content }), DOMAINS);
    const n = [...g.nodes.values()].find((x) => x.id === '01TEST')!;
    expect(n).toMatchObject({ title: 'Order: 12 crates # rush', parent: 'q4-sourcing', owner: 'someone', blockedBy: ['paint-gangers'], due: '2026-10-20', status: 'idea', domain: 'beta' });
    expect(n.problems).toEqual([]);
    expect(n.body).toBe('Notes.\n');
    expect(parseNode({ path, sha: 'x', content }, DOMAINS)?.readOnly).toBe(false);
  });

  it('writes type: project only for projects', () => {
    expect(newNodeContent({ id: 'P', plannerType: 'project', title: 'P', domain: 'alpha', parent: null }, '2026-10-01')).toContain('\ntype: project\n');
    expect(content).toContain('\ntype: note\n');
  });
});
