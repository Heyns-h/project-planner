// The hub layout (blueprint v0.3 §4.1). The planner owns its repo shape:
//
//   nodes/<domain>/<stem>.md   planner notes, flat per domain
//   people/<stem>.md           one note per person
//   tags/<domain>.md           vocabulary table; a domain exists if its file exists
//   docs/                      blueprints and plans — never nodes, but link targets
//   tools/planner-check.sh     the rules of §4.8, runnable outside the app
//
// A node's place in the hierarchy comes from `parent`, never from the folder;
// the folder only records where the node was born. Files never move.

export const NODES = 'nodes';
export const PEOPLE = 'people';
export const TAGS = 'tags';
export const DOCS = 'docs';

const parts = (path: string) => path.split('/');
const isMd = (path: string) => path.endsWith('.md');

/** `nodes/<domain>/<stem>.md` */
export function isNodePath(path: string): boolean {
  const p = parts(path);
  return isMd(path) && p.length === 3 && p[0] === NODES && p[1] !== '' && p[2] !== '.md';
}

/** `people/<stem>.md` */
export function isPersonPath(path: string): boolean {
  const p = parts(path);
  return isMd(path) && p.length === 2 && p[0] === PEOPLE;
}

/** `tags/<domain>.md` */
export function isTagsPath(path: string): boolean {
  const p = parts(path);
  return isMd(path) && p.length === 2 && p[0] === TAGS;
}

/** `docs/**.md` — not nodes, but a `[[stem]]` may point at them. */
export function isDocPath(path: string): boolean {
  return isMd(path) && parts(path)[0] === DOCS && parts(path).length >= 2;
}

/** Files whose content the app downloads. Everything else is indexed by name only. */
export function isContentPath(path: string): boolean {
  return isNodePath(path) || isPersonPath(path) || isTagsPath(path);
}

/**
 * The link space (§4.8 rules 3 and 7): files a bare-stem link may resolve to,
 * and across which stems must be unique.
 */
export function isLinkTarget(path: string): boolean {
  return isNodePath(path) || isPersonPath(path) || isDocPath(path);
}

/** The domain a path belongs to by its folder, or null. People are flat and carry `domain:` themselves. */
export function domainOfPath(path: string): string | null {
  const p = parts(path);
  if (isNodePath(path)) return p[1] ?? null;
  if (isTagsPath(path)) return (p[1] ?? '').slice(0, -3) || null;
  return null;
}

export const nodeFolder = (domain: string): string => `${NODES}/${domain}`;
export const peopleFolder = (): string => PEOPLE;
export const tagsPath = (domain: string): string => `${TAGS}/${domain}.md`;
