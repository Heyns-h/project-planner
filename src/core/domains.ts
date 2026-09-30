import type { DomainDef } from './types';

// Domains are detected from the repo's top-level folders, e.g. "02-Example"
// becomes { id: "example", folder: "02-Example", label: "Example" }. The
// "00-System" folder maps to "system". Nothing about a specific vault is
// hard-coded here; the result is stored in settings and can be edited there.

const DOMAIN_FOLDER = /^(\d{2})-(.+)$/;

export function detectDomains(paths: Iterable<string>): DomainDef[] {
  const folders = new Set<string>();
  for (const p of paths) {
    const top = p.split('/')[0];
    if (top && p.includes('/') && DOMAIN_FOLDER.test(top)) folders.add(top);
  }
  return [...folders]
    .sort()
    .map((folder) => {
      const label = (DOMAIN_FOLDER.exec(folder)?.[2] ?? folder).replace(/[-_]+/g, ' ');
      return { id: label.toLowerCase().replace(/\s+/g, '-'), folder, label };
    });
}

export function domainForPath(path: string, domains: readonly DomainDef[]): DomainDef | null {
  const top = path.split('/')[0];
  return domains.find((d) => d.folder === top) ?? null;
}
