import type { Stem } from './types';

// Wikilinks in frontmatter are always bare stems: "[[stem]]", optionally with
// display text "[[stem|Text]]". Paths are never written (trial lesson 4), but
// a path someone typed by hand is read by its last segment.

const LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;

export function parseLink(value: unknown): Stem | null {
  if (typeof value !== 'string') return null;
  const m = LINK.exec(value.trim());
  if (!m?.[1]) return null;
  const target = m[1].trim();
  const last = target.slice(target.lastIndexOf('/') + 1);
  return last.endsWith('.md') ? last.slice(0, -3) : last;
}

export function parseLinkList(value: unknown): { stems: Stem[]; bad: unknown[] } {
  const items = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value];
  const stems: Stem[] = [];
  const bad: unknown[] = [];
  for (const item of items) {
    const s = parseLink(item);
    if (s) stems.push(s);
    else bad.push(item);
  }
  return { stems, bad };
}

export function formatLink(stem: Stem): string {
  return `[[${stem}]]`;
}
