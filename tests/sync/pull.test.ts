import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/store/db';
import { GitHub, GitHubError, OfflineError } from '../../src/sync/github';
import { pull } from '../../src/sync/engine';
import { FakeGitHub } from '../fake-github';

const NODE = (id: string) => `---\nplanner_id: ${id}\n---\n`;
const BASE = {
  '01-Alpha/07-planner/a.md': NODE('A'),
  '01-Alpha/07-planner/b.md': NODE('B'),
  '01-Alpha/_alpha-tags.md': '---\ntype: reference\n---\n',
  '01-Alpha/02-projects/p/_p-moc.md': '---\ntype: moc\n---\n',
  'README.md': '# readme',
};

let n = 0;
let fake: FakeGitHub;
let store: Store;
let gh: GitHub;

beforeEach(async () => {
  fake = new FakeGitHub();
  store = await Store.open(indexedDB, `pull-${++n}`);
  gh = new GitHub('tok', 'owner', 'repo', fake.fetch);
  await fake.commit(BASE);
});

describe('pull (blueprint §8.2)', () => {
  it('first pull downloads only planner/people/tag files and indexes every .md', async () => {
    const r = await pull(gh, store, 'main');
    expect(r).toMatchObject({ changed: true, fetched: 3, removed: 0 });
    expect((await store.allFiles()).map((f) => f.path).sort()).toEqual([
      '01-Alpha/07-planner/a.md',
      '01-Alpha/07-planner/b.md',
      '01-Alpha/_alpha-tags.md',
    ]);
    expect((await store.allIndex()).length).toBe(5);
  });

  it('an unchanged branch costs one conditional request (304)', async () => {
    await pull(gh, store, 'main');
    fake.calls = [];
    const r = await pull(gh, store, 'main');
    expect(r.changed).toBe(false);
    expect(fake.calls).toEqual(['GET /git/ref/heads/main']);
  });

  it('later pulls fetch only changed blobs and drop deleted files', async () => {
    await pull(gh, store, 'main');
    const next: Record<string, string> = { ...BASE, '01-Alpha/07-planner/a.md': NODE('A') + 'edited\n' };
    delete next['01-Alpha/07-planner/b.md'];
    await fake.commit(next);
    fake.calls = [];
    const r = await pull(gh, store, 'main');
    expect(r).toMatchObject({ changed: true, fetched: 1, removed: 1 });
    expect(fake.calls.filter((c) => c.includes('/git/blobs/')).length).toBe(1);
    const a = (await store.allFiles()).find((f) => f.path.endsWith('a.md'));
    expect(a?.content).toContain('edited');
  });

  it('walks sub-trees when the recursive tree is truncated (G2)', async () => {
    fake.forceTruncated = true;
    const r = await pull(gh, store, 'main');
    expect(r.fetched).toBe(3);
    expect((await store.allIndex()).length).toBe(5);
  });

  it('reports offline and bad tokens distinctly, leaving the cache untouched', async () => {
    await pull(gh, store, 'main');
    fake.offline = true;
    await expect(pull(gh, store, 'main')).rejects.toBeInstanceOf(OfflineError);
    fake.offline = false;
    const bad = new GitHub('', 'owner', 'repo', fake.fetch);
    const err: unknown = await pull(bad, store, 'main').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).unauthorized).toBe(true);
    expect((await store.allFiles()).length).toBe(3);
  });
});
