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
