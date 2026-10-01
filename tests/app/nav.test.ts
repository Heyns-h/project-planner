import { describe, expect, it } from 'vitest';
import { hashFor, parseHash, shouldPush } from '../../src/app/nav';

// Plan Phase 2 §6: hash ↔ root round trip, unknown or empty hash is the top
// level, and the no-push-when-unchanged rule.

describe('nav', () => {
  it('round-trips a root through the hash', () => {
    expect(hashFor(null)).toBe('#/');
    expect(hashFor('hive')).toBe('#/hive');
    expect(parseHash(hashFor('hive'))).toBe('hive');
    expect(parseHash(hashFor(null))).toBeNull();
  });

  it('treats an empty or malformed hash as the top level', () => {
    for (const h of ['', '#', '#/', '#//', '#?x=1']) expect(parseHash(h)).toBeNull();
  });

  it('decodes what it encoded, and ignores anything after the stem', () => {
    expect(parseHash(hashFor('odd stem/with slash'))).toBe('odd stem/with slash');
    expect(parseHash('#/hive/extra?y')).toBe('hive');
  });

  it('pushes only when the root actually changes', () => {
    expect(shouldPush(null, 'hive')).toBe(true);
    expect(shouldPush('hive', null)).toBe(true);
    expect(shouldPush('hive', 'hive')).toBe(false);
    expect(shouldPush(null, null)).toBe(false);
  });
});
