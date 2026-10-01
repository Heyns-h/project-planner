import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { replay, resolveConflict } from '../../src/core/ops';
import type { Field, NewNode, Op, QueuedOp } from '../../src/core/types';
import { Store } from '../../src/store/db';
import { sync } from '../../src/sync/engine';
import { GitHub, GitHubError } from '../../src/sync/github';
import { FakeGitHub } from '../fake-github';
import { DOMAINS, FILES } from '../fixtures/repo';

// The eight scenarios of plan §8, plus conflict handling. Two "devices" share
// one fake GitHub; each has its own IndexedDB store and queue.

const QUOTE = '02-Beta/07-planner/confirm-quote.md'; // N7
const GANGERS = '01-Alpha/07-planner/paint-gangers.md'; // N3
let dbSeq = 0;
let fake: FakeGitHub;
let batchSeq = 0;

interface Device {
  name: string;
  store: Store;
  gh: GitHub;
  sync: () => ReturnType<typeof sync>;
  set: (nodeId: string, field: Field, from: unknown, to: unknown, batchId?: string) => Promise<void>;
  enqueue: (ops: Op[], summary?: string) => Promise<void>;
}

async function device(name: string, dbName = `dev-${++dbSeq}`): Promise<Device> {
  const store = await Store.open(indexedDB, dbName);
  const gh = new GitHub('tok', 'o', 'r', fake.fetch);
  const d: Device = {
    name,
    store,
    gh,
    sync: () => sync(gh, store, { branch: 'main', device: name, domains: DOMAINS, today: () => '2026-09-30', backoff: async () => {} }),
    enqueue: async (ops, summary = 'edit') => {
      const batchId = `b${++batchSeq}`;
      await store.enqueue(ops.map((op, i) => ({ opId: `${batchId}-${i}`, batchId, summary, op, at: '2026-09-30T00:00:00Z', device: name })));
    },
    set: (nodeId, field, from, to) => d.enqueue([{ kind: 'set', nodeId, field, from, to }], `edit ${nodeId} (${field})`),
  };
  return d;
}

const line = (path: string, key: string) =>
  (fake.snapshot()[path] ?? '').split('\n').find((l) => l.startsWith(`${key}:`));

beforeEach(async () => {
  fake = new FakeGitHub();
  await fake.commit(FILES, 'seed');
});

describe('sync scenarios (plan §8)', () => {
  it('1. offline edits to different fields on two devices both land, one line each', async () => {
    const phone = await device('phone');
    const laptop = await device('laptop');
    await phone.sync();
    await laptop.sync();
    await phone.set('N7', 'status', 'active', 'done');
    await laptop.set('N7', 'priority', 'medium', 'high');
    const before = fake.snapshot()[QUOTE]!;
    expect((await phone.sync()).pushed?.ops).toBe(1);
    expect((await laptop.sync()).pushed?.ops).toBe(1);
    expect(line(QUOTE, 'status')).toBe('status: done');
    expect(line(QUOTE, 'priority')).toBe('priority: high');
    const diff = before.split('\n').filter((l, i) => l !== fake.snapshot()[QUOTE]!.split('\n')[i]);
    expect(diff).toEqual(['status: active', 'priority: medium']);
    expect(await phone.store.queued()).toEqual([]);
    expect(await laptop.store.queued()).toEqual([]);
  });

  it('2. the same field on two devices: one conflict, everything else still pushed', async () => {
    const phone = await device('phone');
    const laptop = await device('laptop');
    await phone.sync();
    await laptop.sync();
    await phone.set('N7', 'due', '2026-09-20', '2026-10-01');
    await phone.sync();
    await laptop.set('N7', 'due', '2026-09-20', '2026-10-15'); // saw the old value
    await laptop.set('N3', 'status', 'active', 'done'); // unrelated, separate batch
    const r = await laptop.sync();
    expect(r.conflicts).toBe(1);
    expect(r.pushed?.ops).toBe(1);
    expect(line(QUOTE, 'due')).toBe('due: 2026-10-01'); // phone's value stands; nothing overwritten
    expect(line(GANGERS, 'status')).toBe('status: done');
    const [left] = await laptop.store.queued();
    expect(left?.conflict).toMatchObject({ field: 'due', base: '2026-09-20', mine: '2026-10-15', theirs: '2026-10-01' });
  });

  it('3. an edit against a remote delete is a conflict, not a resurrection', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await laptop.set('N7', 'status', 'active', 'done');
    await fake.commitChange({ [QUOTE]: null }, 'deleted by hand');
    const r = await laptop.sync();
    expect(r.conflicts).toBe(1);
    expect(r.pushed).toBeNull();
    expect(fake.snapshot()[QUOTE]).toBeUndefined();
    expect((await laptop.store.queued())[0]?.conflict?.field).toBe('deleted');
  });

  it('4. push race: the branch moves before the ref update; retry lands one commit on top', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await laptop.set('N7', 'status', 'active', 'done');
    fake.beforeRefUpdate = async () => {
      await fake.commitChange({ [GANGERS]: fake.snapshot()[GANGERS]!.replace('priority: medium', 'priority: high') }, 'desktop auto-push');
    };
    const r = await laptop.sync();
    expect(r.attempts).toBe(2);
    expect(line(QUOTE, 'status')).toBe('status: done');
    expect(line(GANGERS, 'priority')).toBe('priority: high'); // the competing commit is kept
    const head = fake.commits.get(fake.head!)!;
    expect(fake.commits.get(head.parent!)?.message).toBe('desktop auto-push');
    expect(fake.headMessage()).toBe('planner: edit N7 (status) (laptop)');
  });

  it('5. an external edit to another field is rebased onto cleanly', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await laptop.set('N7', 'status', 'active', 'done');
    await fake.commitChange({ [QUOTE]: fake.snapshot()[QUOTE]! + '\nNotes added by Claude.\n' }, 'claude');
    const r = await laptop.sync();
    expect(r.conflicts).toBe(0);
    expect(fake.snapshot()[QUOTE]).toContain('Notes added by Claude.');
    expect(line(QUOTE, 'status')).toBe('status: done');
  });

  it('6. the same file name created on two devices: the second is renamed, both kept', async () => {
    const phone = await device('phone');
    const laptop = await device('laptop');
    await phone.sync();
    await laptop.sync();
    const node = (id: string): NewNode => ({ id, plannerType: 'task', title: 'Book courier', domain: 'beta', parent: 'q4-sourcing' });
    await phone.enqueue([{ kind: 'create', node: node('P1'), path: '02-Beta/07-planner/book-courier.md' }], "add 'Book courier'");
    await laptop.enqueue([
      { kind: 'create', node: node('L1'), path: '02-Beta/07-planner/book-courier.md' },
    ], "add 'Book courier'");
    await phone.sync();
    await laptop.sync();
    const snap = fake.snapshot();
    expect(snap['02-Beta/07-planner/book-courier.md']).toContain('planner_id: P1');
    expect(snap['02-Beta/07-planner/book-courier-2.md']).toContain('planner_id: L1');
  });

  it('6b. a queued child of a renamed new item follows the rename', async () => {
    const phone = await device('phone');
    const laptop = await device('laptop');
    await phone.sync();
    await laptop.sync();
    await phone.enqueue([{ kind: 'create', node: { id: 'P1', plannerType: 'subproject', title: 'Shipping', domain: 'beta', parent: 'q4-sourcing' }, path: '02-Beta/07-planner/shipping.md' }]);
    await phone.sync();
    await laptop.enqueue([
      { kind: 'create', node: { id: 'L1', plannerType: 'subproject', title: 'Shipping', domain: 'beta', parent: 'q4-sourcing' }, path: '02-Beta/07-planner/shipping.md' },
      { kind: 'create', node: { id: 'L2', plannerType: 'task', title: 'Pack', domain: 'beta', parent: 'shipping' }, path: '02-Beta/07-planner/pack.md' },
    ]);
    await laptop.sync();
    expect(fake.snapshot()['02-Beta/07-planner/pack.md']).toContain('parent: "[[shipping-2]]"');
  });

  it('7. the queue survives a restart and syncs afterwards', async () => {
    const first = await device('phone', 'restart-db');
    await first.sync();
    await first.set('N7', 'status', 'active', 'done');
    first.store.close();
    const again = await device('phone', 'restart-db');
    expect((await again.store.queued()).length).toBe(1);
    await again.sync();
    expect(line(QUOTE, 'status')).toBe('status: done');
  });

  it('8. a rate limit fails the attempt without losing anything; the next sync succeeds', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await laptop.set('N7', 'status', 'active', 'done');
    fake.rateLimitNext = 1;
    const err: unknown = await laptop.sync().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).rateLimited).toBe(true);
    expect((await laptop.store.queued()).length).toBe(1);
    await laptop.sync();
    expect(line(QUOTE, 'status')).toBe('status: done');
  });
});

describe('conflicts and batches', () => {
  it('holds back a whole batch when one of its ops conflicts', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await fake.commitChange({ [QUOTE]: fake.snapshot()[QUOTE]!.replace('status: active', 'status: done') });
    await laptop.enqueue([
      { kind: 'set', nodeId: 'N7', field: 'status', from: 'active', to: 'on-hold' },
      { kind: 'set', nodeId: 'N7', field: 'priority', from: 'medium', to: 'high' },
    ]);
    const r = await laptop.sync();
    expect(r.pushed).toBeNull();
    expect(line(QUOTE, 'priority')).toBe('priority: medium');
    const q = await laptop.store.queued();
    expect(q.map((o) => Boolean(o.conflict))).toEqual([true, false]);
  });

  it('resolving a conflict as "mine" is a fresh op from their value, and then it lands', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await fake.commitChange({ [QUOTE]: fake.snapshot()[QUOTE]!.replace('status: active', 'status: done') });
    await laptop.set('N7', 'status', 'active', 'on-hold');
    await laptop.sync();
    const [c] = await laptop.store.queued();
    const resolved: QueuedOp = { ...c!, op: { kind: 'set', nodeId: 'N7', field: 'status', from: c!.conflict!.theirs, to: c!.conflict!.mine } };
    delete resolved.conflict;
    await laptop.store.updateQueue([resolved], []);
    await laptop.sync();
    expect(line(QUOTE, 'status')).toBe('status: on-hold');
  });

  it('resolving as "theirs" drops the op and releases the held rest of its batch', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await fake.commitChange({ [QUOTE]: fake.snapshot()[QUOTE]!.replace('status: active', 'status: done') });
    await laptop.enqueue([
      { kind: 'set', nodeId: 'N7', field: 'status', from: 'active', to: 'on-hold' },
      { kind: 'set', nodeId: 'N7', field: 'priority', from: 'medium', to: 'high' },
    ]);
    await laptop.sync();
    const [c] = await laptop.store.queued();
    expect(resolveConflict(c!, 'theirs')).toBeNull();
    await laptop.store.updateQueue([], [c!.opId]);
    const r = await laptop.sync();
    expect(r.pushed?.ops).toBe(1);
    expect(line(QUOTE, 'status')).toBe('status: done');
    expect(line(QUOTE, 'priority')).toBe('priority: high');
    expect(await laptop.store.queued()).toEqual([]);
  });

  it('resolving as "base" restores the value both devices started from', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await fake.commitChange({ [QUOTE]: fake.snapshot()[QUOTE]!.replace('status: active', 'status: done') });
    await laptop.set('N7', 'status', 'active', 'on-hold');
    await laptop.sync();
    const [c] = await laptop.store.queued();
    const resolved = resolveConflict(c!, 'base');
    expect(resolved?.op).toMatchObject({ from: 'done', to: 'active' });
    await laptop.store.updateQueue([resolved!], []);
    await laptop.sync();
    expect(line(QUOTE, 'status')).toBe('status: active');
    expect(await laptop.store.queued()).toEqual([]);
  });

  it('drops ops that are already reflected in the repo', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await fake.commitChange({ [QUOTE]: fake.snapshot()[QUOTE]!.replace('status: active', 'status: done') });
    await laptop.set('N7', 'status', 'active', 'done');
    const before = fake.head;
    const r = await laptop.sync();
    expect(r.pushed).toBeNull();
    expect(fake.head).toBe(before);
    expect(await laptop.store.queued()).toEqual([]);
  });

  it('never writes under .github/', async () => {
    const laptop = await device('laptop');
    await laptop.sync();
    await expect(laptop.gh.createTree(fake.commits.get(fake.head!)!.tree, [{ path: '.github/workflows/x.yml', content: 'x' }])).rejects.toThrow('.github');
  });

  it('replay is the optimistic view: remote plus queue, without touching the base', () => {
    const base = new Map(Object.entries(FILES));
    const q: QueuedOp[] = [{ opId: 'a', batchId: 'b', summary: 's', seq: 1, at: '', device: 'd', op: { kind: 'set', nodeId: 'N7', field: 'status', from: 'active', to: 'done' } }];
    const r = replay(base, q, { domains: DOMAINS, allStems: new Set(), today: '2026-09-30' });
    expect(r.files.get(QUOTE)).toContain('status: done');
    expect(base.get(QUOTE)).toContain('status: active');
    expect([...r.changed]).toEqual([QUOTE]);
  });
});
