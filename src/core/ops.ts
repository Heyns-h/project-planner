import { stemOf } from './classify';
import { parseNode } from './parse';
import { addTagRow, applyEdits, newNodeContent, newPersonContent } from './serialize';
import { uniqueStem } from './slug';
import type { Conflict, DomainDef, Field, Graph, Op, PlannerNode, QueuedOp, Stem } from './types';
import { wouldCycle } from './validate';

// Ops are the only way anything changes (blueprint §8.3). They are queued, and
// replayed in order onto the latest known repo content:
//  - on every render (optimistic view = remote + queue), and
//  - at push time onto freshly pulled content (the rebase).
// A `set` applies only if the field still holds the value the user saw
// (`from`); if it already holds `to` the op is redundant; otherwise it is a
// conflict. A conflict holds back its whole batch: an action is never half
// applied. Nothing is ever resolved automatically.

export interface ReplayResult {
  /** Working copy: path → content after applying every applicable op. */
  files: Map<string, string>;
  /** Paths whose content differs from the input. */
  changed: Set<string>;
  applied: string[]; // opIds
  redundant: string[]; // opIds already reflected in the files; safe to drop
  held: string[]; // opIds in a batch with a conflict
  conflicts: Map<string, Conflict>; // opId → conflict
  /** Stems renamed because the planned file name was taken by the time of replay. */
  renamed: Map<Stem, Stem>;
}

type Ctx = { domains: readonly DomainDef[]; allStems: ReadonlySet<Stem>; today: string };

const norm = (v: unknown): unknown => (v === '' || v === undefined ? null : v);
export function sameValue(a: unknown, b: unknown): boolean {
  const x = norm(a);
  const y = norm(b);
  if (Array.isArray(x) || Array.isArray(y)) {
    const xa = Array.isArray(x) ? x : [];
    const ya = Array.isArray(y) ? y : [];
    return xa.length === ya.length && xa.every((v, i) => v === ya[i]);
  }
  return x === y;
}

export function fieldValue(n: PlannerNode, f: Field): unknown {
  return f === 'title' ? n.title : n[f];
}

function findNode(files: Map<string, string>, nodeId: string, domains: readonly DomainDef[]): { path: string; node: PlannerNode } | null {
  for (const [path, content] of files) {
    if (!content.includes(nodeId)) continue; // cheap prefilter
    const node = parseNode({ path, sha: '', content }, domains);
    if (node?.id === nodeId) return { path, node };
  }
  return null;
}

function renameLinks(op: Op, renamed: ReadonlyMap<Stem, Stem>): Op {
  if (renamed.size === 0) return op;
  const r = (s: Stem | null | undefined) => (s ? renamed.get(s) ?? s : s ?? null);
  const rl = (l: unknown) => (Array.isArray(l) ? l.map((s) => r(String(s))) : l);
  switch (op.kind) {
    case 'set':
      return ['parent', 'owner'].includes(op.field)
        ? { ...op, from: r(op.from as Stem | null), to: r(op.to as Stem | null) }
        : ['people', 'blockedBy', 'relates', 'references'].includes(op.field)
          ? { ...op, from: rl(op.from), to: rl(op.to) }
          : op;
    case 'create':
      return {
        ...op,
        node: {
          ...op.node,
          parent: r(op.node.parent),
          owner: r(op.node.owner),
          ...(op.node.blockedBy ? { blockedBy: op.node.blockedBy.map((s) => r(s) as Stem) } : {}),
        },
      };
    default:
      return op;
  }
}

/**
 * Replay queued ops onto `base` (path → content). Pure: `base` is not modified.
 * `queue` must be in `seq` order.
 */
export function replay(base: ReadonlyMap<string, string>, queue: readonly QueuedOp[], ctx: Ctx): ReplayResult {
  const files = new Map(base);
  const stems = new Set(ctx.allStems);
  for (const p of base.keys()) stems.add(stemOf(p));
  const res: ReplayResult = { files, changed: new Set(), applied: [], redundant: [], held: [], conflicts: new Map(), renamed: new Map() };

  // Group into batches, keeping queue order.
  const batches: QueuedOp[][] = [];
  for (const q of queue) {
    const last = batches[batches.length - 1];
    if (last && last[0]?.batchId === q.batchId) last.push(q);
    else batches.push([q]);
  }

  for (const batch of batches) {
    // Try the batch on a scratch copy; commit it only if nothing conflicts.
    const scratch = new Map(files);
    const touched = new Set<string>();
    const applied: string[] = [];
    const redundant: string[] = [];
    const newStems: Stem[] = [];
    let conflict = false;

    for (const q of batch) {
      const op = renameLinks(q.op, res.renamed);
      const c = (field: Conflict['field'], baseV: unknown, theirs: unknown, mine: unknown, readOnly = false) => {
        const nodeId = 'nodeId' in op ? op.nodeId : '';
        res.conflicts.set(q.opId, { opId: q.opId, nodeId, field, base: baseV, mine, theirs, ...(readOnly ? { readOnly } : {}) });
        conflict = true;
      };

      if (op.kind === 'set' || op.kind === 'body') {
        const found = findNode(scratch, op.nodeId, ctx.domains);
        if (!found) {
          c('deleted', op.from, null, op.to);
          continue;
        }
        if (found.node.readOnly) {
          c(op.kind === 'set' ? op.field : 'body', op.from, null, op.to, true);
          continue;
        }
        const current = op.kind === 'set' ? fieldValue(found.node, op.field) : found.node.body;
        if (sameValue(current, op.to)) {
          redundant.push(q.opId);
          continue;
        }
        if (!sameValue(current, op.from)) {
          c(op.kind === 'set' ? op.field : 'body', op.from, current, op.to);
          continue;
        }
        const before = scratch.get(found.path) as string;
        const after =
          op.kind === 'set'
            ? applyEdits(before, [{ field: op.field, value: op.to }], ctx.today)
            : applyEdits(before, [], ctx.today, op.to);
        scratch.set(found.path, after);
        touched.add(found.path);
        applied.push(q.opId);
      } else if (op.kind === 'create' || op.kind === 'createPerson') {
        let path = op.path;
        const planned = stemOf(path);
        if (scratch.has(path) || stems.has(planned)) {
          // Name taken since the op was queued (e.g. another device created it): pick the next free one.
          const title = op.kind === 'create' ? op.node.title : op.person.name;
          const fresh = uniqueStem(title, new Set([...stems, ...newStems]));
          path = `${path.slice(0, path.lastIndexOf('/') + 1)}${fresh}.md`;
          res.renamed.set(planned, fresh);
        }
        if (op.kind === 'create' && findNode(scratch, op.node.id, ctx.domains)) {
          redundant.push(q.opId); // already created (e.g. pushed before a crash)
          continue;
        }
        const content = op.kind === 'create' ? newNodeContent(op.node, ctx.today) : newPersonContent(op.person, ctx.today);
        scratch.set(path, content);
        touched.add(path);
        newStems.push(stemOf(path));
        applied.push(q.opId);
      } else if (op.kind === 'addTag') {
        const path = [...scratch.keys()].find((p) => p.endsWith(`/_${op.domain}-tags.md`));
        if (!path) {
          c('deleted', null, null, op.tag);
          continue;
        }
        const next = addTagRow(scratch.get(path) as string, op.tag, op.meaning, ctx.today);
        if (next === null) {
          redundant.push(q.opId);
          continue;
        }
        scratch.set(path, next);
        touched.add(path);
        applied.push(q.opId);
      }
    }

    if (conflict) {
      for (const q of batch) if (!res.conflicts.has(q.opId)) res.held.push(q.opId);
      continue;
    }
    for (const [p, v] of scratch) files.set(p, v);
    for (const p of touched) if (base.get(p) !== files.get(p)) res.changed.add(p);
    for (const s of newStems) stems.add(s);
    res.applied.push(...applied);
    res.redundant.push(...redundant);
  }
  // A path touched then restored to its base content is not a change.
  for (const p of [...res.changed]) if (base.get(p) === files.get(p)) res.changed.delete(p);
  return res;
}

// ---------------------------------------------------------------------------
// Checks before an op is queued (plan §6: an invalid op is refused up front).

export function checkOp(g: Graph, op: Op): string | null {
  if (op.kind === 'set' || op.kind === 'body') {
    const n = g.nodes.get(op.nodeId);
    if (!n) return 'That item no longer exists.';
    if (n.readOnly) return 'This note has conflict markers or broken frontmatter; fix it in the repo first.';
    if (op.kind === 'body') return null;
    const v = op.to;
    const resolves = (s: unknown) => typeof s === 'string' && g.allStems.has(s);
    switch (op.field) {
      case 'parent':
        if (v !== null && !resolves(v)) return `[[${String(v)}]] is not a note in the repo.`;
        if (v !== null && !g.byStem.has(String(v))) return 'The parent must be a planner item.';
        if (wouldCycle(g, op.nodeId, (v as Stem | null) ?? null)) return 'That would make the item its own ancestor.';
        return null;
      case 'owner':
        return v === null || (typeof v === 'string' && g.people.has(v)) ? null : 'The owner must be a person note.';
      case 'people':
        return (v as unknown[]).every((s) => typeof s === 'string' && g.people.has(s)) ? null : 'Everyone listed must be a person note.';
      case 'blockedBy':
        if ((v as unknown[]).includes(n.stem)) return 'An item cannot block itself.';
        return (v as unknown[]).every((s) => typeof s === 'string' && g.byStem.has(s)) ? null : 'Blocked-by items must be planner items.';
      case 'relates':
      case 'references':
        return (v as unknown[]).every(resolves) ? null : 'Every link must be a note in the repo.';
      case 'tags': {
        const allowed = g.tags.get(n.domain)?.tags ?? [];
        const bad = (v as string[]).filter((t) => !allowed.includes(t));
        return bad.length ? `Not in the ${n.domain} tag list: ${bad.join(', ')}` : null;
      }
      case 'start':
      case 'due':
        return v === null || /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? null : 'Dates are YYYY-MM-DD.';
      case 'title':
        return String(v ?? '').trim() ? null : 'The title cannot be empty.';
      default:
        return null;
    }
  }
  if (op.kind === 'create') {
    const p = op.node.parent;
    if (p !== null && !g.byStem.has(p)) return 'The parent must be a planner item.';
    if (!op.node.title.trim()) return 'The title cannot be empty.';
    if (g.allStems.has(stemOf(op.path))) return 'That file name is taken.';
    return null;
  }
  if (op.kind === 'createPerson') return op.person.name.trim() ? null : 'The name cannot be empty.';
  return null;
}

// ---------------------------------------------------------------------------
// Conflict resolution (blueprint §8.4). The dialog offers yours / theirs /
// base; nothing is chosen automatically.

export type Resolution = 'mine' | 'theirs' | 'base';

/**
 * Turn a decision into queue changes. "Theirs" drops my op: the repo already
 * holds their value, and the held ops of the batch replay on their own.
 * "Mine" and "base" become a fresh op whose `from` is their value, so it
 * applies cleanly at the next rebase (and conflicts again only if the field
 * moves yet again in the meantime). Null means: nothing to queue, drop the op.
 * Returns undefined when the op cannot be resolved that way (a remotely
 * deleted or read-only note accepts only "theirs").
 */
export function resolveConflict(q: QueuedOp, choice: Resolution): QueuedOp | null | undefined {
  const c = q.conflict;
  if (!c) return undefined;
  if (choice === 'theirs') return null;
  if (c.field === 'deleted' || c.readOnly || !(q.op.kind === 'set' || q.op.kind === 'body')) return undefined;
  const to = choice === 'mine' ? c.mine : c.base;
  if (sameValue(to, c.theirs)) return null; // nothing to change
  const { conflict: _c, ...rest } = q;
  const op: Op = q.op.kind === 'body' ? { kind: 'body', nodeId: q.op.nodeId, from: String(c.theirs ?? ''), to: String(to ?? '') } : { ...q.op, from: c.theirs, to };
  return { ...rest, op };
}

/** Commit message for the batches in a push (blueprint §8.3). */
export function commitMessage(ops: readonly QueuedOp[], device: string): string {
  const summaries = [...new Set(ops.map((o) => o.summary))];
  const head = summaries.length === 1 ? summaries[0] : `${summaries.length} changes`;
  const body = summaries.length > 1 ? `\n\n${summaries.map((s) => `- ${s}`).join('\n')}` : '';
  return `planner: ${head} (${device})${body}`;
}

