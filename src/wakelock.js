// Keep the screen on while a session runs; re-acquire after the page becomes visible again.

let lock = null;
let wanted = false;

async function request() {
  if (!wanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  if (lock && !lock.released) return;
  try { lock = await navigator.wakeLock.request('screen'); } catch { lock = null; }
}

document.addEventListener('visibilitychange', request);

export function keepAwake() {
  wanted = true;
  return request();
}

export function allowSleep() {
  wanted = false;
  if (lock) { lock.release().catch(() => {}); lock = null; }
}
