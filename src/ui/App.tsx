import { STATUSES } from '../core/status';

interface Props {
  updateReady: boolean;
  onUpdate: () => void;
  offlineReady: boolean;
}

// Phase 0a shell: proves build, deploy, install and offline launch.
// Setup, pull and the node count arrive in step 0b.
export function App({ updateReady, onUpdate, offlineReady }: Props) {
  return (
    <>
      {updateReady && (
        <div class="pl-banner" role="status">
          <span>A new version is ready.</span>
          <button class="pl-button primary" onClick={onUpdate}>Reload</button>
        </div>
      )}
      <header class="pl-header">
        <h1>Project Planner</h1>
      </header>
      <main class="pl-main">
        <section class="pl-card">
          <h2>Phase 0 — scaffold</h2>
          <p class="pl-muted">
            Build, deploy and install check. Connecting to a repo comes in the next step.
          </p>
          <p>Statuses: {STATUSES.map((s) => s.label).join(' · ')}</p>
          <div class="pl-swatches" aria-hidden="true">
            {['bg', 'surface', 'surface-2', 'accent', 'highlight', 'blocked', 'done', 'progress', 'link', 'plum'].map((t) => (
              <span key={t} class="pl-swatch" data-token={t} />
            ))}
          </div>
        </section>
      </main>
      <footer class="pl-status">
        <span>{navigator.onLine ? 'Online' : 'Offline'}</span>
        <span>{offlineReady ? 'Ready to work offline' : 'Caching for offline…'}</span>
        <span>v{__APP_VERSION__}</span>
      </footer>
    </>
  );
}
