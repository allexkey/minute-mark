import {
  fmtClock, fmtRemaining, fmtElapsed, REST_STEP_MS, PREP_MS, READY_MS, elapsed, remainingToEnd, inSets,
} from '../engine.js';
import { icons, ring } from '../ui.js';

export const UNDO_WINDOW_MS = 3000;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Text and layout for a phase; pure so it can be reasoned about apart from the DOM. */
export function describe(v, s, mode) {
  const done = (n) => (s.marks[n] != null ? `Set ${n}: ${Math.round(s.marks[n] / 1000)} s` : null);
  const secs = () => String(Math.max(1, Math.ceil(v.remainingMs / 1000)));
  // a minute-long countdown shows m:ss, its last 10 s big single digits
  const countdown = () => (v.remainingMs > 10_000 ? { big: fmtRemaining(v.remainingMs), cls: 'time' } : { big: secs(), cls: 'xl' });
  const restType = s.type === 'rest';
  switch (v.phase) {
    case 'warmup':
      return { label: 'Warm-up', big: fmtRemaining(v.remainingMs), cls: 'time', rem: '', foot: 'Then 1 min to get ready' };
    case 'ready':
      return v.long
        ? { label: 'Sets start in', ...countdown(), rem: '', foot: `Set 1 · ${restType ? 'Rest timer' : 'EMOM'}` }
        : { label: 'Get ready', big: secs(), cls: 'xl', rem: '', foot: 'Set 1 starts soon' };
    case 'prep':
      return { label: 'Stretch in', ...countdown(), rem: '', foot: `${v.set} ${v.set === 1 ? 'set' : 'sets'} done. Well done.` };
    case 'stretch':
      return { label: 'Stretch', big: fmtRemaining(v.remainingMs), cls: 'time', rem: '', foot: 'The session ends after this' };
    case 'last':
      return { label: `Set ${v.set + 1} in`, big: secs(), cls: 'xl', rem: '', foot: done(v.set) ?? 'Get ready' };
    case 'rest':
      // rest timer: the countdown is the big number; EMOM: the set number stays big
      return restType
        ? { label: 'Rest', big: fmtRemaining(v.remainingMs), cls: 'time', rem: '', foot: `${done(v.set)} · next: set ${v.set + 1}` }
        : { label: 'Rest', big: String(v.set), cls: '', rem: fmtRemaining(v.remainingMs), foot: `${done(v.set)} · next: set ${v.set + 1}` };
    case 'target':
      return { label: 'Target reached', big: String(v.set), cls: '', rem: '', foot: '' };
    case 'done':
      return { label: 'Done', big: String(v.set), cls: '', rem: '', foot: '' };
    default:
      return {
        label: 'Set', big: String(v.set), cls: '',
        rem: restType ? fmtElapsed(v.inSetMs) : fmtRemaining(v.remainingMs),
        foot: mode === 'airpods' ? 'Tap or press AirPods when done' : 'Tap anywhere when done',
      };
  }
}

function pausedFoot(v) {
  const stage = { warmup: 'Warm-up paused', ready: 'Countdown paused', prep: 'Countdown paused', stretch: 'Stretch paused' }[v.phase];
  if (stage) return stage;
  const where = { rest: 'rest', last: 'next set soon' }[v.phase] ?? 'work';
  return `Set ${v.set} · ${where}`;
}

/** The session strip: warm-up · get ready · sets · prep · stretch, each filling as you go. */
export function stages(s, now) {
  const e = elapsed(s, now);
  const W = s.warmupMs ?? 0;
  const R = s.readyMs ?? READY_MS;
  const S = s.stretchMs ?? 0;
  const out = [];
  if (W) out.push({ k: 'warm', len: W, fill: clamp01((e + R + W) / W) });
  out.push({ k: 'prep', len: R, fill: clamp01((e + R) / R) });
  let setsLen;
  let open = false;
  if (s.mainEnd != null) setsLen = Math.max(1, s.mainEnd);
  else if (s.target && s.type === 'emom') setsLen = s.target * s.interval;
  else if (s.target) setsLen = s.target * (45_000 + s.restMs);
  else { open = true; setsLen = Math.max(10 * 60_000, e + 60_000); }
  out.push({ k: 'sets', len: setsLen, fill: s.mainEnd != null ? 1 : clamp01(e / setsLen), open: open && s.mainEnd == null });
  if (S) {
    const d = s.mainEnd != null ? e - s.mainEnd : -1;
    out.push({ k: 'prep', len: PREP_MS, fill: clamp01(d / PREP_MS) });
    out.push({ k: 'stretch', len: S, fill: clamp01((d - PREP_MS) / S) });
  }
  return out;
}

function toGo(s, now) {
  const r = remainingToEnd(s, now);
  if (r.open) return r.ms > 0 ? `sets + ${fmtClock(r.ms)} to go` : 'open session';
  return `${r.approx ? '~' : ''}${fmtClock(r.ms)} to go`;
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function mountRun(root, app) {
  const s0 = app.session;
  root.innerHTML = `
  <main class="run" data-phase="ready" data-type="${s0.type}" aria-live="off">
    <div class="flash"></div>
    <header class="run-top">
      <span class="t-total">Total<b id="total">00:00</b></span>
      <span class="t-clock"><b id="clock">--:--</b><i class="mode-ico" aria-label="${s0.mode === 'airpods' ? 'AirPods mode' : 'With music'}">${s0.mode === 'airpods' ? icons.pods : icons.music}</i></span>
      <div class="strip" id="strip" aria-hidden="true"></div>
    </header>
    <p class="lbl" id="label"></p>
    <div class="dial">${ring()}<div class="dial-in"><div class="setn" id="big"></div><div class="rem" id="rem"></div></div></div>
    <p class="foot" id="foot"></p>
    <button class="undo" id="undo" hidden>Undo</button>
    <footer class="run-bot">
      <div class="restctl" id="restctl" hidden>
        <button class="restbtn" data-adjust="-1" aria-label="${REST_STEP_MS / 1000} seconds less rest">−${REST_STEP_MS / 1000}s</button>
        <button class="restbtn skip" id="skip">Skip</button>
        <button class="restbtn" data-adjust="1" aria-label="${REST_STEP_MS / 1000} seconds more rest">+${REST_STEP_MS / 1000}s</button>
      </div>
      <div class="restctl" id="stagectl" hidden><button class="restbtn skip" id="skip-stage">Skip</button></div>
      <p class="togo" id="togo"></p>
      <button class="pbtn" id="pause" aria-label="Pause">${icons.pause}</button>
      <div class="paused-actions" id="paused-actions" hidden>
        <button class="bigbtn ghost" id="end">End</button>
        <button class="bigbtn ghost" id="stretch" hidden>Stretch</button>
        <button class="bigbtn go" id="resume">Resume</button>
      </div>
    </footer>
    <div class="toast" id="toast" role="status" hidden></div>
  </main>`;

  const $ = (q) => root.querySelector(q);
  const el = {
    run: $('.run'), flash: $('.flash'), total: $('#total'), clock: $('#clock'), strip: $('#strip'), label: $('#label'),
    big: $('#big'), rem: $('#rem'), foot: $('#foot'), undo: $('#undo'), pause: $('#pause'), paused: $('#paused-actions'),
    ring: $('.ring .val'), toast: $('#toast'), restctl: $('#restctl'), stagectl: $('#stagectl'), skipStage: $('#skip-stage'),
    togo: $('#togo'), stretch: $('#stretch'),
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
  el.stretch.onclick = () => app.stretch();
  $('#skip').onclick = () => app.skipRest();
  el.skipStage.onclick = () => app.skipStage();
  root.querySelectorAll('[data-adjust]').forEach((b) => { b.onclick = () => app.adjustRest(Number(b.dataset.adjust) * REST_STEP_MS); });

  let toastTimer = null;
  return {
    update(v, s, { markedWallAt }) {
      const now = Date.now();
      const d = describe(v, s, s.mode);
      put('phase', el.run.dataset, 'phase', v.phase);
      put('long', el.run.dataset, 'long', String(!!v.long));
      put('paused', el.run.dataset, 'paused', String(v.paused));
      put('total', el.total, 'textContent', fmtClock((s.pausedAt ?? now) - (s.wallStart ?? s.startedAt)));
      put('clock', el.clock, 'textContent', clockFmt.format(now));
      const strip = stages(s, now).map((g) => `<i class="seg ${g.k}${g.open ? ' open' : ''}" style="flex-grow:${g.len}"><i style="width:${(g.fill * 100).toFixed(1)}%"></i></i>`).join('');
      put('strip', el.strip, 'innerHTML', strip);
      put('label', el.label, 'textContent', v.paused ? 'Paused' : d.label);
      put('big', el.big, 'textContent', d.big);
      put('cls', el.big, 'className', `setn ${d.cls}${d.cls === 'time' && d.big.length >= 5 ? ' long' : ''}`.trim());
      put('rem', el.rem, 'textContent', d.rem);
      put('foot', el.foot, 'textContent', v.paused ? pausedFoot(v) : d.foot);
      put('togo', el.togo, 'textContent', toGo(s, now));
      put('ring', el.ring.style, 'strokeDashoffset', (100 - clamp01(v.frac) * 100).toFixed(2));
      const showUndo = !v.paused && v.markedAt != null && v.phase === 'rest' && now - markedWallAt < UNDO_WINDOW_MS;
      put('undo', el.undo, 'hidden', !showUndo);
      put('pbtn', el.pause, 'hidden', v.paused);
      put('restctl', el.restctl, 'hidden', !(s.type === 'rest' && !v.paused && (v.phase === 'rest' || v.phase === 'last')));
      const stage = !v.paused && ['warmup', 'ready', 'prep', 'stretch'].includes(v.phase) && !(v.phase === 'ready' && !v.long);
      put('stagectl', el.stagectl, 'hidden', !stage);
      put('skiplabel', el.skipStage, 'textContent', { warmup: 'Skip warm-up', stretch: 'Skip stretch' }[v.phase] ?? 'Skip');
      put('pa', el.paused, 'hidden', !v.paused);
      const canStretch = !!s.stretchMs && s.mainEnd == null && inSets(v);
      put('stretchbtn', el.stretch, 'hidden', !canStretch);
      put('three', el.paused.classList, 'value', canStretch ? 'paused-actions three' : 'paused-actions');
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
