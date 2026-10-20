import { describe, expect, it } from 'vitest';
import { classify, isContentPath, stemOf } from '../../src/core/classify';
import { detectDomains, domainForPath } from '../../src/core/domains';
import { domainOfPath, isDocPath, isLinkTarget, isNodePath, nodeFolder, tagsPath } from '../../src/core/hub';

// The hub layout (blueprint v0.3 §4.1).

describe('hub paths', () => {
  it('downloads only nodes, people and tag lists', () => {
    expect(isContentPath('nodes/alpha/task-a.md')).toBe(true);
    expect(isContentPath('people/someone.md')).toBe(true);
    expect(isContentPath('tags/alpha.md')).toBe(true);
    expect(isContentPath('docs/project-planner-blueprint-v0-3.md')).toBe(false);
    expect(isContentPath('README.md')).toBe(false);
    expect(isContentPath('nodes/alpha/image.png')).toBe(false);
    expect(isContentPath('nodes/deep/er/x.md')).toBe(false); // nodes are flat per domain
  });

  it('knows the link space: nodes, people and docs', () => {
    expect(isLinkTarget('nodes/alpha/a.md')).toBe(true);
    expect(isLinkTarget('people/p.md')).toBe(true);
    expect(isLinkTarget('docs/plan.md')).toBe(true);
    expect(isLinkTarget('docs/old/plan.md')).toBe(true);
    expect(isLinkTarget('tags/alpha.md')).toBe(false);
    expect(isLinkTarget('README.md')).toBe(false);
    expect(isDocPath('docs/x.md')).toBe(true);
    expect(isNodePath('nodes/alpha/x.md')).toBe(true);
  });

  it('reads a domain from node and tag paths, not from people', () => {
    expect(domainOfPath('nodes/alpha/x.md')).toBe('alpha');
    expect(domainOfPath('tags/beta.md')).toBe('beta');
    expect(domainOfPath('people/x.md')).toBeNull();
    expect(nodeFolder('alpha')).toBe('nodes/alpha');
    expect(tagsPath('alpha')).toBe('tags/alpha.md');
  });

  it('recognises nodes by planner_id and people by type', () => {
    expect(classify('nodes/a/x.md', '---\nplanner_id: 01ABC\n---\n')).toBe('node');
    expect(classify('people/y.md', '---\ntype: person\n---\n')).toBe('person');
    expect(classify('tags/a.md', '---\ntype: reference\n---\n')).toBe('tags');
    expect(classify('nodes/a/z.md', '---\nplanner_id: ""\n---\n')).toBe('other');
  });

  it('takes the stem from the file name', () => {
    expect(stemOf('a/b/confirm-freight-quote.md')).toBe('confirm-freight-quote');
  });
});

describe('domains', () => {
  const files = [
    { path: 'tags/beta-two.md', sha: 'x', content: '---\naliases:\n  - Beta Two\n---\n' },
    { path: 'tags/alpha.md', sha: 'x', content: '---\naliases: []\n---\n' },
    { path: 'nodes/alpha/t.md', sha: 'x', content: '---\nplanner_id: X\n---\n' },
    { path: 'README.md', sha: 'x', content: '' },
  ];

  it('are the tag files, labelled by aliases[0] or the stem', () => {
    expect(detectDomains(files)).toEqual([
      { id: 'alpha', folder: 'nodes/alpha', label: 'Alpha' },
      { id: 'beta-two', folder: 'nodes/beta-two', label: 'Beta Two' },
    ]);
  });

  it('map a path to its domain', () => {
    const d = detectDomains(files);
    expect(domainForPath('nodes/alpha/a.md', d)?.id).toBe('alpha');
    expect(domainForPath('people/a.md', d)).toBeNull();
    expect(domainForPath('README.md', d)).toBeNull();
  });
});
