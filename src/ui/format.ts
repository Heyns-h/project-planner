import { isStoredStatus, statusLabel } from '../core/status';
import type { Field, Graph, PlannerType, Priority, StoredStatus } from '../core/types';

export const TYPE_LABEL: Record<PlannerType, string> = { project: 'Project', subproject: 'Sub-project', task: 'Task', subtask: 'Sub-task' };
export const TYPE_PLURAL: Record<PlannerType, string> = { project: 'Projects', subproject: 'Sub-projects', task: 'Tasks', subtask: 'Sub-tasks' };
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export { statusLabel };

export const FIELD_LABEL: Record<Field | 'body' | 'deleted', string> = {
  title: 'Title',
  status: 'Status',
  parent: 'Parent',
  priority: 'Priority',
  owner: 'Owner',
  people: 'People',
  tags: 'Tags',
  start: 'Start',
  due: 'Due',
  blockedBy: 'Blocked by',
  relates: 'Relates to',
  references: 'References',
  drive: 'Drive links',
  body: 'Notes',
  deleted: 'Item',
};

/** A field value as the user would see it in the Inspector: labels and titles, not stored tokens. */
export function formatValue(field: Field | 'body' | 'deleted', v: unknown, g: Graph): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return '(empty)';
  const name = (s: unknown) => {
    const stem = String(s);
    return g.nodes.get(g.byStem.get(stem) ?? '')?.title ?? g.people.get(stem)?.name ?? stem;
  };
  switch (field) {
    case 'status':
      return isStoredStatus(v) ? statusLabel(v) : String(v);
    case 'priority':
      return PRIORITY_LABEL[v as Priority] ?? String(v);
    case 'parent':
    case 'owner':
      return name(v);
    case 'people':
    case 'blockedBy':
    case 'relates':
    case 'references':
      return Array.isArray(v) ? v.map(name).join(', ') : name(v);
    case 'tags':
    case 'drive':
      return Array.isArray(v) ? v.map(String).join(', ') : String(v);
    default:
      return String(v);
  }
}

export const STATUS_CLASS: Record<StoredStatus, string> = {
  idea: 'st-idea',
  active: 'st-active',
  'on-hold': 'st-hold',
  done: 'st-done',
  archived: 'st-archived',
};

/** "2026-10-05" → "5 Oct" (this year) or "5 Oct 2027". Dates stay strings; no time zone shifts. */
export function shortDate(iso: string | null, today: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return today.startsWith(String(y)) ? `${d} ${month}` : `${d} ${month} ${y}`;
}

/** Only http(s) links are ever rendered as links; anything else stays text. */
export function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Stable per-device UI state (expanded rows, filters). Never synced; storage may be unavailable. */
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pl:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(`pl:${key}`, JSON.stringify(value));
  } catch {
    /* private mode or storage blocked: state is simply not remembered */
  }
}
