import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Store } from '../../src/store/db';

let n = 0;
const open = () => Store.open(indexedDB, `test-${++n}`);

describe('Store', () => {
  it('applies a pull atomically and reads it back', async () => {
    const s = await open();
    await s.applyPull({
      index: [
        { path: 'a.md', sha: '1' },
        { path: 'b.md', sha: '2' },
      ],
      put: [{ path: 'a.md', sha: '1', content: 'A' }],
      remove: [],
      commit: 'c1',
      tree: 't1',
      etag: '"c1"',
      at: '2026-09-30T00:00:00.000Z',
    });
    expect(await s.allFiles()).toEqual([{ path: 'a.md', sha: '1', content: 'A' }]);
    expect((await s.allIndex()).map((e) => e.path)).toEqual(['a.md', 'b.md']);
    expect(await s.getMeta('lastSync')).toBe('c1');
    expect(await s.getMeta('refEtag')).toBe('"c1"');
  });

  it('keeps the token in its own store and forgets everything on request', async () => {
    const s = await open();
    await s.setToken('secret');
    await s.setMeta('lastSync', 'c9');
    expect(await s.getToken()).toBe('secret');
    await s.forgetAll();
    expect(await s.getToken()).toBeUndefined();
    expect(await s.getMeta('lastSync')).toBeUndefined();
  });
});
