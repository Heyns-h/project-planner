// Domain tag lists live in `<domain>/_<domain>-tags.md` as a markdown table
// under a "Vocabulary" heading; the first column holds the tag in backticks.
// Placeholder rows ("—") are ignored.

export function parseTagTable(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s+vocabulary\s*$/i.test(l.trim()));
  if (start === -1) return [];
  const tags: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const t = line.trim();
    if (/^#{1,6}\s/.test(t)) break; // next heading ends the section
    if (!t.startsWith('|')) continue;
    const first = t.split('|')[1]?.trim() ?? '';
    const m = /^`([^`]+)`$/.exec(first);
    if (m?.[1]) tags.push(m[1].trim());
  }
  return [...new Set(tags)];
}
