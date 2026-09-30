import { statusLabel } from '../core/status';
import type { PlannerType, Priority, StoredStatus } from '../core/types';

export const TYPE_LABEL: Record<PlannerType, string> = { project: 'Project', subproject: 'Sub-project', task: 'Task' };
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export { statusLabel };

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
