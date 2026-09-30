import { isSeq, Scalar, stringify, type Document } from 'yaml';
import { joinFrontmatter, parseFrontmatter } from './frontmatter';
import { formatLink } from './links';
import type { Domain, Field, PlannerType, Stem } from './types';

// All writes go through here (trial lesson 3): a field edit changes only the
// lines for that field, plus `updated` when the date moves on. New files are
// written in the fixed key order of blueprint §4.2 with empty values present.

/** Field → frontmatter key and value shape. */
const FIELDS: Record<Field, { key: string; kind: 'title' | 'text' | 'date' | 'link' | 'links' | 'list' }> = {
  title: { key: 'aliases', kind: 'title' },
  status: { key: 'status', kind: 'text' },
  parent: { key: 'parent', kind: 'link' },
  priority: { key: 'priority', kind: 'text' },
  owner: { key: 'owner', kind: 'link' },
  people: { key: 'people', kind: 'links' },
  tags: { key: 'tags', kind: 'list' },
  start: { key: 'start', kind: 'date' },
  due: { key: 'due', kind: 'date' },
  blockedBy: { key: 'blocked_by', kind: 'links' },
  relates: { key: 'relates', kind: 'links' },
  references: { key: 'references', kind: 'links' },
  drive: { key: 'drive', kind: 'list' },
};

export function fieldKey(field: Field): string {
  return FIELDS[field].key;
}

function scalar(value: string, type: Scalar.Type): Scalar {
  const s = new Scalar(value);
  s.type = type;
  return s;
}

const empty = () => scalar('', Scalar.QUOTE_DOUBLE);

function setField(doc: Document, field: Field, value: unknown): void {
  const { key, kind } = FIELDS[field];
  switch (kind) {
    case 'title': {
      const title = String(value ?? '').trim();
      const aliases = doc.get('aliases', true);
      if (isSeq(aliases) && aliases.items.length > 0) doc.setIn(['aliases', 0], title);
      else doc.set('aliases', doc.createNode([title]));
      return;
    }
    case 'text':
      doc.set(key, value === null || value === '' ? empty() : String(value));
      return;
    case 'date':
      doc.set(key, value ? scalar(String(value), Scalar.PLAIN) : empty());
      return;
    case 'link':
      doc.set(key, value ? scalar(formatLink(String(value)), Scalar.QUOTE_DOUBLE) : empty());
      return;
    case 'links': {
      const stems = Array.isArray(value) ? (value as Stem[]) : [];
      doc.set(key, doc.createNode(stems.map(formatLink), { flow: true }));
      return;
    }
    case 'list': {
      const items = Array.isArray(value) ? value.map(String) : [];
      doc.set(key, doc.createNode(items, { flow: true }));
      return;
    }
  }
}

export interface FieldEdit {
  field: Field;
  value: unknown;
}

/**
 * Apply field edits to a file. Returns the new content, or throws if the file
 * has no parseable frontmatter (such files are read-only).
 */
export function applyEdits(content: string, edits: readonly FieldEdit[], today: string, body?: string): string {
  const fm = parseFrontmatter(content);
  if (!fm.doc || fm.error) throw new Error('File has no parseable frontmatter');
  if (fm.conflictMarkers) throw new Error('File contains git conflict markers');
  for (const e of edits) setField(fm.doc, e.field, e.value);
  const current = fm.doc.get('updated');
  if (String(current ?? '') !== today) fm.doc.set('updated', scalar(today, Scalar.PLAIN));
  return joinFrontmatter(fm.doc, body ?? fm.body);
}

export interface NewNodeInput {
  id: string;
  plannerType: PlannerType;
  title: string;
  domain: Domain;
  parent: Stem | null;
  owner?: Stem | null;
  status?: string;
  priority?: string;
  tags?: string[];
  start?: string | null;
  due?: string | null;
  blockedBy?: Stem[];
  body?: string;
}

const q = (s: string) => JSON.stringify(s); // double-quoted YAML string
const linkOrEmpty = (s: Stem | null | undefined) => (s ? q(formatLink(s)) : '""');
const flowLinks = (list: Stem[] | undefined) => `[${(list ?? []).map((s) => q(formatLink(s))).join(', ')}]`;
/** One scalar, quoted only when YAML needs it (the library decides). */
const yamlScalar = (s: string) => stringify(s, { lineWidth: 0 }).trimEnd();
const flowList = (list: string[] | undefined) => `[${(list ?? []).map(yamlScalar).join(', ')}]`;

/** Full text of a new node file. Key order is blueprint §4.2. */
export function newNodeContent(n: NewNodeInput, today: string): string {
  const title = n.title.trim();
  const lines = [
    '---',
    `type: ${n.plannerType === 'project' ? 'project' : 'note'}`,
    `domain: ${n.domain}`,
    'project: ""',
    'version: ""',
    `status: ${n.status ?? 'idea'}`,
    `tags: ${flowList(n.tags)}`,
    `created: ${today}`,
    `updated: ${today}`,
    'aliases:',
    `  - ${yamlScalar(title)}`,
    `planner_id: ${n.id}`,
    `planner_type: ${n.plannerType}`,
    `parent: ${linkOrEmpty(n.parent)}`,
    `priority: ${n.priority ?? 'medium'}`,
    `owner: ${linkOrEmpty(n.owner)}`,
    'people: []',
    `start: ${n.start ?? '""'}`,
    `due: ${n.due ?? '""'}`,
    `blocked_by: ${flowLinks(n.blockedBy)}`,
    'relates: []',
    'references: []',
    'drive: []',
    '---',
    '',
  ];
  const body = n.body?.trim();
  return lines.join('\n') + (body ? `${body}\n` : '');
}

/** Folder for new nodes in a domain: `<domain folder>/07-planner/`. */
export function plannerFolder(domainFolder: string): string {
  return `${domainFolder}/07-planner`;
}
