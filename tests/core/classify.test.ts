import { describe, expect, it } from 'vitest';
import { classify, isContentPath, stemOf } from '../../src/core/classify';
import { detectDomains, domainForPath } from '../../src/core/domains';

describe('classify', () => {
  it('downloads only planner, people and tag-list files', () => {
    expect(isContentPath('02-Example/07-planner/task-a.md')).toBe(true);
    expect(isContentPath('02-Example/06-people/someone.md')).toBe(true);
    expect(isContentPath('02-Example/_example-tags.md')).toBe(true);
    expect(isContentPath('02-Example/02-projects/x/_x-moc.md')).toBe(false);
    expect(isContentPath('_vault-guide.md')).toBe(false);
    expect(isContentPath('02-Example/07-planner/image.png')).toBe(false);
  });

  it('recognises nodes by planner_id and people by type', () => {
    expect(classify('a/07-planner/x.md', '---\nplanner_id: 01ABC\n---\n')).toBe('node');
    expect(classify('a/06-people/y.md', '---\ntype: person\n---\n')).toBe('person');
    expect(classify('a/_a-tags.md', '---\ntype: reference\n---\n')).toBe('tags');
    expect(classify('a/07-planner/z.md', '---\nplanner_id: ""\n---\n')).toBe('other');
  });

  it('takes the stem from the file name', () => {
    expect(stemOf('a/b/confirm-freight-quote.md')).toBe('confirm-freight-quote');
  });
});

describe('domains', () => {
  const paths = [
    '00-System/Tools/x.sh',
    '01-Alpha/_alpha-tags.md',
    '02-Beta-Two/07-planner/t.md',
    'README.md',
    '9-bad/x.md',
  ];

  it('are detected from numbered top-level folders, not hard-coded', () => {
    expect(detectDomains(paths)).toEqual([
      { id: 'system', folder: '00-System', label: 'System' },
      { id: 'alpha', folder: '01-Alpha', label: 'Alpha' },
      { id: 'beta-two', folder: '02-Beta-Two', label: 'Beta Two' },
    ]);
  });

  it('map a path to its domain', () => {
    const d = detectDomains(paths);
    expect(domainForPath('01-Alpha/07-planner/a.md', d)?.id).toBe('alpha');
    expect(domainForPath('README.md', d)).toBeNull();
  });
});
