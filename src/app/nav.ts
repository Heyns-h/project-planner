// View root ↔ URL hash, and the history glue (plan Phase 2 §5, B9).
//
// The view root is a note stem carried in the hash: `#/` is the top level,
// `#/<stem>` a drilled-in node. A reload or a shared link lands on the same
// level. History entries are pushed ONLY from user actions (drill-in,
// breadcrumb): Chrome skips entries added without a gesture and, if every
// entry is skipped, back closes the app. At the top level nothing is pushed,
// so back leaves the app like any site. The pure parts are unit-tested; the
// window glue is exercised on devices.

export type Root = string | null; // stem, or null for the top level

export function parseHash(hash: string): Root {
  const m = /^#\/?([^/?#]*)/.exec(hash);
  const stem = m?.[1] ? decodeURIComponent(m[1]) : '';
  return stem || null;
}

export function hashFor(root: Root): string {
  return root ? `#/${encodeURIComponent(root)}` : '#/';
}

/** A navigation that changes nothing pushes nothing. */
export function shouldPush(from: Root, to: Root): boolean {
  return from !== to;
}

interface NavState {
  root: Root;
}

export interface Nav {
  /** User action: make `root` the view root, pushing a history entry. */
  go(root: Root): void;
  /** Non-user start-up adjustment: set the hash without adding an entry. */
  replace(root: Root): void;
  stop(): void;
}

/** Wire the hash and `popstate` to a handler. `onRoot` fires for back/forward only. */
export function installNav(onRoot: (root: Root) => void): Nav {
  const onPop = (e: PopStateEvent) => {
    const s = e.state as NavState | null;
    onRoot(s && 'root' in s ? s.root : parseHash(location.hash));
  };
  addEventListener('popstate', onPop);
  return {
    go(root) {
      const current = parseHash(location.hash);
      if (!shouldPush(current, root)) return;
      history.pushState({ root } satisfies NavState, '', hashFor(root));
    },
    replace(root) {
      history.replaceState({ root } satisfies NavState, '', hashFor(root));
    },
    stop() {
      removeEventListener('popstate', onPop);
    },
  };
}
