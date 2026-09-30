import { monotonicFactory } from 'ulid';
import { stemOf } from '../core/classify';
import { detectDomains } from '../core/domains';
import { buildGraph, nodeByStem } from '../core/graph';
import { checkOp, fieldValue, replay, sameValue } from '../core/ops';
import { computeRollups, type Rollup } from '../core/rollup';
import { peopleFolder, plannerFolder } from '../core/serialize';
import { uniqueStem } from '../core/slug';
import type { Domain, DomainDef, Field, Graph, NewNode, Op, QueuedOp, RepoConfig, Stem } from '../core/types';
import { Store } from '../store/db';
import { sync } from '../sync/engine';
import { GitHub, GitHubError, OfflineError } from '../sync/github';

// Framework-free session: owns the store, the GitHub client, the queue and
// the working view (repo content as last pulled + queued edits, blueprint
// §8). The UI subscribes and renders snapshots; every edit goes through the
// action methods here, which check it, queue it durably, and schedule a sync.

export type SyncStatus =
  | { s: 'idle' }
  | { s: 'syncing' }
  | { s: 'offline' }
  | { s: 'unauthorized' }
  | { s: 'rate-limited'; retryAt: string }
  | { s: 'error'; message: string };

export interface Snapshot {
  ready: boolean;
  config: RepoConfig | null;
  status: SyncStatus;
  lastSyncAt: string | null;
  lastCommit: string | null;
  persisted: boolean | null;
  graph: Graph;
  rollups: Map<string, Rollup>;
  /** Every note name in the repo, for link pickers. */
  noteStems: Stem[];
  pending: number; // queued ops not yet pushed
  conflicts: QueuedOp[]; // queued ops waiting for a decision
  pendingNodes: Set<string>; // node ids with unpushed edits
  today: string;
}

const AFTER_EDIT_MS = 10_000; // blueprint §8.3: sync about 10 s after an edit
const newId = monotonicFactory();

const emptyGraph = (): Graph => ({
  nodes: new Map(),
  byStem: new Map(),
  children: new Map(),
  blocks: new Map(),
  people: new Map(),
  tags: new Map(),
  allStems: new Set(),
});

export class Session {
  private store: Store | null = null;
  private gh: GitHub | null = null;
  private listeners = new Set<(s: Snapshot) => void>();
  private busy = false;
  private again = false;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private snap: Snapshot = {
    ready: false,
    config: null,
    status: { s: 'idle' },
    lastSyncAt: null,
    lastCommit: null,
    persisted: null,
    graph: emptyGraph(),
    rollups: new Map(),
    noteStems: [],
    pending: 0,
    conflicts: [],
    pendingNodes: new Set(),
    today: localToday(),
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
    this.set({ ready: true, config, persisted: (await this.store.getMeta('persisted')) ?? null });
    await this.rebuild();
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
    this.set({ config: full, lastCommit: null, lastSyncAt: null });
    await this.requestPersistence();
    await this.sync();
  }

  /**
   * Replace an expired or rejected token for the same repository. Checked
   * with one request first; local data and queued edits are kept.
   */
  async replaceToken(token: string, tokenExpires: string | null): Promise<void> {
    const store = this.store;
    const config = this.snap.config;
    if (!store || !config) throw new Error('Not connected');
    const gh = new GitHub(token, config.owner, config.repo);
    try {
      await gh.getRef(config.branch, null);
    } catch (e) {
      throw new Error(describeError(e, config));
    }
    await store.setToken(token);
    const updated = { ...config, tokenExpires };
    await store.setMeta('config', updated);
    this.gh = gh;
    this.set({ config: updated, status: { s: 'idle' } });
    await this.sync();
  }

  private async requestPersistence(): Promise<void> {
    if (!this.store || !navigator.storage?.persist) return;
    // Chrome grants or refuses silently; never guaranteed (verification B4).
    const persisted = await navigator.storage.persist().catch(() => false);
    await this.store.setMeta('persisted', persisted);
    this.set({ persisted });
  }

  // --- sync ---------------------------------------------------------------

  /**
   * `auto` syncs (timer, focus, online) stop after the token is rejected, so a
   * bad or expired token is not retried every 30 s; the Sync button still tries.
   */
  async sync(opts: { auto?: boolean } = {}): Promise<void> {
    if (opts.auto && this.snap.status.s === 'unauthorized') return;
    const { store, gh } = this;
    const config = this.snap.config;
    if (!store || !gh || !config) return;
    if (this.busy) {
      this.again = true; // an edit arrived mid-sync: run once more afterwards
      return;
    }
    if (this.snap.status.s === 'rate-limited' && Date.parse(this.snap.status.retryAt) > Date.now()) return;
    this.busy = true;
    this.set({ status: { s: 'syncing' } });
    try {
      const r = await sync(gh, store, { branch: config.branch, device: config.device, domains: config.domains, today: localToday });
      if (config.domains.length === 0 && r.pulled.changed) {
        const updated = { ...config, domains: detectDomains((await store.allIndex()).map((e) => e.path)) };
        await store.setMeta('config', updated);
        this.set({ config: updated });
      }
      this.set({ status: { s: 'idle' } });
    } catch (e) {
      this.set({ status: statusFor(e) });
    } finally {
      this.busy = false;
      await this.rebuild();
    }
    if (this.again) {
      this.again = false;
      void this.sync();
    }
  }

  private scheduleSync(): void {
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      void this.sync({ auto: true });
    }, AFTER_EDIT_MS);
  }

  /** Recompute the working view: pulled files + queued ops → graph and roll-ups. */
  private async rebuild(): Promise<void> {
    const store = this.store;
    const config = this.snap.config;
    if (!store) return;
    const [files, index, queue] = await Promise.all([store.allFiles(), store.allIndex(), store.queued()]);
    const domains = config?.domains ?? [];
    const base = new Map(files.map((f) => [f.path, f.content]));
    const indexPaths = index.map((e) => e.path);
    const r = replay(base, queue, { domains, allStems: new Set(indexPaths.map(stemOf)), today: localToday() });
    const working = [...r.files].map(([path, content]) => ({ path, sha: '', content }));
    const graph = buildGraph(working, [...indexPaths, ...r.files.keys()], domains);
    const today = localToday();
    const pendingNodes = new Set<string>();
    for (const q of queue) {
      if ('nodeId' in q.op) pendingNodes.add(q.op.nodeId);
      if (q.op.kind === 'create') pendingNodes.add(q.op.node.id);
    }
    this.set({
      graph,
      rollups: computeRollups(graph, today),
      noteStems: [...graph.allStems].sort(),
      pending: queue.length,
      conflicts: queue.filter((q) => q.conflict),
      pendingNodes,
      today,
      lastCommit: (await store.getMeta('lastSync')) ?? null,
      lastSyncAt: (await store.getMeta('lastSyncAt')) ?? null,
    });
  }

  // --- edits ----------------------------------------------------------------

  /** Queue one user action (a batch of ops). Returns an error message, or null when saved. */
  private async act(summary: string, ops: Op[]): Promise<string | null> {
    const store = this.store;
    const config = this.snap.config;
    if (!store || !config) return 'Not connected.';
    for (const op of ops) {
      const err = checkOp(this.snap.graph, op);
      if (err) return err;
    }
    const batchId = newId();
    await store.enqueue(ops.map((op, i) => ({ opId: `${batchId}-${i}`, batchId, summary, op, at: new Date().toISOString(), device: config.device })));
    await this.rebuild();
    this.scheduleSync();
    return null;
  }

  /** Change one field. No-op when the value is unchanged. */
  async setField(nodeId: string, field: Field, to: unknown): Promise<string | null> {
    const n = this.snap.graph.nodes.get(nodeId);
    if (!n) return 'That item no longer exists.';
    const from = fieldValue(n, field);
    if (sameValue(from, to)) return null;
    return this.act(`edit '${n.title}' (${field})`, [{ kind: 'set', nodeId, field, from, to }]);
  }

  async setBody(nodeId: string, to: string): Promise<string | null> {
    const n = this.snap.graph.nodes.get(nodeId);
    if (!n) return 'That item no longer exists.';
    if (n.body === to) return null;
    return this.act(`edit '${n.title}' (notes)`, [{ kind: 'body', nodeId, from: n.body, to }]);
  }

  private domainDef(id: Domain): DomainDef | undefined {
    return this.snap.config?.domains.find((d) => d.id === id);
  }

  private takenStems(): Set<Stem> {
    return new Set(this.snap.graph.allStems);
  }

  /** Quick add (blueprint §6). Domain follows the parent's root; a new top-level project names its own. */
  async createNode(input: Omit<NewNode, 'id' | 'domain'> & { domain?: Domain }): Promise<{ error: string | null; id?: string }> {
    const g = this.snap.graph;
    const parent = input.parent ? nodeByStem(g, input.parent) : undefined;
    if (input.parent && !parent) return { error: 'The parent must be a planner item.' };
    const domain = parent?.domain ?? input.domain;
    if (!domain) return { error: 'Choose a domain for a top-level project.' };
    const def = this.domainDef(domain);
    if (!def) return { error: `Unknown domain "${domain}".` };
    const id = newId();
    const stem = uniqueStem(input.title, this.takenStems());
    const node: NewNode = { ...input, id, domain };
    const error = await this.act(`add '${input.title.trim()}'`, [{ kind: 'create', node, path: `${plannerFolder(def.folder)}/${stem}.md` }]);
    return error ? { error } : { error: null, id };
  }

  async createPerson(name: string, domain: Domain): Promise<{ error: string | null; stem?: Stem }> {
    const def = this.domainDef(domain);
    if (!def) return { error: `Unknown domain "${domain}".` };
    const stem = uniqueStem(name, this.takenStems());
    const error = await this.act(`add person '${name.trim()}'`, [{ kind: 'createPerson', person: { name, domain }, path: `${peopleFolder(def.folder)}/${stem}.md` }]);
    return error ? { error } : { error: null, stem };
  }

  async forget(): Promise<void> {
    await this.store?.forgetAll();
    this.gh = null;
    this.set({ config: null, lastCommit: null, lastSyncAt: null, persisted: null, status: { s: 'idle' } });
    await this.rebuild();
  }
}

/** Today's date in the device's time zone, YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function statusFor(e: unknown): SyncStatus {
  if (e instanceof OfflineError) return { s: 'offline' };
  if (e instanceof GitHubError) {
    if (e.unauthorized) return { s: 'unauthorized' };
    if (e.rateLimited) return { s: 'rate-limited', retryAt: new Date(Date.now() + (e.retryAfter ?? 60) * 1000).toISOString() };
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
