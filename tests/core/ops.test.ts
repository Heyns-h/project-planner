import { describe, expect, it } from 'vitest';
import { resolveConflict } from '../../src/core/ops';
import type { Conflict, QueuedOp } from '../../src/core/types';

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
