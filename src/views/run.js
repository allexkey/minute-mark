import { fmtClock, fmtRemaining } from '../engine.js';
import { icons, modeChip, ring } from '../ui.js';

export const UNDO_WINDOW_MS = 3000;

/** Text and layout for a phase; pure so it can be reasoned about apart from the DOM. */
export function describe(v, s, mode) {
  const done = (n) => (s.marks[n] != null ? `Set ${n}: ${Math.round(s.marks[n] / 1000)} s` : null);
  switch (v.phase) {
    case 'ready':
      return { label: 'Get ready', big: String(Math.max(1, Math.ceil(v.remainingMs / 1000))), xl: true, rem: '', foot: 'Set 1 starts soon' };
    case 'last':
      return { label: `Set ${v.set + 1} in`, big: String(Math.max(1, Math.ceil(v.remainingMs / 1000))), xl: true, rem: '', foot: done(v.set) ?? 'Get ready' };
    case 'rest':
      return { label: 'Rest', big: String(v.set), rem: fmtRemaining(v.remainingMs), foot: `${done(v.set)} · next: set ${v.set + 1}` };
    case 'target':
      return { label: 'Target reached', big: String(v.set), rem: '', foot: '' };
    default:
      return {
        label: 'Set', big: String(v.set), rem: fmtRemaining(v.remainingMs),
        foot: mode === 'airpods' ? 'Tap or press AirPods when done' : 'Tap anywhere when done',
      };
  }
}

function pausedFoot(v) {
  if (v.phase === 'ready') return 'Countdown paused';
  const where = { rest: 'rest', last: 'next set soon' }[v.phase] ?? 'work';
  return `Set ${v.set} · ${where}`;
}

export function mountRun(root, app) {
  root.innerHTML = `
  <main class="run" data-phase="ready" aria-live="off">
    <div class="flash"></div>
    <header class="run-top"><span>Total<b id="total">00:00</b></span><span class="chip">${modeChip(app.session.mode)}</span></header>
    <p class="lbl" id="label"></p>
    <div class="dial">${ring()}<div class="dial-in"><div class="setn" id="big"></div><div class="rem" id="rem"></div></div></div>
    <p class="foot" id="foot"></p>
    <button class="undo" id="undo" hidden>Undo</button>
    <footer class="run-bot">
      <button class="pbtn" id="pause" aria-label="Pause">${icons.pause}</button>
      <div class="paused-actions" id="paused-actions" hidden>
        <button class="bigbtn ghost" id="end">End</button>
        <button class="bigbtn go" id="resume">Resume</button>
      </div>
    </footer>
    <div class="toast" id="toast" role="status" hidden></div>
  </main>`;

  const $ = (s) => root.querySelector(s);
  const el = {
    run: $('.run'), flash: $('.flash'), total: $('#total'), label: $('#label'), big: $('#big'), rem: $('#rem'),
    foot: $('#foot'), undo: $('#undo'), pause: $('#pause'), paused: $('#paused-actions'), ring: $('.ring .val'), toast: $('#toast'),
  };
  const last = {};
  const put = (key, node, prop, value) => { if (last[key] !== value) { last[key] = value; node[prop] = value; } };

  // Tap anywhere (outside the buttons) = set done.
  el.run.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    app.markDone();
  });
  el.undo.onclick = () => app.undo();
  el.pause.onclick = () => app.pause();
  $('#resume').onclick = () => app.resume();
  $('#end').onclick = () => app.end();

  let toastTimer = null;
  return {
    update(v, s, { markedWallAt }) {
      const d = describe(v, s, s.mode);
      put('phase', el.run.dataset, 'phase', v.phase);
      put('paused', el.run.dataset, 'paused', String(v.paused));
      put('total', el.total, 'textContent', fmtClock(v.totalMs));
      put('label', el.label, 'textContent', v.paused ? 'Paused' : d.label);
      put('big', el.big, 'textContent', d.big);
      put('xl', el.big, 'className', d.xl ? 'setn xl' : 'setn');
      put('rem', el.rem, 'textContent', d.rem);
      put('foot', el.foot, 'textContent', v.paused ? pausedFoot(v) : d.foot);
      put('ring', el.ring.style, 'strokeDashoffset', (100 - Math.max(0, Math.min(1, v.frac)) * 100).toFixed(2));
      const showUndo = !v.paused && v.markedAt != null && v.phase === 'rest' && Date.now() - markedWallAt < UNDO_WINDOW_MS;
      put('undo', el.undo, 'hidden', !showUndo);
      put('pbtn', el.pause, 'hidden', v.paused);
      put('pa', el.paused, 'hidden', !v.paused);
    },
    flash() {
      el.flash.classList.remove('go');
      void el.flash.offsetWidth;
      el.flash.classList.add('go');
    },
    toast(msg) {
      el.toast.textContent = msg;
      el.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3500);
    },
  };
}
