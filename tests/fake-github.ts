import { gitBlobSha } from '../src/core/gitsha';
import type { FetchLike } from '../src/sync/github';

// In-memory stand-in for the GitHub endpoints the app uses (G1–G3; push
// endpoints G5 arrive with step 1c). Trees are flat: one root tree whose
// recursive listing is the whole repo, optionally forced to report truncation.

interface Commit {
  sha: string;
  tree: string;
  files: Map<string, string>; // path → blob sha
}

export class FakeGitHub {
  blobs = new Map<string, string>();
  commits = new Map<string, Commit>();
  head: string | null = null;
  calls: string[] = [];
  forceTruncated = false;
  offline = false;
  private seq = 0;

  async commit(files: Record<string, string>): Promise<string> {
    const map = new Map<string, string>();
    for (const [path, content] of Object.entries(files)) {
      const sha = await gitBlobSha(content);
      this.blobs.set(sha, content);
      map.set(path, sha);
    }
    const n = ++this.seq;
    const sha = `c${String(n).padStart(39, '0')}`;
    this.commits.set(sha, { sha, tree: `t${String(n).padStart(39, '0')}`, files: map });
    this.head = sha;
    return sha;
  }

  private treeEntries(c: Commit, prefix: string, recursive: boolean) {
    const out: { path: string; mode: string; type: 'blob' | 'tree'; sha: string }[] = [];
    const dirs = new Set<string>();
    for (const [path, sha] of c.files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (recursive) {
        const parts = rest.split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
        out.push({ path: rest, mode: '100644', type: 'blob', sha });
      } else if (slash === -1) {
        out.push({ path: rest, mode: '100644', type: 'blob', sha });
      } else {
        dirs.add(rest.slice(0, slash));
      }
    }
    for (const d of dirs) out.push({ path: d, mode: '040000', type: 'tree', sha: `tree:${c.sha}:${prefix}${d}/` });
    return out;
  }

  fetch: FetchLike = async (input, init) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(input);
    const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    const headers = new Headers(init?.headers);
    this.calls.push(`${init?.method ?? 'GET'} ${path}${url.search}`);
    if (!headers.get('Authorization')?.startsWith('Bearer ')) return json(401, { message: 'Bad credentials' });

    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      if (!this.head) return json(404, { message: 'Not Found' });
      const etag = `"${this.head}"`;
      if (headers.get('If-None-Match') === etag) return new Response(null, { status: 304 });
      return json(200, { ref: `refs/heads/${m[1]}`, object: { type: 'commit', sha: this.head } }, { etag });
    }
    if ((m = path.match(/^\/git\/commits\/(\w+)$/))) {
      const c = this.commits.get(m[1] ?? '');
      return c ? json(200, { sha: c.sha, tree: { sha: c.tree } }) : json(404, { message: 'Not Found' });
    }
    if ((m = path.match(/^\/git\/trees\/(.+)$/))) {
      const id = decodeURIComponent(m[1] ?? '');
      const recursive = url.searchParams.has('recursive');
      let commit: Commit | undefined;
      let prefix = '';
      if (id.startsWith('tree:')) {
        const [, csha, pre] = id.split(':');
        commit = this.commits.get(csha ?? '');
        prefix = pre ?? '';
      } else {
        commit = [...this.commits.values()].find((c) => c.tree === id);
      }
      if (!commit) return json(404, { message: 'Not Found' });
      if (recursive && this.forceTruncated) return json(200, { tree: [], truncated: true });
      return json(200, { tree: this.treeEntries(commit, prefix, recursive), truncated: false });
    }
    if ((m = path.match(/^\/git\/blobs\/(\w+)$/))) {
      const content = this.blobs.get(m[1] ?? '');
      return content === undefined ? json(404, { message: 'Not Found' }) : new Response(content, { status: 200 });
    }
    return json(404, { message: 'Not Found' });
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
