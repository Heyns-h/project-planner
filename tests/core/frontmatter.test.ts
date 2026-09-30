import { describe, expect, it } from 'vitest';
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '../../src/core/frontmatter';

const NOTE = `---
type: note
domain: example
project: ""
version: ""
status: idea
tags: []
created: 2026-09-25
updated: 2026-09-30
aliases:
  - Confirm freight quote
planner_id: 01J8Z6K2Q4ABCDEFGHJKMNPQRS
parent: "[[sourcing-q4-range]]"
blocked_by: ["[[place-po]]"]
due: 2026-10-05
---

Body text.
`;

describe('frontmatter', () => {
  it('splits fences and keeps the body exactly', () => {
    const s = splitFrontmatter(NOTE);
    expect(s.yaml?.startsWith('type: note\n')).toBe(true);
    expect(s.body).toBe('\nBody text.\n');
    expect(s.conflictMarkers).toBe(false);
  });

  it('keeps dates as strings (YAML 1.2 core schema, L4)', () => {
    const { data } = parseFrontmatter(NOTE);
    expect(data['created']).toBe('2026-09-25');
    expect(data['due']).toBe('2026-10-05');
  });

  it('round-trips unchanged, and a one-field edit is a one-line diff', () => {
    const p = parseFrontmatter(NOTE);
    expect(joinFrontmatter(p.doc!, p.body)).toBe(NOTE);
    p.doc!.set('status', 'active');
    const out = joinFrontmatter(p.doc!, p.body).split('\n');
    const before = NOTE.split('\n');
    expect(out.length).toBe(before.length);
    expect(before.filter((line, i) => line !== out[i])).toEqual(['status: idea']);
    expect(out).toContain('blocked_by: ["[[place-po]]"]');
  });

  it('handles no frontmatter, unterminated frontmatter and bad YAML', () => {
    expect(parseFrontmatter('Just text').data).toEqual({});
    expect(splitFrontmatter('---\ntype: x\nno close').yaml).toBeNull();
    expect(parseFrontmatter('---\na: [\n---\n').error).not.toBeNull();
  });

  it('detects git conflict markers', () => {
    const c = '---\ntype: note\n---\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> origin/main\n';
    expect(parseFrontmatter(c).conflictMarkers).toBe(true);
  });
});
