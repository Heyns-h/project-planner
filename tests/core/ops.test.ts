import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/core/graph';
import { checkOp, replay, resolveConflict } from '../../src/core/ops';
import type { Conflict, Op, QueuedOp } from '../../src/core/types';
import { DOMAINS, FILES, indexPaths, repoFiles } from '../fixtures/repo';

const TAGS = '01-Alpha/_alpha-tags.md';
const GANGERS = '01-Alpha/07-planner/paint-gangers.md';

describe('addTag with the edit that uses it (plan Phase 2 §5)', () => {
  const g = buildGraph(repoFiles(), indexPaths(), DOMAINS);
  const batch: Op[] = [
    { kind: 'addTag', domain: 'alpha', tag: 'rush', meaning: 'Needed this week' },
    { kind: 'set', nodeId: 'N3', field: 'tags', from: ['painting'], to: ['painting', 'rush'] },
  ];

  it('is accepted up front only as a batch: the tag is not in the list yet', () => {
    expect(checkOp(g, batch[1]!)).toMatch(/Not in the alpha tag list: rush/);
    expect(checkOp(g, batch[1]!, batch)).toBeNull();
    expect(checkOp(g, batch[0]!)).toBeNull();
    expect(checkOp(g, { kind: 'addTag', domain: 'alpha', tag: 'painting', meaning: 'x' })).toMatch(/already/);
    expect(checkOp(g, { kind: 'addTag', domain: 'alpha', tag: 'Not Kebab', meaning: 'x' })).toMatch(/lower-case/);
    expect(checkOp(g, { kind: 'addTag', domain: 'beta', tag: 'rush', meaning: 'x' })).toMatch(/no tag list/);
  });

  it('replays as one row in the table plus the note edit, and holds both on a conflict', () => {
    const q = (ops: Op[], batchId = 'b'): QueuedOp[] => ops.map((op, i) => ({ opId: `${batchId}-${i}`, batchId, summary: 's', op, at: '', device: 'd', seq: i + 1 }));
    const ctx = { domains: DOMAINS, allStems: new Set<string>(), today: '2026-10-01' };
    const r = replay(new Map(Object.entries(FILES)), q(batch), ctx);
    expect(r.applied).toEqual(['b-0', 'b-1']);
    const table = r.files.get(TAGS)!;
    expect(table.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(2 + 3); // header, divider, two seeded, one new
    expect(table).toContain('| `rush` | Needed this week | 2026-10-01 |');
    expect(r.files.get(GANGERS)).toContain('tags: [painting, rush]');

    // The note moved under us: the tag row must not land on its own.
    const moved = new Map(Object.entries(FILES));
    moved.set(GANGERS, FILES[GANGERS]!.replace('tags: [painting]', 'tags: [terrain]'));
    const held = replay(moved, q(batch), ctx);
    expect(held.applied).toEqual([]);
    expect(held.conflicts.has('b-1')).toBe(true);
    expect(held.held).toEqual(['b-0']);
    expect(held.files.get(TAGS)).toBe(FILES[TAGS]);
  });
});

// Conflict resolution is pure: a decision becomes a queue change.

function queued(op: QueuedOp['op'], conflict: Omit<Conflict, 'opId' | 'nodeId'>): QueuedOp {
  return { opId: 'a-0', batchId: 'a', summary: "edit 'X' (due)", op, at: '2026-10-01T10:00:00Z', device: 'phone', seq: 1, conflict: { opId: 'a-0', nodeId: 'N1', ...conflict } };
}

const dueOp = { kind: 'set', nodeId: 'N1', field: 'due', from: '2026-09-20', to: '2026-10-15' } as const;
const dueConflict = { field: 'due', base: '2026-09-20', mine: '2026-10-15', theirs: '2026-10-01' } as const;

describe('resolveConflict', () => {
  it('"mine" is a fresh op from their value to mine, with the flag cleared', () => {
    const r = resolveConflict(queued(dueOp, dueConflict), 'mine');
    expect(r).toMatchObject({ opId: 'a-0', batchId: 'a', seq: 1, op: { kind: 'set', field: 'due', from: '2026-10-01', to: '2026-10-15' } });
    expect(r && 'conflict' in r).toBe(false);
  });

  it('"theirs" drops my op', () => {
    expect(resolveConflict(queued(dueOp, dueConflict), 'theirs')).toBeNull();
  });

  it('"base" goes back to the value both started from', () => {
    expect(resolveConflict(queued(dueOp, dueConflict), 'base')).toMatchObject({ op: { from: '2026-10-01', to: '2026-09-20' } });
  });

  it('a choice that equals their value has nothing to queue', () => {
    const q = queued({ ...dueOp, from: null }, { ...dueConflict, base: null, theirs: null });
    expect(resolveConflict(q, 'base')).toBeNull();
  });

  it('body conflicts resolve to a body op', () => {
    const q = queued({ kind: 'body', nodeId: 'N1', from: 'old', to: 'mine' }, { field: 'body', base: 'old', mine: 'mine', theirs: 'theirs' });
    expect(resolveConflict(q, 'mine')).toMatchObject({ op: { kind: 'body', from: 'theirs', to: 'mine' } });
  });

  it('a remotely deleted or read-only note accepts only "theirs"', () => {
    const gone = queued(dueOp, { field: 'deleted', base: '2026-09-20', mine: '2026-10-15', theirs: null });
    expect(resolveConflict(gone, 'mine')).toBeUndefined();
    expect(resolveConflict(gone, 'theirs')).toBeNull();
    const ro = queued(dueOp, { ...dueConflict, theirs: null, readOnly: true });
    expect(resolveConflict(ro, 'base')).toBeUndefined();
    expect(resolveConflict(ro, 'theirs')).toBeNull();
  });

  it('an op without a conflict cannot be resolved', () => {
    const { conflict: _c, ...plain } = queued(dueOp, dueConflict);
    expect(resolveConflict(plain, 'mine')).toBeUndefined();
  });
});
