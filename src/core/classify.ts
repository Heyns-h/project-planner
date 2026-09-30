import { parseFrontmatter } from './frontmatter';

// Light classification for Phase 0: which files are planner nodes, people or
// tag lists. Full parsing into PlannerNode arrives in step 1a (parse.ts).

export type FileKind = 'node' | 'person' | 'tags' | 'other';

/** Paths whose content the app downloads. Everything else is indexed by name only. */
export function isContentPath(path: string): boolean {
  if (!path.endsWith('.md')) return false;
  const parts = path.split('/');
  const name = parts[parts.length - 1] ?? '';
  if (/^_.+-tags\.md$/.test(name) && parts.length === 2) return true; // <domain>/_<domain>-tags.md
  return parts.some((p) => /^\d{2}-planner$/.test(p) || /^\d{2}-people$/.test(p));
}

export function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

export function classify(path: string, content: string): FileKind {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (/^_.+-tags\.md$/.test(name)) return 'tags';
  const { data } = parseFrontmatter(content);
  if (typeof data['planner_id'] === 'string' && data['planner_id'] !== '') return 'node';
  if (data['type'] === 'person') return 'person';
  return 'other';
}
