import { descendants, nodeByStem } from './graph';
import { statusInfo } from './status';
import type { Graph, PlannerNode } from './types';

// Roll-up (blueprint §4.6). Computed in memory, never written to files.
//  - progress: share of descendant tasks that are done, archived excluded.
//    A task with no counted sub-tasks counts itself.
//  - blocked: stored on-hold, or waiting on an unfinished blocked_by target,
//    or any direct child shown as blocked (so it propagates upwards).
//    Done and archived nodes are never shown as blocked.
//  - overdue: past due and not done, itself or any descendant.

export interface Rollup {
  done: number;
  total: number;
  percent: number | null; // null when there are no tasks to count
  blocked: boolean;
  waitingOn: PlannerNode[]; // unfinished blocked_by targets
  overdue: boolean;
}

const isDone = (n: PlannerNode) => statusInfo(n.status).done;
const inRollup = (n: PlannerNode) => statusInfo(n.status).inRollup;
const closed = (n: PlannerNode) => isDone(n) || n.status === 'archived';

export function computeRollups(g: Graph, today: string): Map<string, Rollup> {
  const waiting = new Map<string, PlannerNode[]>();
  for (const n of g.nodes.values()) {
    waiting.set(
      n.id,
      n.blockedBy.map((s) => nodeByStem(g, s)).filter((t): t is PlannerNode => t !== undefined && !closed(t)),
    );
  }

  const blockedMemo = new Map<string, boolean>();
  const blocked = (id: string, visiting: Set<string>): boolean => {
    const known = blockedMemo.get(id);
    if (known !== undefined) return known;
    const n = g.nodes.get(id);
    if (!n || visiting.has(id)) return false; // cycle guard
    visiting.add(id);
    const result =
      !closed(n) &&
      (n.status === 'on-hold' ||
        (waiting.get(id)?.length ?? 0) > 0 ||
        (g.children.get(id) ?? []).some((c) => blocked(c, visiting)));
    visiting.delete(id);
    blockedMemo.set(id, result);
    return result;
  };

  const out = new Map<string, Rollup>();
  for (const n of g.nodes.values()) {
    const desc = descendants(g, n.id);
    const countedDesc = desc.filter((t) => t.plannerType === 'task' && inRollup(t));
    const leaves = countedDesc.length > 0 ? countedDesc : n.plannerType === 'task' && inRollup(n) ? [n] : [];
    const done = leaves.filter(isDone).length;
    const total = leaves.length;
    out.set(n.id, {
      done,
      total,
      percent: total === 0 ? null : Math.round((done / total) * 100),
      blocked: blocked(n.id, new Set()),
      waitingOn: waiting.get(n.id) ?? [],
      overdue: [n, ...desc].some((t) => t.due !== null && t.due < today && !closed(t)),
    });
  }
  return out;
}
