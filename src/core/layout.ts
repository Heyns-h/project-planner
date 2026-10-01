import { hierarchy, pack, type HierarchyCircularNode } from 'd3-hierarchy';
import { childrenOf, descendants, roots } from './graph';
import type { Rollup } from './rollup';
import { statusInfo } from './status';
import type { Graph, PlannerNode } from './types';

// Bubble layout (blueprint §5.1, plan Phase 2 §5). Pure: graph + view root →
// circles two levels deep. Recomputed on every render, never stored. Runs in
// Node, so it is unit-tested without a DOM.
//
// Level 1 is the view root's children (all top-level projects when the root is
// null); level 2 is their children, drawn but not opened further. A circle's
// weight is its open descendant tasks; an empty or all-done node keeps a floor
// weight so it stays visible, and is flagged `dim` to be drawn darker
// (decision 5). Archived nodes are not laid out at all.

export interface LayoutNode {
  node: PlannerNode;
  depth: 1 | 2;
  x: number;
  y: number;
  r: number;
  /** Open descendant tasks (a task counts itself). */
  open: number;
  /** Percent done from the roll-up, or null when nothing to count. */
  percent: number | null;
  blocked: boolean;
  /** Level 2 only: how many descendants are hidden beneath this circle. */
  beneath: number;
  /** No open tasks: floor size and a darker shade. */
  dim: boolean;
  children: LayoutNode[];
}

export type LinkKind = 'blockedBy' | 'relates' | 'references';

/**
 * A typed link between two visible circles. A link from anything inside
 * circle A to anything inside circle B is drawn once between A and B; links
 * that stay inside one circle, or run between a circle and its own parent,
 * are not drawn. `cross` marks a link between domains (dotted line).
 */
export interface LayoutLink {
  from: LayoutNode;
  to: LayoutNode;
  kind: LinkKind;
  cross: boolean;
}

export interface Layout {
  width: number;
  height: number;
  /** Level-1 circles, each with its level-2 children. */
  nodes: LayoutNode[];
  /** Every circle, level 1 then level 2, for flat rendering. */
  all: LayoutNode[];
  links: LayoutLink[];
}

export interface LayoutOptions {
  /** Gap between level-1 circles, in layout units. */
  padding?: number;
  /**
   * Gap between a level-1 circle and its children, so the parent keeps a band
   * for its own label even when one child would otherwise fill it (pack sizes
   * a parent by the circle that encloses its children, not by its weight).
   */
  innerPadding?: number;
  /** Weight given to a circle with no open tasks. */
  floor?: number;
}

const DEFAULTS: Required<LayoutOptions> = { padding: 22, innerPadding: 34, floor: 0.6 };

const isDone = (n: PlannerNode) => statusInfo(n.status).done;
const counted = (n: PlannerNode) => n.plannerType === 'task' && statusInfo(n.status).inRollup;
const shown = (n: PlannerNode) => n.status !== 'archived';

/** Open descendant tasks of `n` (including `n` itself when it is a task). */
export function openTasks(g: Graph, n: PlannerNode): number {
  return [n, ...descendants(g, n.id)].filter((t) => counted(t) && !isDone(t)).length;
}

interface Datum {
  n: PlannerNode | null; // null for the synthetic root
  open: number;
  children: Datum[];
}

function datum(g: Graph, n: PlannerNode, depth: 1 | 2): Datum {
  const kids = depth === 1 ? childrenOf(g, n.id).filter(shown).map((c) => datum(g, c, 2)) : [];
  return { n, open: openTasks(g, n), children: kids };
}

export function layout(g: Graph, rollups: ReadonlyMap<string, Rollup>, rootId: string | null, width: number, height: number, options: LayoutOptions = {}): Layout {
  const { padding, innerPadding, floor } = { ...DEFAULTS, ...options };
  const level1 = (rootId === null ? roots(g) : childrenOf(g, rootId)).filter(shown);
  const root: Datum = { n: null, open: 0, children: level1.map((n) => datum(g, n, 1)) };

  if (level1.length === 0) return { width, height, nodes: [], all: [], links: [] };

  const h = hierarchy<Datum>(root, (d) => d.children)
    // Leaves carry their own weight (with the floor); parents are sized by their children.
    .sum((d) => (d.n && d.children.length === 0 ? Math.max(d.open, floor) : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  // d3 calls the padding function per parent, for the gap around that parent's children.
  const packed = pack<Datum>()
    .size([width, height])
    .padding((d) => (d.depth === 0 ? padding : innerPadding))(h);

  const toNode = (p: HierarchyCircularNode<Datum>, depth: 1 | 2): LayoutNode => {
    const n = p.data.n as PlannerNode;
    const r = rollups.get(n.id);
    const desc = descendants(g, n.id);
    return {
      node: n,
      depth,
      x: p.x,
      y: p.y,
      r: p.r,
      open: p.data.open,
      // A ring only where there is something to roll up; a lone task has no ring.
      percent: desc.some(counted) ? r?.percent ?? null : null,
      blocked: r?.blocked ?? false,
      beneath: depth === 2 ? desc.filter(shown).length : 0,
      dim: p.data.open === 0,
      children: depth === 1 ? (p.children ?? []).map((c) => toNode(c, 2)) : [],
    };
  };

  const nodes = (packed.children ?? []).map((c) => toNode(c, 1));
  const all = [...nodes, ...nodes.flatMap((n) => n.children)];
  return { width, height, nodes, all, links: links(g, nodes) };
}

const LINK_FIELDS: readonly LinkKind[] = ['blockedBy', 'relates', 'references'];

/** Typed links between visible circles (see LayoutLink). */
function links(g: Graph, nodes: readonly LayoutNode[]): LayoutLink[] {
  // Which visible circle each node falls under: a level-2 circle for itself
  // and its descendants, otherwise the level-1 circle.
  const owner = new Map<string, LayoutNode>();
  const parentOf = new Map<LayoutNode, LayoutNode>();
  for (const p of nodes) {
    owner.set(p.node.id, p);
    for (const d of descendants(g, p.node.id)) owner.set(d.id, p);
    for (const c of p.children) {
      parentOf.set(c, p);
      owner.set(c.node.id, c);
      for (const d of descendants(g, c.node.id)) owner.set(d.id, c);
    }
  }
  const out: LayoutLink[] = [];
  const seen = new Set<string>();
  for (const [id, from] of owner) {
    const n = g.nodes.get(id);
    if (!n) continue;
    for (const kind of LINK_FIELDS) {
      for (const stem of n[kind]) {
        const targetId = g.byStem.get(stem);
        const to = targetId ? owner.get(targetId) : undefined;
        if (!to || to === from) continue; // outside the view, or inside the same circle
        if (parentOf.get(from) === to || parentOf.get(to) === from) continue; // a circle and its own parent
        const key = `${from.node.id}>${to.node.id}:${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from, to, kind, cross: from.node.domain !== to.node.domain });
      }
    }
  }
  return out;
}
