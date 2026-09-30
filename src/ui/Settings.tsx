import { useState } from 'preact/hooks';
import type { Session, Snapshot } from '../app/session';

export function Settings({ session, snap, onClose }: { session: Session; snap: Snapshot; onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const cfg = snap.config;
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
            <dd>
              {snap.persisted === null ? 'unknown' : snap.persisted ? 'yes' : 'no — unsynced changes could be lost if the browser clears storage'}
            </dd>
          </dl>
        )}
      </section>

      <section class="pl-card">
        <h3>Forget this device's data</h3>
        <p class="pl-muted">Removes the token and every cached note from this browser. Nothing in the repository changes.</p>
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
