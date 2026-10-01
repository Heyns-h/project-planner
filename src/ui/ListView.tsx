import { useMemo, useState } from 'preact/hooks';
import type { Snapshot } from '../app/session';
import { ancestors, childrenOf, descendants, roots } from '../core/graph';
import type { PlannerNode, StoredStatus } from '../core/types';
import { loadLocal, PRIORITY_LABEL, saveLocal, shortDate, STATUS_CLASS, statusLabel, TYPE_LABEL } from './format';

// Blueprint §5.2: collapsible tree table. Columns: Title · Type · Status ·
// Owner · Domain · Due · Progress. Filters show matches with their ancestor
// path. Expanded rows and filters are remembered per device, never synced.

type Sort = 'default' | 'due' | 'status' | 'priority' | 'title';
type StatusFilter = 'open' | 'all' | StoredStatus;

interface Filters {
  status: StatusFilter;
  domain: string; // '' = all
  sort: Sort;
}

const STATUS_ORDER: Record<StoredStatus, number> = { 'on-hold': 0, active: 1, idea: 2, done: 3, archived: 4 };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function compare(sort: Sort): (a: PlannerNode, b: PlannerNode) => number {
  switch (sort) {
    case 'due':
      return (a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title);
    case 'status':
      return (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title);
    case 'priority':
      return (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.title.localeCompare(b.title);
    case 'title':
      return (a, b) => a.title.localeCompare(b.title);
    default:
      return () => 0; // graph order: projects, sub-projects, tasks, then title
  }
}

function matches(n: PlannerNode, f: Filters): boolean {
  if (f.domain && n.domain !== f.domain) return false;
  if (f.status === 'all') return n.status !== 'archived';
  if (f.status === 'open') return n.status !== 'done' && n.status !== 'archived';
  return n.status === f.status;
}

interface Props {
  snap: Snapshot;
  root: string | null; // view root id; the list shows its subtree
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void; // drill in (double-click a row)
}

export function ListView({ snap, root, selectedId, onSelect, onOpen }: Props) {
  const g = snap.graph;
  const [filters, setFiltersState] = useState<Filters>(() => loadLocal('filters', { status: 'all', domain: '', sort: 'default' }));
  const [expanded, setExpandedState] = useState<Set<string>>(() => new Set(loadLocal<string[]>('expanded', [])));
  const [collapsedByDefault] = useState(() => loadLocal('expanded-initialised', false));

  const setFilters = (f: Filters) => {
    setFiltersState(f);
    saveLocal('filters', f);
  };
  const setExpanded = (s: Set<string>) => {
    setExpandedState(s);
    saveLocal('expanded', [...s]);
    saveLocal('expanded-initialised', true);
  };

  // First run on this device: open projects and sub-projects.
  const isOpen = (n: PlannerNode) => expanded.has(n.id) || (!collapsedByDefault && n.plannerType !== 'task' && !expanded.has(`-${n.id}`));
  const toggle = (n: PlannerNode) => {
    const next = new Set(expanded);
    if (isOpen(n)) {
      next.delete(n.id);
      next.add(`-${n.id}`);
    } else {
      next.add(n.id);
      next.delete(`-${n.id}`);
    }
    setExpanded(next);
  };

  // Visible set: matching nodes plus their ancestor path, up to the view root.
  const visible = useMemo(() => {
    const v = new Set<string>();
    const inView = root ? new Set(descendants(g, root).map((d) => d.id)) : null;
    for (const n of g.nodes.values()) {
      if (inView && !inView.has(n.id)) continue;
      if (!matches(n, filters)) continue;
      v.add(n.id);
      for (const a of ancestors(g, n.id)) {
        if (a.id === root) break;
        v.add(a.id);
      }
    }
    return v;
  }, [g, filters, root]);

  const rows: { node: PlannerNode; depth: number; hasChildren: boolean; match: boolean }[] = [];
  const cmp = compare(filters.sort);
  const walk = (list: PlannerNode[], depth: number, seen: Set<string>) => {
    for (const n of [...list].sort(cmp)) {
      if (!visible.has(n.id) || seen.has(n.id)) continue;
      const kids = childrenOf(g, n.id).filter((c) => visible.has(c.id));
      rows.push({ node: n, depth, hasChildren: kids.length > 0, match: matches(n, filters) });
      if (kids.length && isOpen(n)) walk(kids, depth + 1, new Set([...seen, n.id]));
    }
  };
  walk(root ? childrenOf(g, root) : roots(g), 0, new Set());

  const domains = snap.config?.domains ?? [];
  const owner = (n: PlannerNode) => (n.owner ? g.people.get(n.owner)?.name ?? n.owner : '');
  const domainLabel = (id: string) => domains.find((d) => d.id === id)?.label ?? id;

  return (
    <div class="pl-listview">
      <div class="pl-toolbar" role="toolbar" aria-label="Filters">
        <label>
          <span class="pl-sr">Status</span>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.currentTarget.value as StatusFilter })}>
            <option value="all">All (not archived)</option>
            <option value="open">Open</option>
            <option value="idea">Not started</option>
            <option value="active">In progress</option>
            <option value="on-hold">Blocked</option>
            <option value="done">Done</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          <span class="pl-sr">Domain</span>
          <select value={filters.domain} onChange={(e) => setFilters({ ...filters, domain: e.currentTarget.value })}>
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span class="pl-sr">Sort</span>
          <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.currentTarget.value as Sort })}>
            <option value="default">Sort: hierarchy</option>
            <option value="due">Sort: due date</option>
            <option value="status">Sort: status</option>
            <option value="priority">Sort: priority</option>
            <option value="title">Sort: title</option>
          </select>
        </label>
      </div>

      <div class="pl-tree" role="tree" aria-label="Projects and tasks">
        <div class="pl-trow pl-head" aria-hidden="true">
          <span>Title</span>
          <span class="c-type">Type</span>
          <span>Status</span>
          <span class="c-owner">Owner</span>
          <span class="c-domain">Domain</span>
          <span>Due</span>
          <span>Progress</span>
        </div>
        {rows.length === 0 && (
          <p class="pl-muted pl-empty">
            {g.nodes.size === 0 ? 'No planner items yet. Use + to add a project.' : root && childrenOf(g, root).length === 0 ? 'Nothing under this item yet. Use + to add something.' : 'Nothing matches these filters.'}
          </p>
        )}
        {rows.map(({ node: n, depth, hasChildren, match }) => {
          const r = snap.rollups.get(n.id);
          const problems = n.problems.length;
          return (
            <div
              key={n.id}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={hasChildren ? isOpen(n) : undefined}
              aria-selected={selectedId === n.id}
              class={`pl-trow${selectedId === n.id ? ' selected' : ''}${match ? '' : ' context'}`}
            >
              <span class="c-title" style={{ paddingLeft: `${depth * 18}px` }}>
                {hasChildren ? (
                  <button type="button" class="pl-twisty" aria-label={isOpen(n) ? 'Collapse' : 'Expand'} onClick={() => toggle(n)}>
                    {isOpen(n) ? '▾' : '▸'}
                  </button>
                ) : (
                  <span class="pl-twisty" aria-hidden="true" />
                )}
                <button type="button" class={`pl-title t-${n.plannerType}`} onClick={() => onSelect(n.id)} onDblClick={() => onOpen(n.id)} title="Double-click to open">
                  {n.title}
                </button>
                {r?.blocked && <span class="pl-badge b-blocked" title={r.waitingOn.length ? `Waiting on ${r.waitingOn.map((w) => w.title).join(', ')}` : 'Blocked'}>blocked</span>}
                {r && !r.blocked && r.blockedTasks > 0 && (
                  <span class="pl-badge b-partial" title={`${r.blockedTasks} of ${r.openTasks} open tasks blocked`}>
                    {r.blockedTasks} blocked
                  </span>
                )}
                {r?.overdue && <span class="pl-badge b-overdue">overdue</span>}
                {problems > 0 && <span class="pl-badge b-problem" title={n.problems.map((p) => p.message).join('\n')}>⚠ {problems}</span>}
                {n.readOnly && <span class="pl-badge b-problem">read-only</span>}
                {snap.pendingNodes.has(n.id) && <span class="pl-dot" title="Changes not synced yet" aria-label="not synced" />}
              </span>
              <span class="c-type pl-muted">{TYPE_LABEL[n.plannerType]}</span>
              <span>
                <span class={`pl-pill ${STATUS_CLASS[n.status]}`}>{statusLabel(n.status)}</span>
              </span>
              <span class="c-owner">{owner(n)}</span>
              <span class="c-domain pl-muted">{domainLabel(n.domain)}</span>
              <span class={r?.overdue && n.due && n.due < snap.today ? 'pl-overdue' : ''}>{shortDate(n.due, snap.today)}</span>
              <span class="c-progress" title={r && r.total ? `${r.done} of ${r.total} tasks done · priority ${PRIORITY_LABEL[n.priority]}` : ''}>
                {r?.percent !== null && r?.percent !== undefined && (
                  <>
                    <span class={`pl-bar${r.blockedTasks > 0 && !r.blocked ? ' partial' : ''}`} aria-hidden="true">
                      <span class="pl-bar-fill" style={{ width: `${r.percent}%` }} />
                    </span>
                    <span class="pl-pct">{r.percent}%</span>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
