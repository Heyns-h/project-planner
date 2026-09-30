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
    meta.put(p.at, 'lastSyncAt');
    meta.put(p.etag, 'refEtag');
    await done(t);
  }

  // --- queue (Phase 1) --------------------------------------------------

  async queued(): Promise<QueuedOp[]> {
    return (await req(this.tx('queue', 'readonly').objectStore('queue').getAll())) as QueuedOp[];
  }

  // --- forget -----------------------------------------------------------

  /** Settings → "Forget token and local data". */
  async forgetAll(): Promise<void> {
    const t = this.tx([...STORES], 'readwrite');
    for (const s of STORES) t.objectStore(s).clear();
    await done(t);
  }
}
