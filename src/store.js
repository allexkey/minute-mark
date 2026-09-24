// Local persistence: settings and the live session in localStorage, history in IndexedDB.

const CFG_KEY = 'mm.cfg';
const SESSION_KEY = 'mm.session';

export const DEFAULT_CFG = {
  type: 'emom', // 'emom' | 'rest'
  interval: 60, // EMOM: seconds, 30..300 in 15 s steps
  rest: 60, // rest timer: seconds, 15..300 in 15 s steps
  target: 0, // 0 = no target
  mode: 'airpods', // 'airpods' | 'music'
  announceMinutes: true,
  sayRest: true,
};

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJSON(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage unavailable */ }
}

export const loadCfg = () => ({ ...DEFAULT_CFG, ...readJSON(CFG_KEY) });
export const saveCfg = (cfg) => writeJSON(CFG_KEY, cfg);

/** The running session plus a heartbeat, so a killed app can be restored. */
export const loadLive = () => readJSON(SESSION_KEY);
export const saveLive = (session, heartbeat) => writeJSON(SESSION_KEY, session && { session, heartbeat });
export const clearLive = () => writeJSON(SESSION_KEY, null);

// ---- history (IndexedDB) ----------------------------------------------------

let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('minute-mark', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('sessions', mode);
    const req = fn(t.objectStore('sessions'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const addSession = (rec) => tx('readwrite', (s) => s.add(rec));
export const putSession = (rec) => tx('readwrite', (s) => s.put(rec));
export const deleteSession = (id) => tx('readwrite', (s) => s.delete(id));
export const getSession = (id) => tx('readonly', (s) => s.get(id));
export async function allSessions() {
  const list = await tx('readonly', (s) => s.getAll());
  return (list || []).sort((a, b) => b.startedAt - a.startedAt);
}

/** Ask the browser not to evict our data (iOS may clear PWAs left unused for weeks). */
export function persistStorage() {
  navigator.storage?.persist?.().catch(() => {});
}

export function toCSV(list) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['date', 'timer', 'exercise', 'sets', 'total_seconds', 'interval_seconds', 'rest_seconds', 'avg_set_seconds', 'set_durations', 'note'];
  const rows = list.map((r) => [
    new Date(r.startedAt).toISOString(), r.type ?? 'emom', r.exercise, r.sets, Math.round(r.totalMs / 1000),
    (r.type ?? 'emom') === 'emom' ? r.interval : '', r.type === 'rest' ? r.rest : '',
    r.avg ?? '', r.durations.map((d) => d ?? '').join(' '), r.note,
  ].map(esc).join(','));
  return [head.join(','), ...rows].join('\n');
}
