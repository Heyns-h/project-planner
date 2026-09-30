import type { StoredStatus } from './types';

// Files store the vault guide's status vocabulary; the UI shows planner labels.
// Blueprint v0.2 §4.3.

export interface StatusInfo {
  stored: StoredStatus;
  label: string;
  done: boolean; // counts towards progress
  inRollup: boolean; // archived is excluded from roll-up
}

export const STATUSES: readonly StatusInfo[] = [
  { stored: 'idea', label: 'Not started', done: false, inRollup: true },
  { stored: 'active', label: 'In progress', done: false, inRollup: true },
  { stored: 'on-hold', label: 'Blocked', done: false, inRollup: true },
  { stored: 'done', label: 'Done', done: true, inRollup: true },
  { stored: 'archived', label: 'Archived', done: false, inRollup: false },
];

const byStored = new Map(STATUSES.map((s) => [s.stored, s]));

export function isStoredStatus(value: unknown): value is StoredStatus {
  return typeof value === 'string' && byStored.has(value as StoredStatus);
}

export function statusInfo(status: StoredStatus): StatusInfo {
  const info = byStored.get(status);
  if (!info) throw new Error(`Unknown status: ${status}`);
  return info;
}

export function statusLabel(status: StoredStatus): string {
  return statusInfo(status).label;
}
