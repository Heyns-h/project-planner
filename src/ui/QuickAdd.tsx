import { useState } from 'preact/hooks';
import type { Session, Snapshot } from '../app/session';
import type { PlannerType } from '../core/types';
import { TYPE_LABEL } from './format';
import { Picker } from './Picker';

// Quick add (blueprint §6): type, title and parent; everything else is
// optional and editable in the Inspector afterwards.

interface Props {
  session: Session;
  snap: Snapshot;
  defaultParent: string | null; // stem of the selected item, if any
  onDone: (id: string | null) => void;
}

export function QuickAdd({ session, snap, defaultParent, onDone }: Props) {
  const g = snap.graph;
  const domains = (snap.config?.domains ?? []).filter((d) => d.id !== 'system');
  const parentNode = defaultParent ? g.nodes.get(g.byStem.get(defaultParent) ?? '') : undefined;
  const [type, setType] = useState<PlannerType>(parentNode ? (parentNode.plannerType === 'project' ? 'subproject' : 'task') : 'project');
  const [title, setTitle] = useState('');
  const [parent, setParent] = useState<string | null>(type === 'project' ? null : defaultParent);
  const [domain, setDomain] = useState(domains[0]?.id ?? '');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = [...g.nodes.values()]
    .filter((x) => (type === 'subproject' ? x.plannerType !== 'task' : true))
    .map((x) => ({ value: x.stem, label: x.title, hint: `${TYPE_LABEL[x.plannerType]} · ${x.domain}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const r = await session.createNode({
      plannerType: type,
      title: title.trim(),
      parent: type === 'project' ? null : parent,
      ...(type === 'project' ? { domain } : {}),
      ...(due ? { due } : {}),
    });
    setBusy(false);
    if (r.error) setError(r.error);
    else onDone(r.id ?? null);
  };

  const needsParent = type !== 'project' && !parent;

  return (
    <div class="pl-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onDone(null)}>
      <form class="pl-card pl-form pl-modal" role="dialog" aria-modal="true" aria-label="Add item" onSubmit={submit}>
        <h2>Add</h2>
        <div class="pl-segmented" role="radiogroup" aria-label="Type">
          {(['project', 'subproject', 'task'] as const).map((t) => (
            <button type="button" key={t} role="radio" aria-checked={type === t} class={type === t ? 'on' : ''} onClick={() => setType(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <label>
          Title
          <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} required autoFocus />
        </label>
        {type === 'project' ? (
          <label>
            Domain
            <select value={domain} onChange={(e) => setDomain(e.currentTarget.value)}>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Picker label="Parent" multi={false} options={options} selected={parent ? [parent] : []} onChange={(v) => setParent(v[0] ?? null)} placeholder="Search projects and tasks…" />
        )}
        <label>
          Due (optional)
          <input type="date" value={due} onInput={(e) => setDue(e.currentTarget.value)} />
        </label>
        {error && (
          <p class="pl-error" role="alert">
            {error}
          </p>
        )}
        <div class="pl-row">
          <button class="pl-button primary" type="submit" disabled={busy || !title.trim() || needsParent}>
            Add
          </button>
          <button class="pl-button" type="button" onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
