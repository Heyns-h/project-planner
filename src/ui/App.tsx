import { useEffect, useRef, useState } from 'preact/hooks';
import { installNav, parseHash, type Root } from '../app/nav';
import type { Session, Snapshot } from '../app/session';
import { startTriggers } from '../sync/triggers';
import { Breadcrumb } from './Breadcrumb';
import { BubbleView } from './BubbleView';
import { ConflictDialog } from './ConflictDialog';
import { loadLocal, saveLocal } from './format';
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
  // Bubble by default on a device's first start, then the last used view (decision 4).
  const [mode, setModeState] = useState<'bubble' | 'list'>(() => loadLocal('view', 'bubble'));
  const setMode = (m: 'bubble' | 'list') => {
    setModeState(m);
    saveLocal('view', m);
  };

  // The view root (blueprint §5.3) is a stem in the URL hash; the hash wins
  // over the root saved on this device, which only fills in when there is none.
  const [rootStem, setRootStem] = useState<Root>(() => parseHash(location.hash) ?? loadLocal<Root>('root', null));
  const nav = useRef(installNav(setRootStem));
  useEffect(() => {
    const n = nav.current;
    if (parseHash(location.hash) === null && rootStem) n.replace(rootStem);
    return () => n.stop();
  }, []);
  useEffect(() => saveLocal('root', rootStem), [rootStem]);

  useEffect(() => session.subscribe(setSnap), [session]);

  const connected = snap.config !== null;
  useEffect(() => {
    if (!connected) return;
    return startTriggers(() => void session.sync({ auto: true }));
  }, [session, connected]);

  if (!snap.ready) return null;

  const g = snap.graph;
  const selected = selectedId ? g.nodes.get(selectedId) : undefined;
  // An unknown stem (not pulled yet, or deleted) shows the top level without rewriting the hash.
  const rootNode = rootStem ? g.nodes.get(g.byStem.get(rootStem) ?? '') : undefined;
  const rootId = rootNode?.id ?? null;

  // Every drill-in or breadcrumb step is a user action: it pushes a history entry (B9).
  const go = (stem: Root) => {
    nav.current.go(stem);
    setRootStem(stem);
  };
  const open = (id: string) => {
    const n = g.nodes.get(id);
    if (n) go(n.stem);
  };

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
        {connected && view === 'home' && (
          <div class="pl-segmented pl-viewtoggle" role="radiogroup" aria-label="View">
            {(['bubble', 'list'] as const).map((m) => (
              <button type="button" key={m} role="radio" aria-checked={mode === m} class={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'bubble' ? 'Bubbles' : 'List'}
              </button>
            ))}
          </div>
        )}
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
        <>
          <Breadcrumb g={g} root={rootNode ?? null} onGo={go} />
          <div class={`pl-body${selected ? ' with-inspector' : ''}`}>
            {mode === 'bubble' ? (
              <main class="pl-main pl-main-fill">
                <BubbleView snap={snap} root={rootId} selectedId={selectedId} onSelect={setSelectedId} onOpen={open} />
              </main>
            ) : (
              <main class="pl-main pl-main-wide">
                <ListView snap={snap} root={rootId} selectedId={selectedId} onSelect={setSelectedId} onOpen={open} />
              </main>
            )}
            {selected && (
              <Inspector
                key={selected.id}
                session={session}
                snap={snap}
                node={selected}
                onClose={() => setSelectedId(null)}
                onSelect={setSelectedId}
                onReview={() => setResolving(true)}
                onOpen={open}
              />
            )}
          </div>
        </>
      )}
      {adding && (
        <QuickAdd
          session={session}
          snap={snap}
          defaultParent={selected?.stem ?? rootNode?.stem ?? null}
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
