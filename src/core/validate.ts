import type { Graph, PlannerNode, PlannerType, Stem } from './types';

// Graph-level checks, mirroring vault-check.sh check 4 (every wikilink must
// resolve to a file name in the repo) plus the hierarchy rules of blueprint
// §4.5. Results are added to each node's problems. Parse-level checks
// (nine keys, no title:, value formats) happen in parse.ts.

export function validateGraph(g: Graph): void {
  for (const n of g.nodes.values()) {
    const linkFields: [string, Stem[]][] = [
      ['parent', n.parent ? [n.parent] : []],
      ['owner', n.owner ? [n.owner] : []],
      ['people', n.people],
      ['blocked_by', n.blockedBy],
      ['relates', n.relates],
      ['references', n.references],
    ];
    for (const [field, stems] of linkFields) {
      for (const s of stems) {
        if (!g.allStems.has(s)) {
          n.problems.push({ code: 'unresolved-link', severity: 'warning', field, message: `[[${s}]] does not match any note in the repo` });
        }
      }
    }
    const h = hierarchyProblem(g, n);
    if (h) n.problems.push(h);
  }
  for (const id of nodesInCycles(g)) {
    const n = g.nodes.get(id);
    n?.problems.push({ code: 'cycle', severity: 'warning', field: 'parent', message: 'This node is its own ancestor through its parent chain' });
  }
}

function hierarchyProblem(g: Graph, n: PlannerNode): PlannerNode['problems'][number] | null {
  if (!n.parent) {
    return n.plannerType === 'project'
      ? null
      : { code: 'hierarchy', severity: 'warning', field: 'parent', message: `A ${n.plannerType} should have a parent` };
  }
  const pid = g.byStem.get(n.parent);
  const parent = pid ? g.nodes.get(pid) : undefined;
  if (!parent) {
    return g.allStems.has(n.parent)
      ? { code: 'hierarchy', severity: 'warning', field: 'parent', message: `[[${n.parent}]] is not a planner node` }
      : null; // unresolved link already reported
  }
  const msg = allowedParent(n.plannerType, parent.plannerType);
  return msg ? { code: 'hierarchy', severity: 'warning', field: 'parent', message: msg } : null;
}

/** Blueprint §4.5. Returns a warning message, or null when allowed. */
export function allowedParent(child: PlannerType, parent: PlannerType): string | null {
  if (child === 'project') return 'A project nested under another node (allowed, but unusual)';
  if (child === 'subproject' && (parent === 'task' || parent === 'subtask')) return 'A subproject should sit under a project or subproject, not a task';
  if (child === 'task' && parent === 'subtask') return 'A task should not sit under a sub-task';
  if (child === 'subtask' && parent !== 'task') return 'A sub-task should sit under a task';
  return null;
}

/** Would setting `nodeId`'s parent to `newParent` make the node its own ancestor? */
export function wouldCycle(g: Graph, nodeId: string, newParent: Stem | null): boolean {
  if (!newParent) return false;
  const node = g.nodes.get(nodeId);
  if (!node) return false;
  let cur: Stem | null = newParent;
  const seen = new Set<string>();
  while (cur) {
    if (cur === node.stem) return true;
    const id = g.byStem.get(cur);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    cur = g.nodes.get(id)?.parent ?? null;
  }
  return false;
}

function nodesInCycles(g: Graph): Set<string> {
  const inCycle = new Set<string>();
  for (const start of g.nodes.values()) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: PlannerNode | undefined = start;
    while (cur && !onPath.has(cur.id)) {
      path.push(cur.id);
      onPath.add(cur.id);
      const pid: string | undefined = cur.parent ? g.byStem.get(cur.parent) : undefined;
      cur = pid ? g.nodes.get(pid) : undefined;
    }
    if (cur) {
      const from = path.indexOf(cur.id);
      for (const id of path.slice(from)) inCycle.add(id);
    }
  }
  return inCycle;
}
