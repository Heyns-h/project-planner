import type { Snapshot } from '../app/session';

const DAY = 86_400_000;

export function daysUntil(date: string | null, now = Date.now()): number | null {
  if (!date) return null;
  const t = Date.parse(`${date}T23:59:59`);
  return Number.isNaN(t) ? null : Math.floor((t - now) / DAY);
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function statusText(snap: Snapshot): string {
  switch (snap.status.s) {
    case 'pulling':
      return 'Syncing…';
    case 'offline':
      return 'Offline — showing saved data';
    case 'unauthorized':
      return 'Token rejected — reconnect in Settings';
    case 'rate-limited':
      return `GitHub rate limit — retrying after ${new Date(snap.status.retryAt).toLocaleTimeString()}`;
    case 'error':
      return `Sync error: ${snap.status.message}`;
    default:
      return `Synced ${ago(snap.lastSyncAt)}`;
  }
}

export function StatusBar({ snap, offlineReady }: { snap: Snapshot; offlineReady: boolean }) {
  const days = daysUntil(snap.config?.tokenExpires ?? null);
  const bad = ['unauthorized', 'error', 'rate-limited'].includes(snap.status.s);
  return (
    <footer class="pl-status" aria-live="polite">
      {snap.config && <span class={bad ? 'pl-warn' : ''}>{statusText(snap)}</span>}
      {days !== null && days <= 14 && (
        <span class="pl-warn">{days < 0 ? 'Token expired' : `Token expires in ${days} day${days === 1 ? '' : 's'}`}</span>
      )}
      <span>{offlineReady ? 'Works offline' : 'Caching for offline…'}</span>
      <span>v{__APP_VERSION__}</span>
    </footer>
  );
}
