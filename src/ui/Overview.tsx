import type { Snapshot } from '../app/session';

// Phase 0 view: proves the pull works by counting what arrived.
// The list view replaces it in step 1d.

export function Overview({ snap }: { snap: Snapshot }) {
  const c = snap.counts;
  const cfg = snap.config;
  return (
    <main class="pl-main">
      <section class="pl-card">
        <h2 class="pl-count">
          {c.nodes} <span>planner node{c.nodes === 1 ? '' : 's'}</span>
        </h2>
        {c.byDomain.length > 0 && (
          <ul class="pl-list">
            {c.byDomain.map((d) => (
              <li key={d.domain.id}>
                <span>{d.domain.label}</span>
                <strong>{d.nodes}</strong>
              </li>
            ))}
            {c.unassigned > 0 && (
              <li>
                <span>Outside any domain</span>
                <strong>{c.unassigned}</strong>
              </li>
            )}
          </ul>
        )}
        {snap.lastCommit === null && snap.status.s !== 'pulling' && (
          <p class="pl-muted">Nothing synced yet.</p>
        )}
      </section>

      <section class="pl-card">
        <ul class="pl-list">
          <li>
            <span>People</span>
            <strong>{c.people}</strong>
          </li>
          <li>
            <span>Tag lists</span>
            <strong>{c.tagLists}</strong>
          </li>
          <li>
            <span>Notes indexed (names only)</span>
            <strong>{c.notesIndexed}</strong>
          </li>
          {c.readOnly > 0 && (
            <li class="pl-warn">
              <span>Files with conflict markers (read-only)</span>
              <strong>{c.readOnly}</strong>
            </li>
          )}
        </ul>
        {cfg && (
          <p class="pl-muted pl-small">
            {cfg.owner}/{cfg.repo} · {cfg.branch}
            {snap.lastCommit && <> · {snap.lastCommit.slice(0, 7)}</>}
          </p>
        )}
      </section>
    </main>
  );
}
