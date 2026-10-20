import { stemOf } from './classify';
import { domainForPath } from './domains';
import { parseFrontmatter } from './frontmatter';
import { domainOfPath, isTagsPath } from './hub';
import { parseLink, parseLinkList } from './links';
import { isStoredStatus } from './status';
import { parseTagTable } from './tags';
import type { DomainDef, Person, PlannerNode, PlannerType, Priority, Problem, RepoFile, TagList } from './types';
import { PLANNER_TYPES } from './types';

// File → typed record. Parsing never throws: anything wrong becomes a Problem
// on the node, and a node with errors that would make a write unsafe is marked
// read-only. Graph-level checks (links, hierarchy, cycles, uniqueness) live in
// validate.ts. The shape is blueprint v0.3 §4.2; the rules are §4.8.

/** The nine common keys, kept from the vault era for shape compatibility. */
export const GUIDE_KEYS = ['type', 'domain', 'project', 'version', 'status', 'tags', 'created', 'updated', 'aliases'] as const;
/** The planner block, in order (v0.3 §4.2). */
export const PLANNER_KEYS = ['planner_id', 'planner_type', 'parent', 'priority', 'owner', 'people', 'start', 'due', 'blocked_by', 'relates', 'references', 'drive'] as const;
/** Project home keys: on project nodes only (v0.3 §4.7). */
export const HOME_KEYS = ['repo', 'folder'] as const;

/** Every key a node of this type carries, in order (§4.8 rule 1). */
export function nodeKeys(plannerType: PlannerType): string[] {
  return [...GUIDE_KEYS, ...PLANNER_KEYS, ...(plannerType === 'project' ? HOME_KEYS : [])];
}

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const REPO_FORMAT = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const FOLDER_FORMAT = /^[^/\\]+$/; // a name, never a path

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number') return String(v);
  return null;
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter((x): x is string => x !== null);
  const s = str(v);
  return s ? [s] : [];
}

function date(v: unknown, field: string, problems: Problem[]): string | null {
  const s = str(v);
  if (s === null) return null;
  if (!DATE.test(s)) problems.push({ code: 'bad-value', severity: 'warning', field, message: `${field} should be YYYY-MM-DD, found "${s}"` });
  return s;
}

/** Rule 6: `repo` is owner/name; `folder` is a name with no separator or drive letter. */
export function homeProblem(field: 'repo' | 'folder', value: string): string | null {
  if (field === 'repo') return REPO_FORMAT.test(value) ? null : `repo should be owner/name, found "${value}"`;
  if (!FOLDER_FORMAT.test(value) || /^[A-Za-z]:/.test(value)) return `folder is a folder name, not a path: "${value}"`;
  return null;
}

export function parseNode(file: RepoFile, domains: readonly DomainDef[]): PlannerNode | null {
  const fm = parseFrontmatter(file.content);
  const d = fm.data;
  const id = str(d['planner_id']);
  if (!id) return null;

  const problems: Problem[] = [];
  if (fm.conflictMarkers) problems.push({ code: 'conflict-markers', severity: 'error', message: 'The file contains git conflict markers. Fix it in the repo; it is read-only here until then.' });
  if (fm.error) problems.push({ code: 'unparseable', severity: 'error', message: `Frontmatter cannot be parsed: ${fm.error}` });

  const rawType = str(d['planner_type']);
  let plannerType: PlannerType = 'task';
  if (rawType && (PLANNER_TYPES as readonly string[]).includes(rawType)) plannerType = rawType as PlannerType;
  else problems.push({ code: 'bad-value', severity: 'warning', field: 'planner_type', message: `planner_type "${rawType ?? ''}" is not project, subproject, task or subtask; treated as task` });

  // Rule 1: every key for the type, in order, no title:.
  const expected = nodeKeys(plannerType);
  for (const k of expected) {
    if (!(k in d)) problems.push({ code: 'missing-key', severity: 'warning', field: k, message: `Missing key "${k}"` });
  }
  const present = Object.keys(d).filter((k) => expected.includes(k));
  const inOrder = expected.filter((k) => present.includes(k));
  if (present.join('\n') !== inOrder.join('\n')) problems.push({ code: 'key-order', severity: 'warning', message: 'Frontmatter keys are not in the order of blueprint v0.3 §4.2' });
  if ('title' in d) problems.push({ code: 'title-key', severity: 'warning', field: 'title', message: 'Has a title: key; the display title is aliases[0]' });
  if (plannerType !== 'project') {
    for (const k of HOME_KEYS) if (k in d) problems.push({ code: 'bad-value', severity: 'warning', field: k, message: `${k} belongs on project nodes only` });
  }

  const rawStatus = d['status'];
  const status = isStoredStatus(rawStatus) ? rawStatus : 'idea';
  if (!isStoredStatus(rawStatus)) problems.push({ code: 'bad-value', severity: 'warning', field: 'status', message: `status "${String(rawStatus ?? '')}" is not one of idea, active, on-hold, done, archived; shown as not started` });

  const rawPriority = str(d['priority']);
  const priority: Priority = rawPriority && (PRIORITIES as readonly string[]).includes(rawPriority) ? (rawPriority as Priority) : 'medium';
  if (rawPriority && priority !== rawPriority) problems.push({ code: 'bad-value', severity: 'warning', field: 'priority', message: `priority "${rawPriority}" is not low, medium or high` });

  const links = (field: string) => {
    const { stems, bad } = parseLinkList(d[field]);
    for (const b of bad) problems.push({ code: 'bad-value', severity: 'warning', field, message: `${field} entry ${JSON.stringify(b)} is not a [[wikilink]]` });
    return stems;
  };
  const single = (field: string): string | null => {
    const v = d[field];
    if (str(v) === null) return null;
    const s = parseLink(v);
    if (!s) problems.push({ code: 'bad-value', severity: 'warning', field, message: `${field} ${JSON.stringify(v)} is not a [[wikilink]]` });
    return s;
  };
  const home = (field: 'repo' | 'folder'): string | null => {
    if (plannerType !== 'project') return null;
    const v = str(d[field]);
    if (v === null) return null;
    const msg = homeProblem(field, v);
    if (msg) problems.push({ code: 'bad-value', severity: 'warning', field, message: msg });
    return v;
  };

  const stem = stemOf(file.path);
  const aliases = strList(d['aliases']);
  const domain = str(d['domain']) ?? domainForPath(file.path, domains)?.id ?? domainOfPath(file.path) ?? '';

  return {
    id,
    path: file.path,
    stem,
    title: aliases[0] ?? stem,
    plannerType,
    domain,
    effectiveDomain: domain, // refined by graph.ts from the root project
    status,
    parent: single('parent'),
    priority,
    owner: single('owner'),
    people: links('people'),
    tags: strList(d['tags']),
    start: date(d['start'], 'start', problems),
    due: date(d['due'], 'due', problems),
    blockedBy: links('blocked_by'),
    relates: links('relates'),
    references: links('references'),
    drive: strList(d['drive']),
    repo: home('repo'),
    folder: home('folder'),
    created: str(d['created']) ?? '',
    updated: str(d['updated']) ?? '',
    body: fm.body,
    problems,
    readOnly: problems.some((p) => p.severity === 'error'),
  };
}

export function parsePerson(file: RepoFile, _domains: readonly DomainDef[]): Person | null {
  const { data } = parseFrontmatter(file.content);
  if (data['type'] !== 'person') return null;
  const stem = stemOf(file.path);
  return {
    stem,
    path: file.path,
    name: strList(data['aliases'])[0] ?? stem,
    domain: str(data['domain']) ?? '',
  };
}

/** `tags/<domain>.md`: the domain is the file stem; the body holds the Vocabulary table. */
export function parseTagList(file: RepoFile, _domains: readonly DomainDef[]): TagList | null {
  if (!isTagsPath(file.path)) return null;
  const domain = domainOfPath(file.path);
  if (!domain) return null;
  const { body } = parseFrontmatter(file.content);
  return { domain, path: file.path, tags: parseTagTable(body) };
}
