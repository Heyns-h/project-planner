import { descendants, nodeByStem } from './graph';
import { statusInfo } from './status';
import { isTaskLike, type Graph, type PlannerNode } from './types';

// Roll-up (blueprint §4.6). Computed in memory, never written to files.
//  - progress: share of descendant tasks that are done, archived excluded.
//    A task with no counted sub-tasks counts itself.
//  - blocked: the node's own progress is impeded (decision 9, 2026-10-01):
//    it is stored on-hold or waits on an unfinished blocked_by target, or
//    EVERY open task beneath it is impeded (itself, or through a parent
//    below this node). Some but not all → `blockedTasks` > 0 and the UI tints
//    the progress wheel instead of marking the node blocked.
//    Done and archived nodes are never shown as blocked.
//  - overdue: past due and not done, itself or any descendant.

export interface Rollup {
  done: number;
  total: number;
  percent: number | null; // null when there are no tasks to count
  blocked: boolean;
  /** Open leaf tasks beneath the node, and how many of them are impeded. */
  openTasks: number;
  blockedTasks: number;
  waitingOn: PlannerNode[]; // unfinished blocked_by targets
  overdue: boolean;
}

const isDone = (n: PlannerNode) => statusInfo(n.status).done;
const inRollup = (n: PlannerNode) => statusInfo(n.status).inRollup;
const closed = (n: PlannerNode) => isDone(n) || n.status === 'archived';
const openTask = (n: PlannerNode) => isTaskLike(n.plannerType) && inRollup(n) && !isDone(n);

export function computeRollups(g: Graph, today: string): Map<string, Rollup> {
  const waiting = new Map<string, PlannerNode[]>();
  for (const n of g.nodes.values()) {
    waiting.set(
      n.id,
      n.blockedBy.map((s) => nodeByStem(g, s)).filter((t): t is PlannerNode => t !== undefined && !closed(t)),
    );
  }
  const impeded = (n: PlannerNode) => !closed(n) && (n.status === 'on-hold' || (waiting.get(n.id)?.length ?? 0) > 0);

  // An open task is a leaf when nothing open sits beneath it.
  const descMemo = new Map<string, PlannerNode[]>();
  const desc = (id: string) => {
    let d = descMemo.get(id);
    if (!d) descMemo.set(id, (d = descendants(g, id)));
    return d;
  };
  const isLeaf = (t: PlannerNode) => !desc(t.id).some(openTask);

  // A leaf is impeded by itself or by any parent between it and `top`.
  const impededUnder = (leaf: PlannerNode, topId: string): boolean => {
    const seen = new Set<string>();
    let cur: PlannerNode | undefined = leaf;
    while (cur && cur.id !== topId && !seen.has(cur.id)) {
      if (impeded(cur)) return true;
      seen.add(cur.id);
      cur = cur.parent ? nodeByStem(g, cur.parent) : undefined;
    }
    return false;
  };

  const out = new Map<string, Rollup>();
  for (const n of g.nodes.values()) {
    const d = desc(n.id);
    const countedDesc = d.filter((t) => isTaskLike(t.plannerType) && inRollup(t));
    const leaves = countedDesc.length > 0 ? countedDesc : isTaskLike(n.plannerType) && inRollup(n) ? [n] : [];
    const done = leaves.filter(isDone).length;
    const total = leaves.length;
    const openLeaves = d.filter((t) => openTask(t) && isLeaf(t));
    const blockedTasks = openLeaves.filter((t) => impededUnder(t, n.id)).length;
    out.set(n.id, {
      done,
      total,
      percent: total === 0 ? null : Math.round((done / total) * 100),
      blocked: impeded(n) || (openLeaves.length > 0 && blockedTasks === openLeaves.length),
      openTasks: openLeaves.length,
      blockedTasks,
      waitingOn: waiting.get(n.id) ?? [],
      overdue: [n, ...d].some((t) => t.due !== null && t.due < today && !closed(t)),
    });
  }
  return out;
}
