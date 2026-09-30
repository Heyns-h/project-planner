// Minimal GitHub REST client: only the endpoints in blueprint §8
// (verification G1–G9). The token is sent as a Bearer header and never logged.

export const API = 'https://api.github.com';
export const API_VERSION = '2026-03-10'; // supported on api.github.com; changes nothing we use (G12)

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
  /** 401: token missing, wrong, expired or revoked. */
  get unauthorized(): boolean {
    return this.status === 401;
  }
  /** 403/429 with a rate-limit signal. */
  get rateLimited(): boolean {
    return this.status === 429 || (this.status === 403 && this.retryAfter !== null);
  }
}

export class OfflineError extends Error {
  constructor(cause: unknown) {
    super('Network unavailable');
    this.name = 'OfflineError';
    this.cause = cause;
  }
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GitHub {
  constructor(
    private readonly token: string,
    readonly owner: string,
    readonly repo: string,
    private readonly fetchFn: FetchLike = (i, init) => fetch(i, init),
  ) {}

  private url(path: string): string {
    return `${API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${path}`;
  }

  private async call(path: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('Accept', init.accept ?? 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', API_VERSION);
    let res: Response;
    try {
      res = await this.fetchFn(this.url(path), { ...init, headers, cache: 'no-store' });
    } catch (e) {
      throw new OfflineError(e);
    }
    if (res.status === 304 || res.ok) return res;
    const ra = res.headers.get('retry-after');
    const reset = res.headers.get('x-ratelimit-remaining') === '0' ? res.headers.get('x-ratelimit-reset') : null;
    const retryAfter = ra ? Number(ra) : reset ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000)) : null;
    let msg = `GitHub ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) msg += `: ${body.message}`;
    } catch {
      /* no body */
    }
    throw new GitHubError(msg, res.status, retryAfter);
  }

  /** G1. Returns null when the ETag still matches (304 — free against the hourly limit, G8). */
  async getRef(branch: string, etag: string | null): Promise<{ sha: string; etag: string | null } | null> {
    const headers: Record<string, string> = {};
    if (etag) headers['If-None-Match'] = etag;
    const res = await this.call(`/git/ref/heads/${encodeURIComponent(branch)}`, { headers });
    if (res.status === 304) return null;
    const body = (await res.json()) as { object: { sha: string } };
    return { sha: body.object.sha, etag: res.headers.get('etag') };
  }

  /** Commit → its root tree sha. */
  async getCommitTree(commitSha: string): Promise<string> {
    const res = await this.call(`/git/commits/${commitSha}`);
    const body = (await res.json()) as { tree: { sha: string } };
    return body.tree.sha;
  }

  /** G2. Recursive tree; `truncated` past 100,000 entries or 7 MB. */
  async getTree(treeSha: string, recursive: boolean): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const res = await this.call(`/git/trees/${treeSha}${recursive ? '?recursive=1' : ''}`);
    const body = (await res.json()) as { tree: TreeEntry[]; truncated: boolean };
    return { entries: body.tree, truncated: body.truncated };
  }

  /** G3. Raw blob as UTF-8 text. */
  async getBlobText(sha: string): Promise<string> {
    const res = await this.call(`/git/blobs/${sha}`, { accept: 'application/vnd.github.raw+json' });
    return await res.text();
  }

  // --- writes: three requests per push (G5, G8) --------------------------

  private async send<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
    const res = await this.call(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  /** New tree on top of `baseTree`, with contents inline (no separate blob calls). */
  async createTree(baseTree: string, writes: readonly TreeWrite[]): Promise<{ sha: string; entries: TreeEntry[] }> {
    if (writes.some((w) => w.path.startsWith('.github/'))) throw new Error('The planner never writes under .github/'); // G6
    const tree = writes.map((w) =>
      w.content === null
        ? { path: w.path, mode: '100644', type: 'blob', sha: null }
        : { path: w.path, mode: '100644', type: 'blob', content: w.content },
    );
    const body = await this.send<{ sha: string; tree: TreeEntry[] }>('POST', '/git/trees', { base_tree: baseTree, tree });
    return { sha: body.sha, entries: body.tree ?? [] };
  }

  async createCommit(message: string, tree: string, parent: string): Promise<string> {
    const body = await this.send<{ sha: string }>('POST', '/git/commits', { message, tree, parents: [parent] });
    return body.sha;
  }

  /**
   * Move the branch to `sha` without force. If someone pushed in between,
   * GitHub answers 409 or 422 (the exact code is undocumented, G5a):
   * reported as `BranchMovedError`.
   */
  async updateRef(branch: string, sha: string): Promise<void> {
    try {
      await this.send('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false });
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) throw new BranchMovedError(e.message);
      throw e;
    }
  }
}

export class BranchMovedError extends Error {
  constructor(detail: string) {
    super(`Branch moved during push (${detail})`);
    this.name = 'BranchMovedError';
  }
}

export interface TreeWrite {
  path: string;
  content: string | null; // null deletes the file (G5)
}

/** All blob paths under a tree, walking sub-trees when the recursive listing is truncated (G2). */
export async function listAllBlobs(gh: GitHub, rootTree: string): Promise<TreeEntry[]> {
  const first = await gh.getTree(rootTree, true);
  if (!first.truncated) return first.entries.filter((e) => e.type === 'blob');
  const out: TreeEntry[] = [];
  const walk = async (sha: string, prefix: string): Promise<void> => {
    const { entries } = await gh.getTree(sha, false);
    for (const e of entries) {
      const path = prefix ? `${prefix}/${e.path}` : e.path;
      if (e.type === 'blob') out.push({ ...e, path });
      else if (e.type === 'tree') await walk(e.sha, path);
    }
  };
  await walk(rootTree, '');
  return out;
}
