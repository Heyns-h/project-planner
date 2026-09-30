// When sync runs (blueprint §8.3): at start, on return to the foreground, when
// the browser reports the connection is back, and every 30 s while visible.
// `navigator.onLine` is only a hint (B6); a failed attempt just waits for the
// next trigger. Background Sync is deliberately not used (B5).

export const POLL_MS = 30_000;

export function startTriggers(run: () => void, pollMs = POLL_MS): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const startTimer = () => {
    if (timer === null) timer = setInterval(run, pollMs);
  };
  const stopTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      run();
      startTimer();
    } else {
      stopTimer();
    }
  };
  const onOnline = () => run();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  run();
  if (document.visibilityState === 'visible') startTimer();

  return () => {
    stopTimer();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}
