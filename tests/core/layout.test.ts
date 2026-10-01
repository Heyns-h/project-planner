import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/core/graph';
import { layout, openTasks, type LayoutNode } from '../../src/core/layout';
import { computeRollups } from '../../src/core/rollup';
import { bigFiles } from '../fixtures/big';
import { DOMAINS, indexPaths, nodeText, repoFiles, TODAY } from '../fixtures/repo';

// Plan Phase 2 §6: weights count only open tasks; the floor keeps empty
// projects visible; exactly two levels; root switching; archived excluded;
// sorted by value; everything inside the box.

const A = '01-Alpha/07-planner/';

function build(extra: Record<string, string> = {}) {
  const g = buildGraph(repoFiles(extra), indexPaths(extra), DOMAINS);
  return { g, rollups: computeRollups(g, TODAY) };
}
const ids = (nodes: LayoutNode[]) => nodes.map((n) => n.node.id);
const node = (l: { all: LayoutNode[] }, id: string) => l.all.find((n) => n.node.id === id)!;

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

  it('lays out two levels from the top: projects, then their children', () => {
    const { g, rollups } = build();
    const l = layout(g, rollups, null, 800, 600);
    expect(ids(l.nodes)).toEqual(['N1', 'N6']); // heavier first
    expect(ids(l.nodes[0]!.children)).toEqual(['N2']);
    expect(ids(l.nodes[1]!.children)).toEqual(['N7']);
    expect(l.all.map((n) => n.depth)).toEqual([1, 1, 2, 2]);
    expect(node(l, 'N2').beneath).toBe(3); // N3, N4, N5 hidden beneath Hive
    expect(node(l, 'N2').children).toEqual([]);
  });

  it('carries roll-up percent and derived blocked state', () => {
    const { g, rollups } = build();
    const l = layout(g, rollups, null, 800, 600);
    expect(node(l, 'N1').percent).toBe(33);
    expect(node(l, 'N7').blocked).toBe(true); // waiting on paint-gangers
    expect(node(l, 'N1').blocked).toBe(false);
  });

  it('gives an empty project a floor-sized, dimmed circle', () => {
    const { g, rollups } = build({ [A + 'empty.md']: nodeText({ id: 'N8', type: 'project', title: 'Empty', domain: 'alpha' }) });
    const l = layout(g, rollups, null, 800, 600);
    const empty = node(l, 'N8');
    expect(empty.r).toBeGreaterThan(0);
    expect(empty.dim).toBe(true);
    expect(node(l, 'N1').dim).toBe(false);
    expect(node(l, 'N1').r).toBeGreaterThan(empty.r);
    expect(ids(l.nodes).at(-1)).toBe('N8'); // lightest last
  });

  it('leaves archived nodes out at both levels', () => {
    const { g, rollups } = build({
      [A + 'old.md']: nodeText({ id: 'N9', type: 'project', title: 'Old', domain: 'alpha', status: 'archived' }),
      [A + 'old-sub.md']: nodeText({ id: 'N10', type: 'subproject', title: 'Old sub', domain: 'alpha', parent: 'campaign', status: 'archived' }),
    });
    const l = layout(g, rollups, null, 800, 600);
    expect(ids(l.all)).not.toContain('N9');
    expect(ids(l.all)).not.toContain('N10');
    expect(ids(l.nodes[0]!.children)).toEqual(['N2']);
  });

  it('switches root: the root’s children become level 1', () => {
    const { g, rollups } = build();
    const atCampaign = layout(g, rollups, 'N1', 800, 600);
    expect(ids(atCampaign.nodes)).toEqual(['N2']);
    expect(ids(atCampaign.nodes[0]!.children).sort()).toEqual(['N3', 'N4']);
    expect(node(atCampaign, 'N4').beneath).toBe(1); // buy glue

    const atHive = layout(g, rollups, 'N2', 800, 600);
    expect(ids(atHive.nodes).sort()).toEqual(['N3', 'N4']);
    expect(ids(node(atHive, 'N4').children)).toEqual(['N5']);
    expect(node(atHive, 'N5').dim).toBe(true);
    expect(node(atHive, 'N5').percent).toBeNull(); // a lone task has no ring
    expect(node(atHive, 'N4').percent).toBe(100); // its parent rolls it up
  });

  it('returns nothing for a root without children', () => {
    const { g, rollups } = build();
    const l = layout(g, rollups, 'N7', 800, 600);
    expect(l.nodes).toEqual([]);
    expect(l.all).toEqual([]);
  });

  it('keeps every circle inside the box, also at 300 nodes', () => {
    const big = bigFiles();
    const g = buildGraph(repoFiles(big), indexPaths(big), DOMAINS);
    expect(g.nodes.size).toBeGreaterThanOrEqual(300);
    const l = layout(g, computeRollups(g, TODAY), null, 1000, 700);
    expect(l.nodes.length).toBe(12 + 2); // 12 big projects + the two fixture projects
    for (const n of l.all) {
      expect(n.r).toBeGreaterThan(0);
      expect(n.x - n.r).toBeGreaterThanOrEqual(-1e-6);
      expect(n.x + n.r).toBeLessThanOrEqual(1000 + 1e-6);
      expect(n.y - n.r).toBeGreaterThanOrEqual(-1e-6);
      expect(n.y + n.r).toBeLessThanOrEqual(700 + 1e-6);
    }
    // Level-2 circles sit inside their parent.
    for (const p of l.nodes) {
      for (const c of p.children) expect(Math.hypot(c.x - p.x, c.y - p.y) + c.r).toBeLessThanOrEqual(p.r + 1e-6);
    }
  });
});
