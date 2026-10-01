import { useEffect, useState } from 'preact/hooks';
import type { Session, Snapshot } from '../app/session';
import { descendants } from '../core/graph';
import type { Field, PlannerNode, Priority, StoredStatus } from '../core/types';
import { STATUSES } from '../core/status';
import { safeUrl, TYPE_LABEL } from './format';
import { Picker, type Option } from './Picker';

// Blueprint §6: edit every property. Side panel on wide screens, bottom sheet
// on narrow ones (CSS). Text fields save on blur or Enter; selects, dates and
// pickers save on change. Every save is one queued op, synced ~10 s later.

interface Props {
  session: Session;
  snap: Snapshot;
  node: PlannerNode;
  onClose: () => void;
  onSelect: (id: string) => void;
  onReview: () => void; // open the conflict dialog
  onOpen: (id: string) => void; // drill in: make this node the view root
}

function TextField({ label, value, onSave, multiline, disabled }: { label: string; value: string; onSave: (v: string) => void; multiline?: boolean; disabled?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v !== value) onSave(v);
  };
  return (
    <label class="pl-field">
      <span class="pl-field-label">{label}</span>
      {multiline ? (
        <textarea value={v} rows={6} disabled={disabled} onInput={(e) => setV(e.currentTarget.value)} onBlur={commit} />
      ) : (
        <input
          value={v}
          disabled={disabled}
          onInput={(e) => setV(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') setV(value);
          }}
        />
      )}
    </label>
  );
}

export function Inspector({ session, snap, node: n, onClose, onSelect, onReview, onOpen }: Props) {
  const g = snap.graph;
  const [error, setError] = useState<string | null>(null);
  const ro = n.readOnly;
  const cfg = snap.config;
  const conflicted = snap.conflicts.filter((q) => q.conflict?.nodeId === n.id).length;

  useEffect(() => setError(null), [n.id]);

  const save = async (field: Field, value: unknown) => {
    setError(await session.setField(n.id, field, value));
  };

  // Options
  const excluded = new Set([n.id, ...descendants(g, n.id).map((d) => d.id)]);
  const nodeOptions = (filter: (x: PlannerNode) => boolean): Option[] =>
    [...g.nodes.values()]
      .filter(filter)
      .map((x) => ({ value: x.stem, label: x.title, hint: `${TYPE_LABEL[x.plannerType]} · ${x.domain}` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  // A sub-project or project goes under a project or sub-project; a task may go under anything.
  const parentOptions = nodeOptions((x) => !excluded.has(x.id) && (n.plannerType === 'task' || x.plannerType !== 'task'));
  const blockerOptions = nodeOptions((x) => x.id !== n.id);
  const personOptions: Option[] = [...g.people.values()].map((p) => ({ value: p.stem, label: p.name, hint: p.domain })).sort((a, b) => a.label.localeCompare(b.label));
  const noteOptions: Option[] = snap.noteStems.map((s) => ({ value: s, label: g.nodes.get(g.byStem.get(s) ?? '')?.title ?? s }));
  const tagOptions: Option[] = (g.tags.get(n.domain)?.tags ?? []).map((t) => ({ value: t, label: t }));
  const addPerson = async (name: string, then: (stem: string) => void) => {
    const r = await session.createPerson(name, n.domain);
    if (r.error) setError(r.error);
    else if (r.stem) then(r.stem);
  };

  const rollup = snap.rollups.get(n.id);
  const githubUrl = cfg ? `https://github.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/blob/${encodeURIComponent(cfg.branch)}/${n.path.split('/').map(encodeURIComponent).join('/')}` : null;
  const [newDrive, setNewDrive] = useState('');

  return (
    <aside class="pl-inspector" aria-label={`Edit ${n.title}`}>
      <div class="pl-inspector-head">
        <span class="pl-muted">{TYPE_LABEL[n.plannerType]}</span>
        <div class="pl-row">
          <button type="button" class="pl-button" onClick={() => onOpen(n.id)} title="Show what is inside this item">
            Open
          </button>
          <button type="button" class="pl-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {error && (
        <p class="pl-error" role="alert">
          {error}
        </p>
      )}
      {conflicted > 0 && (
        <p class="pl-warn pl-small">
          {conflicted === 1 ? 'A change to this item needs' : `${conflicted} changes to this item need`} a decision.{' '}
          <button type="button" class="pl-link-button" onClick={onReview}>
            Review
          </button>
        </p>
      )}
      {n.problems.length > 0 && (
        <ul class="pl-problems">
          {n.problems.map((p, i) => (
            <li key={i} class={p.severity === 'error' ? 'pl-error' : 'pl-warn'}>
              {p.message}
            </li>
          ))}
        </ul>
      )}

      <TextField label="Title" value={n.title} disabled={ro} onSave={(v) => void save('title', v.trim())} />

      <div class="pl-grid2">
        <label class="pl-field">
          <span class="pl-field-label">Status</span>
          <select value={n.status} disabled={ro} onChange={(e) => void save('status', e.currentTarget.value as StoredStatus)}>
            {STATUSES.map((s) => (
              <option key={s.stored} value={s.stored}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label class="pl-field">
          <span class="pl-field-label">Priority</span>
          <select value={n.priority} disabled={ro} onChange={(e) => void save('priority', e.currentTarget.value as Priority)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label class="pl-field">
          <span class="pl-field-label">Start</span>
          <input type="date" value={n.start ?? ''} disabled={ro} onChange={(e) => void save('start', e.currentTarget.value || null)} />
        </label>
        <label class="pl-field">
          <span class="pl-field-label">Due</span>
          <input type="date" value={n.due ?? ''} disabled={ro} onChange={(e) => void save('due', e.currentTarget.value || null)} />
        </label>
      </div>

      {rollup && rollup.total > 0 && (g.children.get(n.id)?.length ?? 0) > 0 && (
        <p class="pl-muted">
          {rollup.done} of {rollup.total} tasks done ({rollup.percent}%)
          {rollup.waitingOn.length > 0 && <> · waiting on {rollup.waitingOn.map((w) => w.title).join(', ')}</>}
        </p>
      )}

      <Picker label="Parent" multi={false} disabled={ro} options={parentOptions} selected={n.parent ? [n.parent] : []} onChange={(v) => void save('parent', v[0] ?? null)} placeholder="Search projects and tasks…" />
      <Picker
        label="Owner"
        multi={false}
        disabled={ro}
        options={personOptions}
        selected={n.owner ? [n.owner] : []}
        onChange={(v) => void save('owner', v[0] ?? null)}
        onCreate={(name) => void addPerson(name, (stem) => void save('owner', stem))}
        createLabel="Add person"
        placeholder="Search people…"
      />
      <Picker
        label="People"
        multi
        disabled={ro}
        options={personOptions}
        selected={n.people}
        onChange={(v) => void save('people', v)}
        onCreate={(name) => void addPerson(name, (stem) => void save('people', [...n.people, stem]))}
        createLabel="Add person"
        placeholder="Search people…"
      />
      <Picker label={`Tags (${n.domain} list)`} multi disabled={ro} options={tagOptions} selected={n.tags} onChange={(v) => void save('tags', v)} placeholder={tagOptions.length ? 'Search tags…' : 'This domain has no tags yet'} />
      <Picker label="Blocked by" multi disabled={ro} options={blockerOptions} selected={n.blockedBy} onChange={(v) => void save('blockedBy', v)} placeholder="Search items…" />
      {(g.blocks.get(n.id) ?? []).length > 0 && (
        <p class="pl-muted">
          Blocks:{' '}
          {(g.blocks.get(n.id) ?? []).map((id, i) => (
            <>
              {i > 0 && ', '}
              <button type="button" class="pl-link-button" onClick={() => onSelect(id)}>
                {g.nodes.get(id)?.title}
              </button>
            </>
          ))}
        </p>
      )}
      <Picker label="Relates to" multi disabled={ro} options={noteOptions} selected={n.relates} onChange={(v) => void save('relates', v)} placeholder="Search notes…" />
      <Picker label="References" multi disabled={ro} options={noteOptions} selected={n.references} onChange={(v) => void save('references', v)} placeholder="Search notes…" />

      <div class="pl-field">
        <span class="pl-field-label">Drive links</span>
        {n.drive.map((url) => {
          const safe = safeUrl(url);
          return (
            <div class="pl-row-inline" key={url}>
              {safe ? (
                <a href={safe} target="_blank" rel="noopener noreferrer" class="pl-button">
                  Open
                </a>
              ) : (
                <span class="pl-warn">not a web link</span>
              )}
              <span class="pl-ellipsis">{url}</span>
              {!ro && (
                <button type="button" class="pl-link-button" onClick={() => void save('drive', n.drive.filter((d) => d !== url))}>
                  Remove
                </button>
              )}
            </div>
          );
        })}
        {!ro && (
          <form
            class="pl-row-inline"
            onSubmit={(e) => {
              e.preventDefault();
              const url = newDrive.trim();
              if (!safeUrl(url)) return setError('Paste a full https:// link.');
              void save('drive', [...n.drive, url]);
              setNewDrive('');
            }}
          >
            <input type="url" value={newDrive} placeholder="https://drive.google.com/…" onInput={(e) => setNewDrive(e.currentTarget.value)} />
            <button type="submit" class="pl-button">
              Add
            </button>
          </form>
        )}
      </div>

      <TextField label="Notes" multiline value={n.body.replace(/^\n/, '')} disabled={ro} onSave={(v) => void session.setBody(n.id, v ? `\n${v.replace(/\n*$/, '\n')}` : '').then(setError)} />

      <p class="pl-small pl-muted">
        {n.path}
        {githubUrl && (
          <>
            {' · '}
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">
              View on GitHub
            </a>
          </>
        )}
      </p>
    </aside>
  );
}
