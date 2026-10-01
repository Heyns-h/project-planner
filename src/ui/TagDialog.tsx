import { useState } from 'preact/hooks';
import type { Session } from '../app/session';
import { slugify } from '../core/slug';

// A new tag needs a name and a meaning (decision 6): both go into the
// domain's vocabulary table, in the same commit as the edit that uses it.

interface Props {
  session: Session;
  nodeId: string;
  domain: string;
  initialName: string;
  onDone: (tag: string | null) => void;
}

export function TagDialog({ session, nodeId, domain, initialName, onDone }: Props) {
  const [name, setName] = useState(initialName);
  const [meaning, setMeaning] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tag = slugify(name);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const r = await session.addTag(nodeId, name, meaning);
    setBusy(false);
    if (r.error) setError(r.error);
    else onDone(r.tag ?? null);
  };

  return (
    <div class="pl-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onDone(null)}>
      <form class="pl-card pl-form pl-modal" role="dialog" aria-modal="true" aria-label="New tag" onSubmit={submit}>
        <h2>New tag in {domain}</h2>
        <label>
          Name
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} required autoFocus />
          {tag && tag !== name && <span class="pl-hint">Written as `{tag}`</span>}
        </label>
        <label>
          Means
          <input value={meaning} onInput={(e) => setMeaning(e.currentTarget.value)} placeholder="What this tag is for" required />
        </label>
        {error && (
          <p class="pl-error" role="alert">
            {error}
          </p>
        )}
        <div class="pl-row">
          <button class="pl-button primary" type="submit" disabled={busy || !tag || !meaning.trim()}>
            Add tag
          </button>
          <button class="pl-button" type="button" onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
