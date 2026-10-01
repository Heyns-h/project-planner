import { useEffect, useState } from 'preact/hooks';
import type { Session, Snapshot } from '../app/session';
import type { Resolution } from '../core/ops';
import type { QueuedOp } from '../core/types';
import { FIELD_LABEL, formatValue } from './format';

// Blueprint §8.4: a conflicted edit waits here until you choose. Yours,
// theirs or the value both started from; nothing is picked for you. Each
// decision becomes a fresh op (or drops the edit) and syncs ~10 s later.

interface Props {
  session: Session;
  snap: Snapshot;
  onClose: () => void;
}

function when(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function Value({ text, long }: { text: string; long: boolean }) {
  return long ? <pre class="pl-conflict-pre">{text}</pre> : <span class="pl-conflict-value">{text}</span>;
}

export function ConflictDialog({ session, snap, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const items = snap.conflicts;

  // Every decision made (or cleared by a re-sync): nothing left to show.
  useEffect(() => {
    if (items.length === 0) onClose();
  }, [items.length, onClose]);

  const decide = async (q: QueuedOp, choice: Resolution) => {
    setBusy(q.opId);
    setError(null);
    const err = await session.resolve(q.opId, choice);
    setBusy(null);
    if (err) setError(err);
  };

  return (
    <div class="pl-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="pl-card pl-form pl-modal pl-modal-wide" role="dialog" aria-modal="true" aria-label="Changes that need a decision">
        <h2>
          {items.length} change{items.length === 1 ? '' : 's'} need{items.length === 1 ? 's' : ''} a decision
        </h2>
        <p class="pl-muted">
          These fields changed in the repository (from another device, or directly) after you edited them here. Nothing is chosen for you; the rest of your changes sync as usual.
        </p>
        {error && (
          <p class="pl-error" role="alert">
            {error}
          </p>
        )}
        {items.map((q) => {
          const c = q.conflict!;
          const node = snap.graph.nodes.get(c.nodeId);
          const title = node?.title ?? q.summary.replace(/^edit '(.*)' \(.*\)$/, '$1');
          const long = c.field === 'body';
          const disabled = busy !== null;
          return (
            <section key={q.opId} class="pl-conflict" aria-busy={busy === q.opId}>
              <h3>
                {title} <span class="pl-muted">· {FIELD_LABEL[c.field]}</span>
              </h3>
              <p class="pl-muted pl-small">Your change: {when(q.at)}</p>
              {c.field === 'deleted' ? (
                <>
                  <p>This item was removed from the repository after you edited it. Your change cannot be applied.</p>
                  <p>
                    Yours: <Value text={formatValue(q.op.kind === 'set' ? q.op.field : 'body', c.mine, snap.graph)} long={q.op.kind === 'body'} />
                  </p>
                  <div class="pl-row">
                    <button class="pl-button" disabled={disabled} onClick={() => void decide(q, 'theirs')}>
                      Discard my change
                    </button>
                  </div>
                </>
              ) : c.readOnly ? (
                <>
                  <p>The note now has git conflict markers or broken frontmatter in the repository. Fix it there and sync again, or discard this change.</p>
                  <p>
                    Yours: <Value text={formatValue(c.field, c.mine, snap.graph)} long={long} />
                  </p>
                  <div class="pl-row">
                    <button class="pl-button" disabled={disabled} onClick={() => void decide(q, 'theirs')}>
                      Discard my change
                    </button>
                  </div>
                </>
              ) : (
                <div class="pl-choices">
                  <div class="pl-choice">
                    <span class="pl-field-label">Yours (this device)</span>
                    <Value text={formatValue(c.field, c.mine, snap.graph)} long={long} />
                    <button class="pl-button primary" disabled={disabled} onClick={() => void decide(q, 'mine')}>
                      Keep mine
                    </button>
                  </div>
                  <div class="pl-choice">
                    <span class="pl-field-label">Theirs (in the repository)</span>
                    <Value text={formatValue(c.field, c.theirs, snap.graph)} long={long} />
                    <button class="pl-button" disabled={disabled} onClick={() => void decide(q, 'theirs')}>
                      Take theirs
                    </button>
                  </div>
                  <div class="pl-choice">
                    <span class="pl-field-label">Before either change</span>
                    <Value text={formatValue(c.field, c.base, snap.graph)} long={long} />
                    <button class="pl-button" disabled={disabled} onClick={() => void decide(q, 'base')}>
                      Go back to this
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
        <div class="pl-row">
          <button class="pl-button" type="button" onClick={onClose}>
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
}
