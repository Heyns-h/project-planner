import { useState } from 'preact/hooks';
import type { Session } from '../app/session';

// First-run setup. The token goes straight into this device's IndexedDB and
// nowhere else: not in the URL, not in logs, not in any file.

function guessDevice(): string {
  return /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'phone' : 'laptop';
}

export function Setup({ session }: { session: Session }) {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [device, setDevice] = useState(guessDevice);
  const [token, setToken] = useState('');
  const [expires, setExpires] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await session.connect(
        {
          owner: owner.trim(),
          repo: repo.trim(),
          branch: branch.trim() || 'main',
          device: device.trim() || guessDevice(),
          tokenExpires: expires || null,
        },
        token.trim(),
      );
      setToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ready = owner.trim() && repo.trim() && token.trim();

  return (
    <main class="pl-main">
      <form class="pl-card pl-form" onSubmit={submit} autocomplete="off">
        <h2>Connect a repository</h2>
        <p class="pl-muted">
          The planner reads and writes notes in one GitHub repository. Use a fine-grained token that can only see
          that repository, with <strong>Contents: Read and write</strong>. It is stored on this device only.
        </p>

        <label>
          Owner
          <input value={owner} onInput={(e) => setOwner(e.currentTarget.value)} placeholder="GitHub user or org" required />
        </label>
        <label>
          Repository
          <input value={repo} onInput={(e) => setRepo(e.currentTarget.value)} placeholder="repository name" required />
        </label>
        <label>
          Branch
          <input value={branch} onInput={(e) => setBranch(e.currentTarget.value)} />
        </label>
        <label>
          This device
          <input value={device} onInput={(e) => setDevice(e.currentTarget.value)} placeholder="phone, laptop…" />
          <span class="pl-hint">Appears in commit messages, e.g. "planner: … (phone)".</span>
        </label>
        <label>
          Token
          <input
            type="password"
            value={token}
            onInput={(e) => setToken(e.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
            required
          />
        </label>
        <label>
          Token expires on
          <input type="date" value={expires} onInput={(e) => setExpires(e.currentTarget.value)} />
          <span class="pl-hint">Shown when the token was created. The app warns 14 days before.</span>
        </label>

        {error && (
          <p class="pl-error" role="alert">
            {error}
          </p>
        )}
        <button class="pl-button primary" type="submit" disabled={!ready || busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </main>
  );
}
