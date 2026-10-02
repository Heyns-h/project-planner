import { hierarchy, pack, type HierarchyCircularNode } from 'd3-hierarchy';
import { childrenOf, descendants, roots } from './graph';
import type { Rollup } from './rollup';
import { statusInfo } from './status';
import type { Graph, PlannerNode } from './types';

// Bubble layout (blueprint §5.1 as revised by decisions 11–12, 2026-10-02).
// Pure: graph + view root → one level of free-floating circles, each named
// and carrying a summary of what is inside it. Nothing is drawn inside a
// circle; drill-in shows the next level. Recomputed on every render, never
// stored. Runs in Node, so it is unit-tested without a DOM.
//
// A circle's weight is its open descendant tasks; an empty or all-done node
// keeps a floor weight so it stays visible, and is flagged `dim` to be drawn
// darker (decision 5). Archived nodes are not laid out at all.

export interface LayoutNode {
  node: PlannerNode;
  x: number;
  y: number;
  r: number;
  /** Open descendant tasks (a task counts itself). */
  open: number;
  /** Percent done from the roll-up, or null when nothing to count. */
  percent: number | null;
  blocked: boolean;
  /** Some, but not all, open tasks beneath are blocked: the wheel is tinted (decision 9). */
  partial: boolean;
  /** No open tasks: floor size and a darker shade. */
  dim: boolean;
  /** What is inside (decision 12): items one level down, Drive links in the subtree, due pressure. */
  children: number;
  attachments: number;
  /** Open items (itself or beneath) with under 25 % of their start→due span left. */
  dueSoon: number;
  /** Of those, under 10 % left, or already overdue. */
  dueCritical: number;
}

export type LinkKind = 'blockedBy' | 'relates' | 'references';

/**
 * A typed link between two visible circles. A link from anything inside
 * circle A to anything inside circle B is drawn once between A and B; links
 * that stay inside one circle are not drawn. `cross` marks a link between
 * domains (dotted line).
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
  nodes: LayoutNode[];
  links: LayoutLink[];
}

export interface LayoutOptions {
  /** Gap between circles when packed, in layout units. */
  padding?: number;
  /** How far the packed cluster is pulled apart: 1 = touching at `padding`. */
  spread?: number;
  /** Weight given to a circle with no open tasks. */
  floor?: number;
}

const DEFAULTS: Required<LayoutOptions> = { padding: 24, spread: 1.18, floor: 1 };

const isDone = (n: PlannerNode) => statusInfo(n.status).done;
const counted = (n: PlannerNode) => n.plannerType === 'task' && statusInfo(n.status).inRollup;
const shown = (n: PlannerNode) => n.status !== 'archived';
const closed = (n: PlannerNode) => isDone(n) || n.status === 'archived';

/** Open descendant tasks of `n` (including `n` itself when it is a task). */
export function openTasks(g: Graph, n: PlannerNode): number {
  return [n, ...descendants(g, n.id)].filter((t) => counted(t) && !isDone(t)).length;
}

const DAY = 86_400_000;
const days = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;

/**
 * Share of the start→due span still left, as a percentage (decision 12):
 * (due − today) / (due − start) × 100. `created` stands in for a missing
 * start. Null when there is no due date; ≤ 0 once overdue or when the span
 * is empty.
 */
export function timeLeftPercent(n: PlannerNode, today: string): number | null {
  if (!n.due) return null;
  const due = days(n.due);
  const start = days(n.start ?? n.created);
  const now = days(today);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return null;
  if (!Number.isFinite(start) || due <= start) return due > now ? 100 : 0;
  return ((due - now) / (due - start)) * 100;
}

interface Datum {
  n: PlannerNode | null; // null for the synthetic root
  open: number;
}

export function layout(g: Graph, rollups: ReadonlyMap<string, Rollup>, rootId: string | null, width: number, height: number, today: string, options: LayoutOptions = {}): Layout {
  const { spread, floor } = { ...DEFAULTS, ...options };
  // The gap shrinks with the box, so a phone-width view is not all gap.
  const padding = Math.min(options.padding ?? DEFAULTS.padding, Math.min(width, height) / 24);
  const level = (rootId === null ? roots(g) : childrenOf(g, rootId)).filter(shown);
  if (level.length === 0) return { width, height, nodes: [], links: [] };

  const data: Datum[] = level.map((n) => ({ n, open: openTasks(g, n) }));
  // Area follows open tasks on a gentle curve: a finished project is still a
  // readable circle beside a busy one (r ∝ √weight, so (open+1)^0.6 keeps the
  // biggest within about 2× the smallest at a dozen tasks). The floor is a
  // minimum weight; "nothing open" always weighs less than "one task".
  const h = hierarchy<Datum>({ n: null, open: 0 }, (d) => (d.n === null ? data : undefined))
    .sum((d) => (d.n ? Math.max((d.open + 1) ** 0.6, floor) : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  // Pack into a smaller box, then push positions outwards: the circles keep
  // their size and the gaps grow, so the cluster floats rather than tiles.
  const packed = pack<Datum>()
    .size([width / spread, height / spread])
    .padding(padding)(h);
  const cx = width / 2;
  const cy = height / 2;
  const sx = width / spread / 2;
  const sy = height / spread / 2;

  const toNode = (p: HierarchyCircularNode<Datum>): LayoutNode => {
    const n = p.data.n as PlannerNode;
    const r = rollups.get(n.id);
    const desc = descendants(g, n.id);
    const subtree = [n, ...desc];
    const openItems = subtree.filter((t) => !closed(t));
    const left = openItems.map((t) => timeLeftPercent(t, today)).filter((v): v is number => v !== null);
    return {
      node: n,
      x: cx + (p.x - sx) * spread,
      y: cy + (p.y - sy) * spread,
      r: p.r,
      open: p.data.open,
      // A ring only where there is something to roll up; a lone task has no ring.
      percent: desc.some(counted) ? r?.percent ?? null : null,
      blocked: r?.blocked ?? false,
      partial: !(r?.blocked ?? false) && (r?.blockedTasks ?? 0) > 0,
      dim: p.data.open === 0,
      children: childrenOf(g, n.id).filter(shown).length,
      attachments: subtree.reduce((sum, t) => sum + t.drive.length, 0),
      dueSoon: left.filter((v) => v < 25).length,
      dueCritical: left.filter((v) => v < 10).length,
    };
  };

  const nodes = (packed.children ?? []).map(toNode);
  return { width, height, nodes, links: links(g, nodes) };
}

const LINK_FIELDS: readonly LinkKind[] = ['blockedBy', 'relates', 'references'];

/** Typed links between visible circles (see LayoutLink). */
function links(g: Graph, nodes: readonly LayoutNode[]): LayoutLink[] {
  // Which visible circle each node falls under.
  const owner = new Map<string, LayoutNode>();
  for (const p of nodes) {
    owner.set(p.node.id, p);
    for (const d of descendants(g, p.node.id)) owner.set(d.id, p);
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
        const key = `${from.node.id}>${to.node.id}:${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from, to, kind, cross: from.node.domain !== to.node.domain });
      }
    }
  }
  return out;
}
