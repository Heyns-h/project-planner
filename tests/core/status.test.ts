import { describe, expect, it } from 'vitest';
import { isStoredStatus, STATUSES, statusInfo, statusLabel } from '../../src/core/status';

describe('status mapping (blueprint §4.3)', () => {
  it('stores only the vault guide vocabulary', () => {
    expect(STATUSES.map((s) => s.stored)).toEqual(['idea', 'active', 'on-hold', 'done', 'archived']);
  });

  it('shows planner labels', () => {
    expect(statusLabel('idea')).toBe('Not started');
    expect(statusLabel('active')).toBe('In progress');
    expect(statusLabel('on-hold')).toBe('Blocked');
  });

  it('counts only done as done, and leaves archived out of roll-up', () => {
    expect(STATUSES.filter((s) => s.done).map((s) => s.stored)).toEqual(['done']);
    expect(statusInfo('archived').inRollup).toBe(false);
  });

  it('rejects dotpm-style and unknown values', () => {
    for (const v of ['todo', 'in-progress', 'blocked', 'review', '', null, 3]) {
      expect(isStoredStatus(v)).toBe(false);
    }
    expect(isStoredStatus('on-hold')).toBe(true);
  });
});
