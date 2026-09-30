import { isContentPath } from '../core/classify';
import { gitBlobSha } from '../core/gitsha';
import { commitMessage, replay } from '../core/ops';
import type { DomainDef, QueuedOp, RepoFile } from '../core/types';
import type { IndexEntry, Store } from '../store/db';
import { BranchMovedError, GitHub, listAllBlobs } from './github';

// Sync engine (blueprint §8.2–8.3): pull, rebase the queue onto the fresh
// content, push the result as one commit, retry if someone pushed first.

export interface PullResult {
  changed: boolean;
  commit: string | null;
  fetched: number; // blobs downloaded this pull
  removed: number;
}

/** GitHub allows 900 GET points per minute per endpoint (G8); stay well under it. */
const BLOB_CONCURRENCY = 6;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function pull(gh: GitHub, store: Store, branch: string, now = () => new Date()): Promise<PullResult> {
  const etag = (await store.getMeta('refEtag')) ?? null;
  const last = (await store.getMeta('lastSync')) ?? null;

  const ref = await gh.getRef(branch, last ? etag : null);
  if (ref === null || ref.sha === last) {
    if (last && !(await store.getMeta('lastTree'))) await store.setMeta('lastTree', await gh.getCommitTree(last));
    return { changed: false, commit: last, fetched: 0, removed: 0 };
  }

  const tree = await gh.getCommitTree(ref.sha);
  const blobs = (await listAllBlobs(gh, tree)).filter((e) => e.path.endsWith('.md'));
  const index: IndexEntry[] = blobs.map((b) => ({ path: b.path, sha: b.sha }));

  const cached = new Map((await store.allFiles()).map((f) => [f.path, f]));
  const wanted = blobs.filter((b) => isContentPath(b.path));
  const toFetch = wanted.filter((b) => cached.get(b.path)?.sha !== b.sha);
  const wantedPaths = new Set(wanted.map((b) => b.path));
  const remove = [...cached.keys()].filter((p) => !wantedPaths.has(p));

  const put: RepoFile[] = await mapLimit(toFetch, BLOB_CONCURRENCY, async (b) => ({
    path: b.path,
    sha: b.sha,
    content: await gh.getBlobText(b.sha),
  }));

  await store.applyPull({ index, put, remove, commit: ref.sha, tree, etag: ref.etag, at: now().toISOString() });
  return { changed: true, commit: ref.sha, fetched: put.length, removed: remove.length };
}

export interface SyncContext {
  branch: string;
  device: string;
  domains: readonly DomainDef[];
  today: () => string; // YYYY-MM-DD, local
  now?: () => Date;
  /** Wait before retrying after the branch moved; injectable for tests. */
  backoff?: (attempt: number) => Promise<void>;
}

export interface SyncResult {
  pulled: PullResult;
  pushed: { commit: string; files: number; ops: number } | null;
  conflicts: number; // ops waiting for a decision
  attempts: number;
}

export const MAX_ATTEMPTS = 5;

const defaultBackoff = (attempt: number) => new Promise<void>((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt)));

/** Pull, then push whatever the queue still holds. */
export async function sync(gh: GitHub, store: Store, ctx: SyncContext): Promise<SyncResult> {
  const now = ctx.now ?? (() => new Date());
  const backoff = ctx.backoff ?? defaultBackoff;
  let pulled: PullResult = { changed: false, commit: null, fetched: 0, removed: 0 };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    pulled = await pull(gh, store, ctx.branch, now);
    const queue = await store.queued();
    if (queue.length === 0) return { pulled, pushed: null, conflicts: 0, attempts: attempt };

    const base = new Map((await store.allFiles()).map((f) => [f.path, f.content]));
    const allStems = new Set((await store.allIndex()).map((e) => e.path.slice(e.path.lastIndexOf('/') + 1, -3)));
    const r = replay(base, queue, { domains: ctx.domains, allStems, today: ctx.today() });

    // Record conflict flags so the UI can show them; clear flags that no longer apply.
    const flagged: QueuedOp[] = [];
    for (const q of queue) {
      const c = r.conflicts.get(q.opId);
      if (JSON.stringify(c) !== JSON.stringify(q.conflict)) {
        const { conflict: _old, ...rest } = q;
        flagged.push(c ? { ...rest, conflict: c } : rest);
      }
    }
    const waiting = r.conflicts.size;

    if (r.changed.size === 0) {
      await store.updateQueue(flagged, r.redundant);
      return { pulled, pushed: null, conflicts: waiting, attempts: attempt };
    }

    const parent = await store.getMeta('lastSync');
    const baseTree = await store.getMeta('lastTree');
    if (!parent || !baseTree) throw new Error('Nothing pulled yet; cannot push');

    const writes = [...r.changed].sort().map((path) => ({ path, content: r.files.get(path) ?? null }));
    const appliedOps = queue.filter((q) => r.applied.includes(q.opId));
    const tree = await gh.createTree(baseTree, writes);
    const commit = await gh.createCommit(commitMessage(appliedOps, ctx.device), tree.sha, parent);
    try {
      await gh.updateRef(ctx.branch, commit);
    } catch (e) {
      if (e instanceof BranchMovedError && attempt < MAX_ATTEMPTS) {
        await store.updateQueue(flagged, []);
        await backoff(attempt);
        continue; // someone pushed first: pull again and rebase
      }
      throw e;
    }

    const put: RepoFile[] = [];
    const index: IndexEntry[] = [];
    for (const w of writes) {
      if (w.content === null) continue;
      const sha = await gitBlobSha(w.content);
      index.push({ path: w.path, sha });
      if (isContentPath(w.path)) put.push({ path: w.path, sha, content: w.content });
    }
    await store.applyPush({ put, index, commit, tree: tree.sha, removeOps: [...r.applied, ...r.redundant], at: now().toISOString() });
    await store.updateQueue(flagged.filter((q) => !r.applied.includes(q.opId) && !r.redundant.includes(q.opId)), []);
    return { pulled, pushed: { commit, files: writes.length, ops: r.applied.length }, conflicts: waiting, attempts: attempt };
  }
  throw new Error(`Gave up after ${MAX_ATTEMPTS} attempts: the branch kept moving`);
}
