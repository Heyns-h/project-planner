import { useState } from 'preact/hooks';
import type { Session, Snapshot } from '../app/session';

export function Settings({ session, snap, onClose }: { session: Session; snap: Snapshot; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [token, setToken] = useState('');
  const [expires, setExpires] = useState(snap.config?.tokenExpires ?? '');
  const [tokenMsg, setTokenMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const cfg = snap.config;

  const replace = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setTokenMsg(null);
    try {
      await session.replaceToken(token.trim(), expires || null);
      setToken('');
      setTokenMsg({ ok: true, text: 'Token replaced. Syncing now.' });
    } catch (err) {
      setTokenMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="pl-main">
      <section class="pl-card">
        <h2>Settings</h2>
        {cfg && (
          <dl class="pl-dl">
            <dt>Repository</dt>
            <dd>
              {cfg.owner}/{cfg.repo} ({cfg.branch})
            </dd>
            <dt>This device</dt>
            <dd>{cfg.device}</dd>
            <dt>Token expires</dt>
            <dd>{cfg.tokenExpires ?? 'not set'}</dd>
            <dt>Domains</dt>
            <dd>{cfg.domains.length ? cfg.domains.map((d) => d.label).join(', ') : 'detected after the first sync'}</dd>
            <dt>Protected from browser clean-up</dt>
            <dd>{snap.persisted === null ? 'unknown' : snap.persisted ? 'yes' : 'no — unsynced changes could be lost if the browser clears storage'}</dd>
            <dt>Not synced yet</dt>
            <dd>{snap.pending === 0 ? 'nothing' : `${snap.pending} change${snap.pending === 1 ? '' : 's'}`}</dd>
          </dl>
        )}
      </section>

      <form class="pl-card pl-form" onSubmit={replace} autocomplete="off">
        <h3>Replace token</h3>
        <p class="pl-muted">
          For an expired or rejected token on the same repository. Your local data and unsynced changes are kept.
        </p>
        <label>
          New token
          <input type="password" value={token} onInput={(e) => setToken(e.currentTarget.value)} autocomplete="off" spellcheck={false} required />
        </label>
        <label>
          Expires on
          <input type="date" value={expires} onInput={(e) => setExpires(e.currentTarget.value)} />
        </label>
        {tokenMsg && (
          <p class={tokenMsg.ok ? 'pl-muted' : 'pl-error'} role="status">
            {tokenMsg.text}
          </p>
        )}
        <div class="pl-row">
          <button class="pl-button primary" type="submit" disabled={busy || !token.trim()}>
            {busy ? 'Checking…' : 'Replace token'}
          </button>
        </div>
      </form>

      <section class="pl-card">
        <h3>Forget this device's data</h3>
        <p class="pl-muted">Removes the token and every cached note from this browser. Nothing in the repository changes.</p>
        {snap.pending > 0 && (
          <p class="pl-error">
            {snap.pending} change{snap.pending === 1 ? ' has' : 's have'} not been synced and would be lost. Sync first if you can.
          </p>
        )}
        {confirming ? (
          <div class="pl-row">
            <button
              class="pl-button danger"
              onClick={async () => {
                await session.forget();
                onClose();
              }}
            >
              Forget token and local data
            </button>
            <button class="pl-button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button class="pl-button" onClick={() => setConfirming(true)}>
            Forget…
          </button>
        )}
      </section>
      <button class="pl-button" onClick={onClose}>
        Back
      </button>
    </main>
  );
}
