import type { QueuedOp, RepoConfig, RepoFile } from '../core/types';

// Thin IndexedDB wrapper (plan §3). One database per origin:
//   files    path → RepoFile (+ base content for rebasing, Phase 1)
//   index    path → blob sha, for every .md in the repo (names only)
//   queue    opId → QueuedOp (Phase 1)
//   meta     key → value: lastSync commit, ref ETag, config
//   secrets  key → value: the token. Never exported or logged.

const DB_NAME = 'project-planner';
const DB_VERSION = 1;
const STORES = ['files', 'index', 'queue', 'meta', 'secrets'] as const;
type StoreName = (typeof STORES)[number];

export interface IndexEntry {
  path: string;
  sha: string;
}

export interface Meta {
  config: RepoConfig;
  lastSync: string | null; // commit sha
  lastTree: string | null; // that commit's root tree sha (push needs it as base_tree)
  lastSyncAt: string | null; // ISO time
  refEtag: string | null;
  persisted: boolean | null;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class Store {
  private constructor(private readonly db: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<Store> {
    return new Promise((resolve, reject) => {
      const r = factory.open(name, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of STORES) {
          if (db.objectStoreNames.contains(s)) continue;
          if (s === 'files' || s === 'index') db.createObjectStore(s, { keyPath: 'path' });
          else if (s === 'queue') db.createObjectStore(s, { keyPath: 'opId' });
          else db.createObjectStore(s);
        }
      };
      r.onsuccess = () => resolve(new Store(r.result));
      r.onerror = () => reject(r.error ?? new Error('Cannot open IndexedDB'));
    });
  }

  close(): void {
    this.db.close();
  }

  private tx(stores: StoreName | StoreName[], mode: IDBTransactionMode): IDBTransaction {
    return this.db.transaction(stores, mode);
  }

  // --- meta and secrets -------------------------------------------------

  async getMeta<K extends keyof Meta>(key: K): Promise<Meta[K] | undefined> {
    return (await req(this.tx('meta', 'readonly').objectStore('meta').get(key))) as Meta[K] | undefined;
  }

  async setMeta<K extends keyof Meta>(key: K, value: Meta[K]): Promise<void> {
    const t = this.tx('meta', 'readwrite');
    t.objectStore('meta').put(value, key);
    await done(t);
  }

  async getToken(): Promise<string | undefined> {
    return (await req(this.tx('secrets', 'readonly').objectStore('secrets').get('token'))) as string | undefined;
  }

  async setToken(token: string): Promise<void> {
    const t = this.tx('secrets', 'readwrite');
    t.objectStore('secrets').put(token, 'token');
    await done(t);
  }

  // --- files and index --------------------------------------------------

  async allFiles(): Promise<RepoFile[]> {
    return (await req(this.tx('files', 'readonly').objectStore('files').getAll())) as RepoFile[];
  }

  async allIndex(): Promise<IndexEntry[]> {
    return (await req(this.tx('index', 'readonly').objectStore('index').getAll())) as IndexEntry[];
  }

  /**
   * Apply one pull atomically: the new name index replaces the old one, changed
   * files are written, removed files deleted, and the sync position advances.
   * One transaction, so a crash never leaves a half-applied pull.
   */
  async applyPull(p: {
    index: IndexEntry[];
    put: RepoFile[];
    remove: string[];
    commit: string;
    tree: string;
    etag: string | null;
    at: string;
  }): Promise<void> {
    const t = this.tx(['files', 'index', 'meta'], 'readwrite');
    const idx = t.objectStore('index');
    idx.clear();
    for (const e of p.index) idx.put(e);
    const files = t.objectStore('files');
    for (const f of p.put) files.put(f);
    for (const path of p.remove) files.delete(path);
    const meta = t.objectStore('meta');
    meta.put(p.commit, 'lastSync');
    meta.put(p.tree, 'lastTree');
    meta.put(p.at, 'lastSyncAt');
    meta.put(p.etag, 'refEtag');
    await done(t);
  }

  // --- queue ------------------------------------------------------------

  /** All queued ops in queue order. */
  async queued(): Promise<QueuedOp[]> {
    const all = (await req(this.tx('queue', 'readonly').objectStore('queue').getAll())) as QueuedOp[];
    return all.sort((a, b) => a.seq - b.seq);
  }

  /**
   * Append one batch. Resolves only once it is durably stored, so the UI can
   * show an edit as saved only after this returns (plan §6).
   */
  async enqueue(ops: Omit<QueuedOp, 'seq'>[]): Promise<QueuedOp[]> {
    const existing = await this.queued();
    let seq = existing.length ? (existing[existing.length - 1]?.seq ?? 0) + 1 : 1;
    const withSeq = ops.map((o) => ({ ...o, seq: seq++ }));
    const t = this.tx('queue', 'readwrite');
    const q = t.objectStore('queue');
    for (const o of withSeq) q.put(o);
    await done(t);
    return withSeq;
  }

  /** Replace ops (conflict flags, or a resolved op) and delete others, in one transaction. */
  async updateQueue(put: QueuedOp[], remove: string[]): Promise<void> {
    const t = this.tx('queue', 'readwrite');
    const q = t.objectStore('queue');
    for (const o of put) q.put(o);
    for (const id of remove) q.delete(id);
    await done(t);
  }

  /**
   * Record a successful push in one transaction: the pushed files become the
   * new base, the sync position moves to the new commit, and the pushed or
   * redundant ops leave the queue. A crash either keeps everything queued
   * (and the next sync finds the ops redundant) or completes all of it.
   */
  async applyPush(p: { put: RepoFile[]; index: IndexEntry[]; commit: string; tree: string; removeOps: string[]; at: string }): Promise<void> {
    const t = this.tx(['files', 'index', 'meta', 'queue'], 'readwrite');
    const files = t.objectStore('files');
    for (const f of p.put) files.put(f);
    const idx = t.objectStore('index');
    for (const e of p.index) idx.put(e);
    const q = t.objectStore('queue');
    for (const id of p.removeOps) q.delete(id);
    const meta = t.objectStore('meta');
    meta.put(p.commit, 'lastSync');
    meta.put(p.tree, 'lastTree');
    meta.put(p.at, 'lastSyncAt');
    meta.put(null, 'refEtag'); // next check fetches the ref, sees our own commit, and stops there
    await done(t);
  }

  // --- forget -----------------------------------------------------------

  /** Settings → "Forget token and local data". */
  async forgetAll(): Promise<void> {
    const t = this.tx([...STORES], 'readwrite');
    for (const s of STORES) t.objectStore(s).clear();
    await done(t);
  }
}
