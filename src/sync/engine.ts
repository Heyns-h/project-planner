import { isContentPath } from '../core/classify';
import type { RepoFile } from '../core/types';
import type { IndexEntry, Store } from '../store/db';
import { GitHub, listAllBlobs } from './github';

// Pull half of the sync engine (blueprint §8.2). Push and rebase arrive in 1c.

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

  await store.applyPull({ index, put, remove, commit: ref.sha, etag: ref.etag, at: now().toISOString() });
  return { changed: true, commit: ref.sha, fetched: put.length, removed: remove.length };
}
