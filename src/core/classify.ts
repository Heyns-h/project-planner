import { parseFrontmatter } from './frontmatter';
import { isContentPath as hubContentPath, isTagsPath } from './hub';

// Light classification: which files are planner nodes, people or tag lists.
// Paths follow the hub layout (hub.ts); content decides node vs person.

export type FileKind = 'node' | 'person' | 'tags' | 'other';

/** Paths whose content the app downloads. Everything else is indexed by name only. */
export const isContentPath = hubContentPath;

export function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

export function classify(path: string, content: string): FileKind {
  if (isTagsPath(path)) return 'tags';
  const { data } = parseFrontmatter(content);
  if (typeof data['planner_id'] === 'string' && data['planner_id'] !== '') return 'node';
  if (data['type'] === 'person') return 'person';
  return 'other';
}
