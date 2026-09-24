// Checks that every screen fits on one page (no scroll, main button visible) on real iPhone sizes,
// including the safe areas of the installed app. Uses the Chrome DevTools Protocol, no npm deps.
// Usage: CHROME=/path/to/chrome node tools/fit-check.mjs [url] [shotsDir]   (needs `npm run dev`)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT = process.argv[3];
if (OUT) mkdirSync(OUT, { recursive: true });

// CSS viewport and safe-area insets (top, bottom) as the installed app (standalone) sees them
// stress: text 12% larger, to cover font-metric differences between Chromium and Safari
const DEVICES = [
  { name: 'iPhone 15 Pro Max, Display Zoom "Larger Text" (app)', w: 375, h: 812, sat: 51, sab: 34, shots: true },
  { name: 'iPhone 15 Pro Max, Larger Text (app) + stress', w: 375, h: 812, sat: 51, sab: 34, stress: true },
  { name: 'iPhone 15 Pro Max (app)', w: 430, h: 932, sat: 59, sab: 34 },
  { name: 'iPhone 15 Pro Max (Safari)', w: 430, h: 739, sat: 0, sab: 0 },
  { name: 'iPhone 15 / 14 (app)', w: 393, h: 852, sat: 59, sab: 34 },
  { name: 'iPhone 13 mini (app)', w: 375, h: 812, sat: 50, sab: 34 },
  { name: 'iPhone SE (app)', w: 375, h: 667, sat: 20, sab: 0 },
];

const port = 9337;
const proc = spawn(process.env.CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--autoplay-policy=no-user-gesture-required',
  `--user-data-dir=${join(OUT ?? '/tmp', '.fit-profile')}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(expression + '\n' + JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

const at = (ms) => js(`(() => { const { app, E } = window.__mm; const s = app.session; s.startedAt += E.elapsed(s, Date.now()) - (${ms}); })()`);
const tap = () => js(`document.querySelector('.run').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
const click = (sel) => js(`document.querySelector('${sel}').click()`);

// Scenarios: how to reach the screen, and which element must be fully visible.
const SCENARIOS = [
  { name: 'setup EMOM', key: '#start', go: async () => { await js(`window.__mm.app.cfg.type = 'emom'; window.__mm.app.go('setup')`); } },
  { name: 'setup Rest timer', key: '#start', go: async () => { await js(`window.__mm.app.cfg.type = 'rest'; window.__mm.app.go('setup')`); } },
  { name: 'run EMOM work', key: '#pause', go: async () => { await js(`window.__mm.app.cfg.type = 'emom'; window.__mm.app.go('setup')`); await click('#start'); await sleep(300); await at(18_000); } },
  { name: 'run Rest timer rest', key: '#pause', also: '#restctl', go: async () => { await js(`window.__mm.app.cfg.type = 'rest'; window.__mm.app.go('setup')`); await click('#start'); await sleep(300); await at(30_000); await tap(); } },
  { name: 'paused', key: '#resume', go: async () => { await click('#pause'); } },
  { name: 'summary', key: '#save', go: async () => { await click('#end'); await sleep(300); } },
  { name: 'settings', key: '#csv', go: async () => { await js(`window.__mm.app.go('settings')`); } },
];

let failures = 0;
await send('Runtime.enable');
for (const d of DEVICES) {
  await send('Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: URL_ });
  await sleep(1200);
  await js(`localStorage.clear(); true`);
  await send('Page.reload');
  await sleep(1200);
  // env(safe-area-inset-*) is 0 in headless Chrome; the CSS reads them through these variables
  await js(`document.documentElement.style.setProperty('--sat', '${d.sat}px'); document.documentElement.style.setProperty('--sab', '${d.sab}px'); true`);
  if (d.stress) await js(`(() => { const st = document.createElement('style'); st.textContent = '#app { zoom: 1.0 } .hint, .flab, .link, .seg button, .foot, .toggle { font-size: 112% !important; }'; document.head.append(st); })()`);
  console.log(`\n${d.name} — ${d.w}×${d.h}, safe area ${d.sat}/${d.sab}`);
  for (const sc of SCENARIOS) {
    await sc.go();
    await sleep(350);
    const m = await js(`(() => {
      const scr = document.querySelector('.screen, .run');
      const vis = innerHeight - ${d.sab};
      const bottom = (sel) => { const el = sel && document.querySelector(sel); if (!el || el.hidden) return null; return Math.round(el.getBoundingClientRect().bottom); };
      // any scrolling, on the screen itself or inside it (e.g. the setup fields above the pinned START)
      const inner = [...scr.querySelectorAll('*')].filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY));
      const scroll = Math.max(scr.scrollHeight - scr.clientHeight, ...inner.filter((el) => !el.classList.contains('filters')).map((el) => el.scrollHeight - el.clientHeight));
      return { scroll, key: bottom('${sc.key}'), also: bottom('${sc.also ?? ''}'), vis };
    })()`);
    const hidden = [m.key, m.also].filter((b) => b != null && b > m.vis);
    const ok = m.scroll <= 0 && hidden.length === 0 && m.key != null;
    if (!ok) failures++;
    const spare = m.key != null ? m.vis - m.key : null;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${sc.name.padEnd(20)} scroll ${String(Math.max(0, m.scroll)).padStart(3)}px · ${sc.key} ${spare != null && spare < 0 ? `${-spare}px below the screen` : `${spare}px spare`}`);
    if (OUT && d.shots) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `${sc.name.replace(/\W+/g, '-')}.png`), Buffer.from(r.result.data, 'base64'));
    }
  }
  await js(`window.__mm.app.session = null; localStorage.clear(); true`);
}
console.log(failures ? `\n${failures} screen(s) do not fit` : '\nall screens fit');
ws.close();
proc.kill();
process.exit(failures ? 1 : 0);
