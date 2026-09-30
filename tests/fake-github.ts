import { gitBlobSha } from '../src/core/gitsha';
import type { FetchLike } from '../src/sync/github';

// In-memory stand-in for the GitHub endpoints the app uses: reads G1–G3 and
// writes G5, with ETag/304 (G8), truncated trees (G2), non-fast-forward
// rejection (G5a, answered here with 422), and rate limiting (429).

type Files = Map<string, string>; // path → blob sha

export class FakeGitHub {
  blobs = new Map<string, string>();
  trees = new Map<string, Files>();
  commits = new Map<string, { tree: string; parent: string | null; message: string }>();
  head: string | null = null;
  calls: string[] = [];
  forceTruncated = false;
  offline = false;
  /** Respond 429 to this many upcoming requests. */
  rateLimitNext = 0;
  /** Called just before a ref update is accepted; can land a competing commit. */
  beforeRefUpdate: (() => Promise<void>) | null = null;
  private seq = 0;

  private id(prefix: string): string {
    return `${prefix}${String(++this.seq).padStart(39, '0')}`;
  }

  private async putBlob(content: string): Promise<string> {
    const sha = await gitBlobSha(content);
    this.blobs.set(sha, content);
    return sha;
  }

  /** Commit a full snapshot directly (simulates another device, Claude, or a hand edit). */
  async commit(files: Record<string, string>, message = 'external'): Promise<string> {
    const map: Files = new Map();
    for (const [path, content] of Object.entries(files)) map.set(path, await this.putBlob(content));
    const tree = this.id('t');
    this.trees.set(tree, map);
    const sha = this.id('c');
    this.commits.set(sha, { tree, parent: this.head, message });
    this.head = sha;
    return sha;
  }

  /** Commit a change on top of head: set or delete some paths. */
  async commitChange(changes: Record<string, string | null>, message = 'external'): Promise<string> {
    const snapshot = this.snapshot();
    for (const [p, c] of Object.entries(changes)) {
      if (c === null) delete snapshot[p];
      else snapshot[p] = c;
    }
    return this.commit(snapshot, message);
  }

  /** Current head as path → content. */
  snapshot(): Record<string, string> {
    if (!this.head) return {};
    const c = this.commits.get(this.head);
    const files = c ? this.trees.get(c.tree) : undefined;
    return Object.fromEntries([...(files ?? [])].map(([p, sha]) => [p, this.blobs.get(sha) ?? '']));
  }

  headMessage(): string {
    return this.head ? (this.commits.get(this.head)?.message ?? '') : '';
  }

  private listing(files: Files, tree: string, prefix: string, recursive: boolean) {
    const out: { path: string; mode: string; type: 'blob' | 'tree'; sha: string }[] = [];
    const dirs = new Set<string>();
    for (const [path, sha] of files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const parts = rest.split('/');
      if (recursive) {
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
        out.push({ path: rest, mode: '100644', type: 'blob', sha });
      } else if (parts.length === 1) {
        out.push({ path: rest, mode: '100644', type: 'blob', sha });
      } else {
        dirs.add(parts[0] as string);
      }
    }
    for (const d of dirs) out.push({ path: d, mode: '040000', type: 'tree', sha: `sub:${tree}:${prefix}${d}/` });
    return out;
  }

  fetch: FetchLike = async (input, init) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(input);
    const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    this.calls.push(`${method} ${path}${url.search}`);
    if (this.rateLimitNext > 0) {
      this.rateLimitNext--;
      return json(429, { message: 'API rate limit exceeded' }, { 'retry-after': '0' });
    }
    if (!headers.get('Authorization')?.startsWith('Bearer ') || headers.get('Authorization') === 'Bearer ') {
      return json(401, { message: 'Bad credentials' });
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    let m: RegExpMatchArray | null;

    // G1 read ref / G5 update ref
    if ((m = path.match(/^\/git\/refs?\/heads\/(.+)$/))) {
      if (method === 'PATCH') {
        if (this.beforeRefUpdate) {
          const hook = this.beforeRefUpdate;
          this.beforeRefUpdate = null;
          await hook();
        }
        const target = String(body['sha']);
        const c = this.commits.get(target);
        if (!c) return json(422, { message: 'Object does not exist' });
        if (body['force'] !== false) return json(400, { message: 'test fake requires force: false' });
        if (c.parent !== this.head) return json(422, { message: 'Update is not a fast forward' });
        this.head = target;
        return json(200, { object: { sha: target } });
      }
      if (!this.head) return json(404, { message: 'Not Found' });
      const etag = `"${this.head}"`;
      if (headers.get('If-None-Match') === etag) return new Response(null, { status: 304 });
      return json(200, { ref: `refs/heads/${m[1]}`, object: { type: 'commit', sha: this.head } }, { etag });
    }
    // commits
    if (path === '/git/commits' && method === 'POST') {
      const tree = String(body['tree']);
      if (!this.trees.has(tree)) return json(422, { message: 'Tree does not exist' });
      const parents = body['parents'] as string[];
      const sha = this.id('c');
      this.commits.set(sha, { tree, parent: parents[0] ?? null, message: String(body['message']) });
      return json(201, { sha });
    }
    if ((m = path.match(/^\/git\/commits\/(\w+)$/))) {
      const c = this.commits.get(m[1] ?? '');
      return c ? json(200, { sha: m[1], tree: { sha: c.tree } }) : json(404, { message: 'Not Found' });
    }
    // trees
    if (path === '/git/trees' && method === 'POST') {
      const base = this.trees.get(String(body['base_tree']));
      if (!base) return json(422, { message: 'base_tree does not exist' });
      const next: Files = new Map(base);
      for (const e of body['tree'] as { path: string; sha?: string | null; content?: string }[]) {
        if (e.path.startsWith('.github/')) return json(403, { message: 'workflow permission required' });
        if (e.sha === null) {
          if (!next.has(e.path)) return json(422, { message: 'cannot delete missing file' });
          next.delete(e.path);
        } else if (typeof e.content === 'string') {
          next.set(e.path, await this.putBlob(e.content));
        }
      }
      const sha = this.id('t');
      this.trees.set(sha, next);
      return json(201, { sha, tree: [], truncated: false });
    }
    if ((m = path.match(/^\/git\/trees\/(.+)$/))) {
      const id = decodeURIComponent(m[1] ?? '');
      const recursive = url.searchParams.has('recursive');
      let tree = id;
      let prefix = '';
      if (id.startsWith('sub:')) [, tree = '', prefix = ''] = id.split(':');
      const files = this.trees.get(tree);
      if (!files) return json(404, { message: 'Not Found' });
      if (recursive && this.forceTruncated) return json(200, { tree: [], truncated: true });
      return json(200, { tree: this.listing(files, tree, prefix, recursive), truncated: false });
    }
    // blobs
    if ((m = path.match(/^\/git\/blobs\/(\w+)$/))) {
      const content = this.blobs.get(m[1] ?? '');
      return content === undefined ? json(404, { message: 'Not Found' }) : new Response(content, { status: 200 });
    }
    return json(404, { message: 'Not Found' });
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
