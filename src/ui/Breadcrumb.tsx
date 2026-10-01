import { ancestors } from '../core/graph';
import type { Graph, PlannerNode } from '../core/types';

// Blueprint §5.3: a breadcrumb walks back up from the view root. Each crumb
// is a user action, so it pushes a history entry (decision 3).

interface Props {
  g: Graph;
  root: PlannerNode | null;
  onGo: (stem: string | null) => void;
}

export function Breadcrumb({ g, root, onGo }: Props) {
  const path = root ? [...ancestors(g, root.id)].reverse() : [];
  return (
    <nav class="pl-crumbs" aria-label="Where you are">
      <button type="button" class="pl-crumb" onClick={() => onGo(null)} disabled={root === null} aria-current={root === null ? 'page' : undefined}>
        All projects
      </button>
      {path.map((n) => (
        <span key={n.id} class="pl-crumb-wrap">
          <span class="pl-crumb-sep" aria-hidden="true">
            ›
          </span>
          <button type="button" class="pl-crumb" onClick={() => onGo(n.stem)}>
            {n.title}
          </button>
        </span>
      ))}
      {root && (
        <span class="pl-crumb-wrap">
          <span class="pl-crumb-sep" aria-hidden="true">
            ›
          </span>
          <span class="pl-crumb current" aria-current="page">
            {root.title}
          </span>
        </span>
      )}
    </nav>
  );
}
