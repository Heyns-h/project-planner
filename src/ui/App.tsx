import { useEffect, useState } from 'preact/hooks';
import type { Session, Snapshot } from '../app/session';
import { startTriggers } from '../sync/triggers';
import { Overview } from './Overview';
import { Settings } from './Settings';
import { Setup } from './Setup';
import { StatusBar } from './StatusBar';

interface Props {
  session: Session;
  updateReady: boolean;
  onUpdate: () => void;
  offlineReady: boolean;
}

export function App({ session, updateReady, onUpdate, offlineReady }: Props) {
  const [snap, setSnap] = useState<Snapshot>(session.snapshot);
  const [view, setView] = useState<'home' | 'settings'>('home');

  useEffect(() => session.subscribe(setSnap), [session]);

  const connected = snap.config !== null;
  useEffect(() => {
    if (!connected) return;
    return startTriggers(() => void session.sync());
  }, [session, connected]);

  if (!snap.ready) return null;

  return (
    <>
      {updateReady && (
        <div class="pl-banner" role="status">
          <span>A new version is ready.</span>
          <button class="pl-button primary" onClick={onUpdate}>
            Reload
          </button>
        </div>
      )}
      <header class="pl-header">
        <h1>Project Planner</h1>
        {connected && (
          <div class="pl-header-actions">
            <button class="pl-button" onClick={() => void session.sync()} disabled={snap.status.s === 'pulling'}>
              Sync
            </button>
            <button class="pl-button" onClick={() => setView(view === 'settings' ? 'home' : 'settings')}>
              {view === 'settings' ? 'Done' : 'Settings'}
            </button>
          </div>
        )}
      </header>
      {!connected ? (
        <Setup session={session} />
      ) : view === 'settings' ? (
        <Settings session={session} snap={snap} onClose={() => setView('home')} />
      ) : (
        <Overview snap={snap} />
      )}
      <StatusBar snap={snap} offlineReady={offlineReady} />
    </>
  );
}
