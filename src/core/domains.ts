import { parseFrontmatter } from './frontmatter';
import { domainOfPath, isTagsPath, nodeFolder } from './hub';
import type { DomainDef, RepoFile } from './types';

// Domains are the files in `tags/` (blueprint v0.3 §4.1): the file stem is
// the id, its `aliases[0]` the display label, falling back to the stem with
// its first letter raised. Nothing about a particular repo is hard-coded.

export function detectDomains(files: Iterable<RepoFile>): DomainDef[] {
  const out: DomainDef[] = [];
  for (const f of files) {
    if (!isTagsPath(f.path)) continue;
    const id = domainOfPath(f.path);
    if (!id) continue;
    const aliases = parseFrontmatter(f.content).data['aliases'];
    const first = Array.isArray(aliases) ? aliases[0] : aliases;
    const label = typeof first === 'string' && first.trim() ? first.trim() : id.charAt(0).toUpperCase() + id.slice(1);
    out.push({ id, folder: nodeFolder(id), label });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** The domain a path belongs to by its folder (nodes and tag lists), or null. */
export function domainForPath(path: string, domains: readonly DomainDef[]): DomainDef | null {
  const id = domainOfPath(path);
  return id ? domains.find((d) => d.id === id) ?? null : null;
}
