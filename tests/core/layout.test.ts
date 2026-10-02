import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/core/graph';
import { layout, openTasks, timeLeftPercent, type LayoutNode } from '../../src/core/layout';
import { computeRollups } from '../../src/core/rollup';
import { bigFiles } from '../fixtures/big';
import { DOMAINS, indexPaths, nodeText, repoFiles, TODAY } from '../fixtures/repo';

// Plan Phase 2 §6 as revised (decisions 11–12): one level of free-floating
// circles; weights count only open tasks; the floor keeps empty projects
// visible; root switching; archived excluded; sorted by value; everything
// inside the box; each circle summarises what is inside it.

const A = '01-Alpha/07-planner/';
const B = '02-Beta/07-planner/';

function build(extra: Record<string, string> = {}) {
  const g = buildGraph(repoFiles(extra), indexPaths(extra), DOMAINS);
  return { g, rollups: computeRollups(g, TODAY) };
}
const ids = (nodes: LayoutNode[]) => nodes.map((n) => n.node.id);
const node = (l: { nodes: LayoutNode[] }, id: string) => l.nodes.find((n) => n.node.id === id)!;
const lay = (b: ReturnType<typeof build>, root: string | null, w = 800, h = 600) => layout(b.g, b.rollups, root, w, h, TODAY);

describe('layout', () => {
  it('weighs a node by its open descendant tasks; a task counts itself', () => {
    const { g } = build();
    const open = (id: string) => openTasks(g, g.nodes.get(id)!);
    expect(open('N1')).toBe(2); // paint gangers + build terrain; buy glue is done
    expect(open('N2')).toBe(2);
    expect(open('N3')).toBe(1);
    expect(open('N5')).toBe(0);
    expect(open('N6')).toBe(1);
  });

  it('lays out one level from the top: the projects, heavier first, nothing inside them', () => {
    const b = build();
    const l = lay(b, null);
    expect(ids(l.nodes)).toEqual(['N1', 'N6']);
    expect(node(l, 'N1').children).toBe(1); // Hive
    expect(node(l, 'N6').children).toBe(1); // Confirm quote
  });

  it('carries roll-up percent and derived blocked state', () => {
    const l = lay(build(), null);
    expect(node(l, 'N1').percent).toBe(33);
    expect(node(l, 'N6').blocked).toBe(true); // its only open task waits on paint-gangers
    expect(node(l, 'N1').blocked).toBe(false);
  });

  it('gives an empty project a floor-sized, dimmed circle', () => {
    const l = lay(build({ [A + 'empty.md']: nodeText({ id: 'N8', type: 'project', title: 'Empty', domain: 'alpha' }) }), null);
    const empty = node(l, 'N8');
    expect(empty.r).toBeGreaterThan(0);
    expect(empty.dim).toBe(true);
    expect(node(l, 'N1').dim).toBe(false);
    expect(node(l, 'N1').r).toBeGreaterThan(empty.r);
    expect(ids(l.nodes).at(-1)).toBe('N8'); // lightest last
  });

  it('leaves archived nodes out, and does not count them as children', () => {
    const l = lay(
      build({
        [A + 'old.md']: nodeText({ id: 'N9', type: 'project', title: 'Old', domain: 'alpha', status: 'archived' }),
        [A + 'old-sub.md']: nodeText({ id: 'N10', type: 'subproject', title: 'Old sub', domain: 'alpha', parent: 'campaign', status: 'archived' }),
      }),
      null,
    );
    expect(ids(l.nodes)).not.toContain('N9');
    expect(node(l, 'N1').children).toBe(1);
  });

  it('switches root: the root’s children become the level', () => {
    const b = build();
    expect(ids(lay(b, 'N1').nodes)).toEqual(['N2']);
    const atHive = lay(b, 'N2');
    expect(ids(atHive.nodes).sort()).toEqual(['N3', 'N4']);
    expect(node(atHive, 'N4').children).toBe(1); // buy glue
    expect(node(atHive, 'N4').percent).toBe(100);
    expect(node(atHive, 'N3').percent).toBeNull(); // a lone task has no ring
    expect(lay(b, 'N7').nodes).toEqual([]);
  });

  it('draws one line per typed link between visible circles, dotted across domains, none inside a circle', () => {
    const b = build({
      [A + 'sibling.md']: nodeText({ id: 'N11', type: 'task', title: 'Sibling', domain: 'alpha', parent: 'hive', blockedBy: ['paint-gangers'] }),
      [A + 'top.md']: nodeText({ id: 'N12', type: 'task', title: 'Top task', domain: 'alpha', parent: 'campaign', references: ['hive'] }),
    });
    const lines = (l: ReturnType<typeof layout>) => l.links.map((k) => [k.from.node.id, k.to.node.id, k.kind, k.cross]).sort();
    // Top level: everything in Campaign is one circle, so only the cross-domain blocked-by shows.
    expect(lines(lay(b, null))).toEqual([['N6', 'N1', 'blockedBy', true]]);
    // Inside Campaign: Hive and Top task are circles; Top task → Hive is a same-domain solid line; Sibling → Paint gangers stays inside Hive.
    expect(lines(lay(b, 'N1'))).toEqual([['N12', 'N2', 'references', false]]);
    // Inside Hive: the sibling link appears.
    expect(lines(lay(b, 'N2'))).toEqual([['N11', 'N3', 'blockedBy', false]]);
  });

  it('summarises what is inside: attachments and due pressure (decision 12)', () => {
    // TODAY is 2026-10-01. Spans start 2026-09-30 (fixture `start`).
    const b = build({
      [B + 'soon.md']: nodeText({ id: 'N13', type: 'task', title: 'Soon', domain: 'beta', parent: 'q4-sourcing', due: '2026-10-01' }), // 0 % left today
      [B + 'later.md']: nodeText({ id: 'N14', type: 'task', title: 'Later', domain: 'beta', parent: 'q4-sourcing', due: '2026-10-30' }), // 29/30 left
      [B + 'done-late.md']: nodeText({ id: 'N15', type: 'task', title: 'Done late', domain: 'beta', parent: 'q4-sourcing', due: '2026-09-25', status: 'done' }), // closed: ignored
    });
    const l = lay(b, null);
    const q4 = node(l, 'N6');
    expect(q4.children).toBe(4);
    // Confirm quote is overdue (due 2026-09-20) and Soon is at 0 %: both under 10 %.
    expect(q4.dueSoon).toBe(2);
    expect(q4.dueCritical).toBe(2);
    expect(node(l, 'N1').dueSoon).toBe(0); // paint gangers: due 10 Oct, 9/10 left
    expect(q4.attachments).toBe(0);
  });

  it('counts Drive links as attachments across the subtree', () => {
    const withDrive = nodeText({ id: 'N16', type: 'task', title: 'Docs', domain: 'alpha', parent: 'hive' }).replace('drive: []', 'drive: ["https://example.test/a", "https://example.test/b"]');
    const l = lay(build({ [A + 'docs.md']: withDrive }), null);
    expect(node(l, 'N1').attachments).toBe(2);
  });

  it('computes time left as a share of the start→due span', () => {
    const t = (start: string | null, due: string | null, created = '2026-09-01') =>
      timeLeftPercent({ start, due, created } as Parameters<typeof timeLeftPercent>[0], '2026-10-01');
    expect(t('2026-09-21', '2026-10-11')).toBe(50);
    expect(t('2026-09-01', '2026-10-05')).toBeCloseTo((4 / 34) * 100, 5);
    expect(t(null, '2026-10-05')).toBeCloseTo((4 / 34) * 100, 5); // created stands in for start
    expect(t('2026-09-01', '2026-09-30')).toBeLessThan(0); // overdue
    expect(t('2026-10-05', '2026-10-05')).toBe(100); // empty span, still in the future
    expect(t('2026-09-01', null)).toBeNull();
  });

  it('keeps every circle inside the box, with daylight between them, also at 300 nodes', () => {
    const big = bigFiles();
    const g = buildGraph(repoFiles(big), indexPaths(big), DOMAINS);
    expect(g.nodes.size).toBeGreaterThanOrEqual(300);
    const l = layout(g, computeRollups(g, TODAY), null, 1000, 700, TODAY);
    expect(l.nodes.length).toBe(12 + 2); // 12 big projects + the two fixture projects
    for (const n of l.nodes) {
      expect(n.r).toBeGreaterThan(0);
      expect(n.x - n.r).toBeGreaterThanOrEqual(-1e-6);
      expect(n.x + n.r).toBeLessThanOrEqual(1000 + 1e-6);
      expect(n.y - n.r).toBeGreaterThanOrEqual(-1e-6);
      expect(n.y + n.r).toBeLessThanOrEqual(700 + 1e-6);
    }
    for (const a of l.nodes) {
      for (const c of l.nodes) {
        if (a !== c) expect(Math.hypot(a.x - c.x, a.y - c.y) - a.r - c.r).toBeGreaterThan(20);
      }
    }
  });
});
