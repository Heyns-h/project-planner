import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import { Session } from './app/session';
import { App } from './ui/App';
import './ui/theme.css';

// `frame-ancestors` cannot be set from a <meta> CSP (verification B11), so the
// app refuses to run inside a frame. It must never ask for a token there.
function framed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function Root({ session }: { session: Session }) {
  const [updateReady, setUpdateReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [update] = useState(() =>
    registerSW({
      onNeedRefresh: () => setUpdateReady(true),
      onOfflineReady: () => setOfflineReady(true), // first install only
    }),
  );
  // On later launches onOfflineReady never fires. An active worker means the
  // precache finished (generateSW precaches during install), so offline works.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.ready.then(() => setOfflineReady(true));
  }, []);
  return (
    <App session={session} updateReady={updateReady} offlineReady={offlineReady} onUpdate={() => void update(true)} />
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
if (framed()) {
  root.textContent = 'Project Planner cannot run inside a frame.';
} else {
  const session = new Session();
  render(<Root session={session} />, root);
  session.open().catch((e: unknown) => {
    root.textContent = `Cannot open local storage: ${e instanceof Error ? e.message : String(e)}`;
  });
}
