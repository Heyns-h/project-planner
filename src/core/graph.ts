import { stemOf } from './classify';
import { isLinkTarget } from './hub';
import { parseNode, parsePerson, parseTagList } from './parse';
import type { DomainDef, Graph, PlannerNode, RepoFile, Stem } from './types';
import { validateGraph } from './validate';

// The in-memory graph. Rebuilt from the local cache after each pull or edit:
// a full rebuild over ~1,000 nodes is a few milliseconds, and the UI keeps its
// own view state, so nothing visible is lost. Children, `blocks` and the
// effective domain are derived here, never stored (blueprint v0.3 §4.1, §4.2).

export function buildGraph(files: readonly RepoFile[], indexPaths: readonly string[], domains: readonly DomainDef[]): Graph {
  // The link space (v0.3 §4.8 rules 3 and 7): nodes/, people/ and docs/.
  const linkPaths = new Set([...indexPaths, ...files.map((f) => f.path)].filter(isLinkTarget));
  const stemCount = new Map<Stem, number>();
  for (const p of linkPaths) stemCount.set(stemOf(p), (stemCount.get(stemOf(p)) ?? 0) + 1);
  const g: Graph = {
    nodes: new Map(),
    byStem: new Map(),
    children: new Map(),
    blocks: new Map(),
    people: new Map(),
    tags: new Map(),
    allStems: new Set(stemCount.keys()),
  };

  for (const f of files) {
    const node = parseNode(f, domains);
    if (node) {
      if (g.nodes.has(node.id)) {
        // Same planner_id in two files (e.g. a hand copy). Keep the first; flag the second.
        node.problems.push({ code: 'bad-value', severity: 'error', field: 'planner_id', message: `planner_id ${node.id} is also used by ${g.nodes.get(node.id)?.path ?? 'another file'}` });
        node.readOnly = true;
        node.id = `${node.id}#${node.path}`;
      }
      if ((stemCount.get(node.stem) ?? 0) > 1) {
        node.problems.push({ code: 'duplicate-stem', severity: 'warning', message: `Another file in nodes/, people/ or docs/ is also named ${node.stem}.md, so [[${node.stem}]] is ambiguous` });
      }
      g.nodes.set(node.id, node);
      g.byStem.set(node.stem, node.id);
      continue;
    }
    const person = parsePerson(f, domains);
    if (person) {
      g.people.set(person.stem, person);
      continue;
    }
    const tags = parseTagList(f, domains);
    if (tags) g.tags.set(tags.domain, tags);
  }

  for (const n of g.nodes.values()) {
    const parent = n.parent ? g.byStem.get(n.parent) : undefined;
    if (parent) push(g.children, parent, n.id);
    for (const b of n.blockedBy) {
      const target = g.byStem.get(b);
      if (target) push(g.blocks, target, n.id);
    }
  }
  for (const list of g.children.values()) list.sort((a, b) => compareNodes(g.nodes.get(a), g.nodes.get(b)));

  // Effective domain: the root project's stored domain (v0.3 §4.1).
  for (const n of g.nodes.values()) {
    const chain = ancestors(g, n.id);
    const root = chain.length ? chain[chain.length - 1] : n;
    n.effectiveDomain = root?.domain || n.domain;
  }

  validateGraph(g);
  return g;
}

function push(m: Map<string, string[]>, k: string, v: string): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

function compareNodes(a: PlannerNode | undefined, b: PlannerNode | undefined): number {
  if (!a || !b) return 0;
  const rank = { project: 0, subproject: 1, task: 2, subtask: 3 } as const;
  return rank[a.plannerType] - rank[b.plannerType] || a.title.localeCompare(b.title);
}

/** Top-level nodes: no parent, or a parent that does not resolve to a node. */
export function roots(g: Graph): PlannerNode[] {
  return [...g.nodes.values()]
    .filter((n) => !n.parent || !g.byStem.has(n.parent))
    .sort(compareNodes);
}

export function childrenOf(g: Graph, id: string): PlannerNode[] {
  return (g.children.get(id) ?? []).map((c) => g.nodes.get(c)).filter((n): n is PlannerNode => n !== undefined);
}

export function nodeByStem(g: Graph, stem: Stem): PlannerNode | undefined {
  const id = g.byStem.get(stem);
  return id ? g.nodes.get(id) : undefined;
}

/** Ancestors from the parent upwards. Stops at a cycle. */
export function ancestors(g: Graph, id: string): PlannerNode[] {
  const out: PlannerNode[] = [];
  const seen = new Set<string>([id]);
  let cur = g.nodes.get(id);
  while (cur?.parent) {
    const p = nodeByStem(g, cur.parent);
    if (!p || seen.has(p.id)) break;
    seen.add(p.id);
    out.push(p);
    cur = p;
  }
  return out;
}

export function descendants(g: Graph, id: string): PlannerNode[] {
  const out: PlannerNode[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(g.children.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop() as string;
    if (seen.has(c)) continue;
    seen.add(c);
    const n = g.nodes.get(c);
    if (n) out.push(n);
    stack.push(...(g.children.get(c) ?? []));
  }
  return out;
}
