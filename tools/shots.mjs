// Screenshot tour of the app through the Chrome DevTools Protocol — no npm dependencies.
// Usage: CHROME=/path/to/chrome node tools/shots.mjs [url] [outDir]
// Needs the dev server running (npm run dev), which exposes window.__mm.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:5173/';
const OUT = process.argv[3] ?? 'shots';
const CHROME = process.env.CHROME;
if (!CHROME) throw new Error('Set CHROME to a Chromium/Chrome binary');
mkdirSync(OUT, { recursive: true });

const port = 9333;
const proc = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + join(OUT, '.profile'), 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const problems = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') problems.push('EXCEPTION ' + msg.params.exceptionDetails.exception?.description);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) problems.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(expression + '\n' + JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
const shot = async (name) => {
  await sleep(350);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  console.log('shot', name);
};
// shift the running session back in time: sessionMs = target session time
const at = (sessionMs) => js(`(() => { const { app, E } = window.__mm; const s = app.session;
  s.startedAt += E.elapsed(s, Date.now()) - (${sessionMs}); })()`);

await send('Runtime.enable');
await send('Page.enable');
await size(390, 844);
await send('Page.navigate', { url: URL_ });
await sleep(1500);
await js(`indexedDB.deleteDatabase('minute-mark'); localStorage.clear(); true`);
await send('Page.reload');
await sleep(1500);
await shot('01-setup');

await js(`document.querySelector('#start').click()`);
await sleep(1200);
await shot('02-ready');
await at(18_000);
await shot('03-work');
await js(`document.querySelector('.run').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
await shot('04-rest-undo');
await at(42_000);
await shot('05-rest');
await at(57_200);
await shot('06-last');
await at(7 * 60_000 + 20_000);
await shot('07-work-set8');
await js(`document.querySelector('#pause').click()`);
await shot('08-paused');

// give a few sets real durations for the summary chart
await js(`(() => { const s = window.__mm.app.session; Object.assign(s.marks, { 1: 24000, 2: 26000, 3: 29000, 4: 31000, 5: 33000, 6: 37000, 7: 44000 }); })()`);
await js(`document.querySelector('#end').click()`);
await sleep(600);
await shot('09-summary');
await js(`(() => { const i = document.querySelector('#exercise'); i.value = 'Push-ups × 15'; document.querySelector('#note').value = 'Last sets were tough'; document.querySelector('#save').click(); })()`);
await sleep(800);
await shot('10-history');

await js(`document.querySelector('#back').click()`);
await sleep(300);
await js(`document.querySelector('[data-go=settings]').click()`);
await shot('11-settings');
await js(`document.querySelector('#back').click()`);

// target reached -> summary with Keep going -> continues at set 3
await js(`window.__mm.app.cfg.target = 2; document.querySelector('#start').click()`);
await sleep(600);
await at(2 * 60_000 + 300);
await sleep(700);
await shot('14-target-summary');
await js(`document.querySelector('#keep').click()`);
await sleep(600);
console.log('after keep going:', await js(`(() => { const { app, E } = window.__mm; const v = E.view(app.session, Date.now()); return v.phase + ' set ' + v.set; })()`));

// app killed mid-session -> restored paused
await send('Page.reload');
await sleep(1500);
await shot('15-restored');
console.log('restored:', await js(`(() => { const { app, E } = window.__mm; const v = E.view(app.session, Date.now()); return (v.paused ? 'paused' : 'running') + ' set ' + v.set; })()`));
await js(`document.querySelector('#end').click()`);
await sleep(400);
await js(`document.querySelector('#discard').click(); document.querySelector('#discard').click()`);
await sleep(400);
await js(`window.__mm.app.cfg.target = 0; true`);

await size(844, 390);
await sleep(300);
await js(`document.querySelector('#start').click()`);
await sleep(800);
await at(4 * 60_000 + 21_000);
await shot('12-landscape-work');
await js(`document.querySelector('.run').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
await at(4 * 60_000 + 40_000);
await shot('13-landscape-rest');

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console errors');
ws.close();
proc.kill();
