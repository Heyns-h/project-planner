import { parseDocument, type Document } from 'yaml';

// Frontmatter handling. The yaml Document keeps key order, quoting and flow
// style of untouched nodes; always stringify with STRINGIFY_OPTIONS or flow
// lists get reformatted on every write (verification L4). The default YAML 1.2
// schema keeps dates as strings; never switch to 1.1.

export const STRINGIFY_OPTIONS = { flowCollectionPadding: false } as const;

export interface SplitFile {
  /** Raw YAML between the fences, without the fences. Null when there is no frontmatter. */
  yaml: string | null;
  /** Everything after the closing fence, exactly as in the file. */
  body: string;
  /** Git conflict markers anywhere in the file. */
  conflictMarkers: boolean;
}

const CONFLICT = /^(<{7}|={7}|>{7})( |$)/m;

export function splitFrontmatter(content: string): SplitFile {
  const conflictMarkers = CONFLICT.test(content);
  const text = content.startsWith('﻿') ? content.slice(1) : content;
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { yaml: null, body: text, conflictMarkers };
  }
  const start = text.indexOf('\n') + 1;
  const close = /^---[ \t]*\r?$/m;
  const rest = text.slice(start);
  const m = close.exec(rest);
  if (!m) return { yaml: null, body: text, conflictMarkers };
  const yaml = rest.slice(0, m.index);
  let after = rest.slice(m.index + m[0].length);
  if (after.startsWith('\r\n')) after = after.slice(2);
  else if (after.startsWith('\n')) after = after.slice(1);
  return { yaml, body: after, conflictMarkers };
}

export interface ParsedFrontmatter {
  doc: Document | null;
  /** Plain JS view of the frontmatter; empty when missing or unparseable. */
  data: Record<string, unknown>;
  body: string;
  conflictMarkers: boolean;
  error: string | null;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const split = splitFrontmatter(content);
  if (split.yaml === null) {
    return { doc: null, data: {}, body: split.body, conflictMarkers: split.conflictMarkers, error: null };
  }
  const doc = parseDocument(split.yaml);
  if (doc.errors.length > 0) {
    return {
      doc: null,
      data: {},
      body: split.body,
      conflictMarkers: split.conflictMarkers,
      error: doc.errors[0]?.message ?? 'YAML error',
    };
  }
  const js: unknown = doc.toJS();
  const data = js && typeof js === 'object' && !Array.isArray(js) ? (js as Record<string, unknown>) : {};
  return { doc, data, body: split.body, conflictMarkers: split.conflictMarkers, error: null };
}

/** Reassemble a file from a Document and a body. */
export function joinFrontmatter(doc: Document, body: string): string {
  return `---\n${doc.toString(STRINGIFY_OPTIONS)}---\n${body}`;
}
