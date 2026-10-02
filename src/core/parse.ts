import { stemOf } from './classify';
import { domainForPath } from './domains';
import { parseFrontmatter } from './frontmatter';
import { parseLink, parseLinkList } from './links';
import { isStoredStatus } from './status';
import { parseTagTable } from './tags';
import type { DomainDef, Person, PlannerNode, PlannerType, Priority, Problem, RepoFile, TagList } from './types';
import { PLANNER_TYPES } from './types';

// File → typed record. Parsing never throws: anything wrong becomes a Problem
// on the node, and a node with errors that would make a write unsafe is marked
// read-only. Graph-level checks (links, hierarchy, cycles) live in validate.ts.

/** The vault guide's nine keys (vault-check.sh check 3). */
export const GUIDE_KEYS = ['type', 'domain', 'project', 'version', 'status', 'tags', 'created', 'updated', 'aliases'] as const;

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

export function parseNode(file: RepoFile, domains: readonly DomainDef[]): PlannerNode | null {
  const fm = parseFrontmatter(file.content);
  const d = fm.data;
  const id = str(d['planner_id']);
  if (!id) return null;

  const problems: Problem[] = [];
  if (fm.conflictMarkers) problems.push({ code: 'conflict-markers', severity: 'error', message: 'The file contains git conflict markers. Fix it in the repo; it is read-only here until then.' });
  if (fm.error) problems.push({ code: 'unparseable', severity: 'error', message: `Frontmatter cannot be parsed: ${fm.error}` });
  for (const k of GUIDE_KEYS) {
    if (!(k in d)) problems.push({ code: 'missing-key', severity: 'warning', field: k, message: `Missing required key "${k}"` });
  }
  if ('title' in d) problems.push({ code: 'title-key', severity: 'warning', field: 'title', message: 'Has a title: key; the vault uses aliases[0] instead' });

  const rawType = str(d['planner_type']);
  let plannerType: PlannerType = 'task';
  if (rawType && (PLANNER_TYPES as readonly string[]).includes(rawType)) plannerType = rawType as PlannerType;
  else problems.push({ code: 'bad-value', severity: 'warning', field: 'planner_type', message: `planner_type "${rawType ?? ''}" is not project, subproject, task or subtask; treated as task` });

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

  const stem = stemOf(file.path);
  const aliases = strList(d['aliases']);
  const folderDomain = domainForPath(file.path, domains)?.id ?? null;

  return {
    id,
    path: file.path,
    stem,
    title: aliases[0] ?? stem,
    plannerType,
    domain: str(d['domain']) ?? folderDomain ?? '',
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
    created: str(d['created']) ?? '',
    updated: str(d['updated']) ?? '',
    body: fm.body,
    problems,
    readOnly: problems.some((p) => p.severity === 'error'),
  };
}

export function parsePerson(file: RepoFile, domains: readonly DomainDef[]): Person | null {
  const { data } = parseFrontmatter(file.content);
  if (data['type'] !== 'person') return null;
  const stem = stemOf(file.path);
  return {
    stem,
    path: file.path,
    name: strList(data['aliases'])[0] ?? stem,
    domain: str(data['domain']) ?? domainForPath(file.path, domains)?.id ?? '',
  };
}

export function parseTagList(file: RepoFile, domains: readonly DomainDef[]): TagList | null {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  if (!/^_.+-tags\.md$/.test(name)) return null;
  const { data, body } = parseFrontmatter(file.content);
  const domain = str(data['domain']) ?? domainForPath(file.path, domains)?.id;
  if (!domain) return null;
  return { domain, path: file.path, tags: parseTagTable(body) };
}
