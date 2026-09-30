import { classify } from '../core/classify';
import { detectDomains, domainForPath } from '../core/domains';
import type { DomainDef, RepoConfig } from '../core/types';
import { Store } from '../store/db';
import { pull } from '../sync/engine';
import { GitHub, GitHubError, OfflineError } from '../sync/github';

// Framework-free session: owns the store, the GitHub client and the sync state.
// The UI subscribes and renders snapshots.

export type SyncStatus =
  | { s: 'idle' }
  | { s: 'pulling' }
  | { s: 'offline' }
  | { s: 'unauthorized' }
  | { s: 'rate-limited'; retryAt: string }
  | { s: 'error'; message: string };

export interface DomainCount {
  domain: DomainDef;
  nodes: number;
}

export interface Snapshot {
  ready: boolean; // store opened and config loaded
  config: RepoConfig | null;
  status: SyncStatus;
  lastSyncAt: string | null;
  lastCommit: string | null;
  persisted: boolean | null;
  counts: {
    nodes: number;
    byDomain: DomainCount[];
    unassigned: number; // nodes outside any known domain folder
    people: number;
    tagLists: number;
    notesIndexed: number;
    readOnly: number; // files with git conflict markers
  };
}

const EMPTY_COUNTS: Snapshot['counts'] = {
  nodes: 0,
  byDomain: [],
  unassigned: 0,
  people: 0,
  tagLists: 0,
  notesIndexed: 0,
  readOnly: 0,
};

export class Session {
  private store: Store | null = null;
  private gh: GitHub | null = null;
  private listeners = new Set<(s: Snapshot) => void>();
  private busy = false;
  private snap: Snapshot = {
    ready: false,
    config: null,
    status: { s: 'idle' },
    lastSyncAt: null,
    lastCommit: null,
    persisted: null,
    counts: EMPTY_COUNTS,
  };

  get snapshot(): Snapshot {
    return this.snap;
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn(this.snap);
  }

  async open(): Promise<void> {
    this.store = await Store.open();
    const config = (await this.store.getMeta('config')) ?? null;
    const token = await this.store.getToken();
    if (config && token) this.gh = new GitHub(token, config.owner, config.repo);
    this.set({
      ready: true,
      config,
      persisted: (await this.store.getMeta('persisted')) ?? null,
    });
    await this.refreshCounts();
  }

  /** Setup: check the token and repo with one request before saving anything. */
  async connect(config: Omit<RepoConfig, 'domains'>, token: string): Promise<void> {
    if (!this.store) throw new Error('Session not open');
    const gh = new GitHub(token, config.owner, config.repo);
    try {
      await gh.getRef(config.branch, null);
    } catch (e) {
      throw new Error(describeError(e, config));
    }
    await this.store.forgetAll(); // a new repo or token starts clean
    await this.store.setToken(token);
    const full: RepoConfig = { ...config, domains: [] };
    await this.store.setMeta('config', full);
    this.gh = gh;
    this.set({ config: full, lastCommit: null, lastSyncAt: null, counts: EMPTY_COUNTS });
    await this.requestPersistence();
    await this.sync();
  }

  private async requestPersistence(): Promise<void> {
    if (!this.store || !navigator.storage?.persist) return;
    // Chrome grants or refuses silently; never guaranteed (verification B4).
    const persisted = await navigator.storage.persist().catch(() => false);
    await this.store.setMeta('persisted', persisted);
    this.set({ persisted });
  }

  async sync(): Promise<void> {
    const { store, gh } = this;
    const config = this.snap.config;
    if (!store || !gh || !config || this.busy) return;
    if (this.snap.status.s === 'rate-limited' && Date.parse(this.snap.status.retryAt) > Date.now()) return;
    this.busy = true;
    this.set({ status: { s: 'pulling' } });
    try {
      const r = await pull(gh, store, config.branch);
      if (r.changed) {
        if (config.domains.length === 0) {
          const domains = detectDomains((await store.allIndex()).map((e) => e.path));
          const updated = { ...config, domains };
          await store.setMeta('config', updated);
          this.set({ config: updated });
        }
        await this.refreshCounts();
      }
      this.set({ status: { s: 'idle' }, lastSyncAt: (await store.getMeta('lastSyncAt')) ?? null });
    } catch (e) {
      this.set({ status: statusFor(e) });
    } finally {
      this.busy = false;
    }
  }

  private async refreshCounts(): Promise<void> {
    const store = this.store;
    const config = this.snap.config;
    if (!store || !config) return;
    const [files, index] = await Promise.all([store.allFiles(), store.allIndex()]);
    const byDomain = new Map<string, number>(config.domains.map((d) => [d.id, 0]));
    const counts = { ...EMPTY_COUNTS, notesIndexed: index.length };
    for (const f of files) {
      const kind = classify(f.path, f.content);
      if (/^(<{7}|>{7}) /m.test(f.content)) counts.readOnly++;
      if (kind === 'node') {
        counts.nodes++;
        const d = domainForPath(f.path, config.domains);
        if (d) byDomain.set(d.id, (byDomain.get(d.id) ?? 0) + 1);
        else counts.unassigned++;
      } else if (kind === 'person') counts.people++;
      else if (kind === 'tags') counts.tagLists++;
    }
    counts.byDomain = config.domains
      .map((domain) => ({ domain, nodes: byDomain.get(domain.id) ?? 0 }))
      .filter((d) => d.nodes > 0);
    this.set({
      counts,
      lastCommit: (await store.getMeta('lastSync')) ?? null,
      lastSyncAt: (await store.getMeta('lastSyncAt')) ?? null,
    });
  }

  async forget(): Promise<void> {
    await this.store?.forgetAll();
    this.gh = null;
    this.set({ config: null, lastCommit: null, lastSyncAt: null, persisted: null, counts: EMPTY_COUNTS, status: { s: 'idle' } });
  }
}

function statusFor(e: unknown): SyncStatus {
  if (e instanceof OfflineError) return { s: 'offline' };
  if (e instanceof GitHubError) {
    if (e.unauthorized) return { s: 'unauthorized' };
    if (e.rateLimited) {
      return { s: 'rate-limited', retryAt: new Date(Date.now() + (e.retryAfter ?? 60) * 1000).toISOString() };
    }
    return { s: 'error', message: e.message };
  }
  return { s: 'error', message: e instanceof Error ? e.message : String(e) };
}

function describeError(e: unknown, c: { owner: string; repo: string; branch: string }): string {
  if (e instanceof OfflineError) return 'No connection. Setup needs to reach GitHub once.';
  if (e instanceof GitHubError) {
    if (e.status === 401) return 'GitHub did not accept the token. Check it was copied completely and has not expired.';
    if (e.status === 404 || e.status === 403) {
      return `Cannot see ${c.owner}/${c.repo} branch "${c.branch}". Check the names, and that the token was given access to this repository.`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

