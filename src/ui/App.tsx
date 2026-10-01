import { useEffect, useState } from 'preact/hooks';
import type { Session, Snapshot } from '../app/session';
import { startTriggers } from '../sync/triggers';
import { ConflictDialog } from './ConflictDialog';
import { Inspector } from './Inspector';
import { ListView } from './ListView';
import { QuickAdd } from './QuickAdd';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => session.subscribe(setSnap), [session]);

  const connected = snap.config !== null;
  useEffect(() => {
    if (!connected) return;
    return startTriggers(() => void session.sync({ auto: true }));
  }, [session, connected]);

  if (!snap.ready) return null;

  const selected = selectedId ? snap.graph.nodes.get(selectedId) : undefined;

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
      {connected && snap.conflicts.length > 0 && !resolving && (
        <div class="pl-banner" role="status">
          <span>
            {snap.conflicts.length} change{snap.conflicts.length === 1 ? '' : 's'} need{snap.conflicts.length === 1 ? 's' : ''} a decision before syncing.
          </span>
          <button class="pl-button primary" onClick={() => setResolving(true)}>
            Review
          </button>
        </div>
      )}
      <header class="pl-header">
        <h1>Planner</h1>
        {connected && (
          <div class="pl-header-actions">
            {view === 'home' && (
              <button class="pl-button primary pl-icon" aria-label="Add" title="Add" onClick={() => setAdding(true)}>
                +
              </button>
            )}
            <button class="pl-button" onClick={() => void session.sync()} disabled={snap.status.s === 'syncing'}>
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
        <div class={`pl-body${selected ? ' with-inspector' : ''}`}>
          <main class="pl-main pl-main-wide">
            <ListView snap={snap} selectedId={selectedId} onSelect={setSelectedId} />
          </main>
          {selected && (
            <Inspector
              key={selected.id}
              session={session}
              snap={snap}
              node={selected}
              onClose={() => setSelectedId(null)}
              onSelect={setSelectedId}
              onReview={() => setResolving(true)}
            />
          )}
        </div>
      )}
      {adding && (
        <QuickAdd
          session={session}
          snap={snap}
          defaultParent={selected?.stem ?? null}
          onDone={(id) => {
            setAdding(false);
            if (id) setSelectedId(id);
          }}
        />
      )}
      {resolving && <ConflictDialog session={session} snap={snap} onClose={() => setResolving(false)} />}
      <StatusBar snap={snap} offlineReady={offlineReady} />
    </>
  );
}
