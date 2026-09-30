import type { Stem } from './types';

// Kebab-case file names (vault guide §6), unique across the whole repo so a
// bare-stem wikilink always resolves. The name is fixed at creation and never
// changes; a title edit only touches aliases[0].

export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return s || 'untitled';
}

/** `base`, or `base-2`, `base-3` … whichever is not taken (case-insensitive). */
export function uniqueStem(title: string, taken: ReadonlySet<Stem>): Stem {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  const base = slugify(title);
  if (!lower.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!lower.has(candidate)) return candidate;
  }
}
