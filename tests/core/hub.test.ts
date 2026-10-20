import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/core/graph';
import { checkOp, replay } from '../../src/core/ops';
import { homeProblem, nodeKeys, parseNode } from '../../src/core/parse';
import { applyEdits, newNodeContent } from '../../src/core/serialize';
import type { Op, QueuedOp } from '../../src/core/types';
import { DOMAINS, FILES, indexPaths, nodeText, repoFiles } from '../fixtures/repo';

// Blueprint v0.3 §4.2, §4.7 and §4.8 as implemented in Phase 2½.

const A = 'nodes/alpha/';
const graph = (extra: Record<string, string> = {}, index: string[] = []) => buildGraph(repoFiles(extra), [...indexPaths(extra), ...index], DOMAINS);
const problems = (g: ReturnType<typeof graph>, id: string) => g.nodes.get(id)!.problems.map((p) => `${p.code}:${p.field ?? ''}`);

describe('home keys (v0.3 §4.7)', () => {
  it('exist on project nodes only, in order after drive', () => {
    expect(nodeKeys('project').slice(-3)).toEqual(['drive', 'repo', 'folder']);
    expect(nodeKeys('task')).not.toContain('repo');
    const project = newNodeContent({ id: 'P', plannerType: 'project', title: 'Home', domain: 'alpha', parent: null, repo: 'owner/name' }, '2026-10-20');
    expect(project).toContain('drive: []\nrepo: "owner/name"\nfolder: ""\n---');
    const task = newNodeContent({ id: 'T', plannerType: 'task', title: 'No home', domain: 'alpha', parent: 'campaign' }, '2026-10-20');
    expect(task).not.toContain('repo:');
  });

  it('are parsed on projects, validated, and flagged on other types', () => {
    const g = graph({
      [A + 'homed.md']: nodeText({ id: 'H1', type: 'project', title: 'Homed', domain: 'alpha', repo: 'Heyns-h/example', folder: 'Example' }),
      [A + 'badhome.md']: nodeText({ id: 'H2', type: 'project', title: 'Bad home', domain: 'alpha', repo: 'not a repo', folder: 'C:\\\\Users\\\\x' }),
      [A + 'task-home.md']: nodeText({ id: 'H3', type: 'task', title: 'Task home', domain: 'alpha', parent: 'hive' }).replace('drive: []', 'drive: []\nrepo: "a/b"'),
    });
    expect(g.nodes.get('H1')).toMatchObject({ repo: 'Heyns-h/example', folder: 'Example' });
    expect(problems(g, 'H1')).toEqual([]);
    expect(problems(g, 'H2')).toEqual(['bad-value:repo', 'bad-value:folder']);
    expect(problems(g, 'H3')).toEqual(['bad-value:repo']);
    expect(g.nodes.get('H3')?.repo).toBeNull();
    expect(homeProblem('repo', 'owner/name')).toBeNull();
    expect(homeProblem('folder', 'nested/name')).toMatch(/not a path/);
  });

  it('a pre-v0.3 project gains both keys, in order, on the first edit of either', () => {
    const old = FILES[A + 'campaign.md']!.replace(/repo: ""\nfolder: ""\n/, '');
    expect(old).not.toContain('repo:');
    const out = applyEdits(old, [{ field: 'folder', value: 'Campaign' }], '2026-10-20');
    expect(out).toContain('drive: []\nrepo: ""\nfolder: "Campaign"\n---'); // home values are double-quoted, as the writer does for new projects
  });

  it('checkOp refuses a home on a task and a malformed repo on a project', () => {
    const g = graph();
    expect(checkOp(g, { kind: 'set', nodeId: 'N3', field: 'repo', from: null, to: 'a/b' })).toMatch(/Only a project/);
    expect(checkOp(g, { kind: 'set', nodeId: 'N1', field: 'repo', from: null, to: 'nope' })).toMatch(/owner\/name/);
    expect(checkOp(g, { kind: 'set', nodeId: 'N1', field: 'repo', from: null, to: 'owner/name' })).toBeNull();
  });
});

describe('rules (v0.3 §4.8)', () => {
  it('rule 1: keys present and in order', () => {
    const shuffled = nodeText({ id: 'K1', type: 'task', title: 'Shuffled', domain: 'alpha', parent: 'hive' }).replace('priority: medium\nowner: ""\n', 'owner: ""\npriority: medium\n');
    const g = graph({ [A + 'shuffled.md']: shuffled });
    expect(problems(g, 'K1')).toEqual(['key-order:']);
    const missing = nodeText({ id: 'K2', type: 'task', title: 'Missing', domain: 'alpha', parent: 'hive' }).replace('relates: []\n', '');
    expect(problems(graph({ [A + 'missing.md']: missing }), 'K2')).toEqual(['missing-key:relates']);
  });

  it('rule 2: the stored domain must have a tag file', () => {
    const g = graph({ [A + 'stray.md']: nodeText({ id: 'D1', type: 'project', title: 'Stray', domain: 'gamma' }) });
    expect(problems(g, 'D1')).toEqual(['bad-value:domain']);
  });

  it('rule 3 and the link space: links resolve to nodes, people or docs; not to README', () => {
    const g = graph({ [A + 'linky.md']: nodeText({ id: 'L1', type: 'task', title: 'Linky', domain: 'alpha', parent: 'hive', references: ['some-reference', 'README'] }) });
    expect(problems(g, 'L1')).toEqual(['unresolved-link:references']);
    expect(g.allStems.has('some-reference')).toBe(true);
    expect(g.allStems.has('README')).toBe(false);
  });

  it('rule 4: a task under a task is allowed with a warning', () => {
    const g = graph();
    expect(problems(g, 'N5')).toEqual(['hierarchy:parent']); // buy glue under build terrain
  });

  it('rule 5: a tag outside the vocabulary is flagged', () => {
    const g = graph({ [A + 'tagged.md']: nodeText({ id: 'T1', type: 'task', title: 'Tagged', domain: 'alpha', parent: 'hive', tags: ['painting', 'nope'] }) });
    expect(problems(g, 'T1')).toEqual(['bad-value:tags']);
  });

  it('rule 7: a stem shared with docs/ is flagged as ambiguous', () => {
    const g = graph({}, ['docs/hive.md']);
    expect(problems(g, 'N2')).toContain('duplicate-stem:');
  });
});

describe('effective domain (v0.3 §4.1)', () => {
  it('is the root project\u2019s stored domain, and governs tags and cross-domain links', () => {
    // Move Hive (alpha) under Q4 sourcing (beta): its stored domain stays alpha, its effective domain is beta.
    const moved = FILES[A + 'hive.md']!.replace('parent: "[[campaign]]"', 'parent: "[[q4-sourcing]]"');
    const g = graph({ [A + 'hive.md']: moved });
    expect(g.nodes.get('N2')).toMatchObject({ domain: 'alpha', effectiveDomain: 'beta' });
    expect(g.nodes.get('N3')).toMatchObject({ domain: 'alpha', effectiveDomain: 'beta' });
    // Paint gangers carries tag `painting`, which is alpha vocabulary: now flagged against beta's list.
    expect(problems(g, 'N3')).toContain('bad-value:tags');
    expect(checkOp(g, { kind: 'set', nodeId: 'N3', field: 'tags', from: ['painting'], to: ['freight'] })).toBeNull();
  });

  it('a new node is born in its parent\u2019s effective domain folder', () => {
    const base = new Map(Object.entries(FILES));
    const op: Op = { kind: 'create', node: { id: 'NEW', plannerType: 'task', title: 'New', domain: 'beta', parent: 'confirm-quote' }, path: 'nodes/beta/new.md' };
    const q: QueuedOp[] = [{ opId: 'c-0', batchId: 'c', summary: 's', op, at: '', device: 'd', seq: 1 }];
    const r = replay(base, q, { domains: DOMAINS, allStems: new Set(), today: '2026-10-20' });
    expect(r.files.get('nodes/beta/new.md')).toContain('domain: beta');
  });
});
