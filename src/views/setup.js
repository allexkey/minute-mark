import { fmtInterval, fmtClock, PREP_MS } from '../engine.js';
import { icons } from '../ui.js';

const TYPE_HINT = {
  emom: 'A new set starts every interval.',
  rest: 'Tap when done: the rest counts down, then the next set.',
};
const MODE_HINT = {
  airpods: 'Other music stops. AirPods: press once = set done, twice = undo.',
  music: 'Cues play over your music. Tap the screen when a set is done.',
};
const LIMITS = { interval: [30, 300], rest: [15, 300] };
const STAGE_OPTIONS = [0, 5, 10]; // minutes

const clockFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** The plan line: what the session looks like, how long it takes and when it ends. */
export function plan(cfg, now = Date.now()) {
  const parts = [];
  let ms = 0;
  let approx = false;
  let open = false;
  if (cfg.warmup) { parts.push(`${cfg.warmup} min warm-up`); ms += cfg.warmup * 60_000 + PREP_MS; }
  if (cfg.type === 'emom') {
    parts.push(cfg.target ? `${cfg.target} × ${fmtInterval(cfg.interval)}` : `sets every ${fmtInterval(cfg.interval)}`);
    if (cfg.target) ms += cfg.target * cfg.interval * 1000; else open = true;
  } else {
    parts.push(cfg.target ? `${cfg.target} sets, ${fmtInterval(cfg.rest)} rest` : `sets, ${fmtInterval(cfg.rest)} rest`);
    // estimate 45 s per set until the app knows your pace
    if (cfg.target) { ms += cfg.target * 45_000 + (cfg.target - 1) * cfg.rest * 1000; approx = true; } else open = true;
  }
  if (cfg.stretch) { parts.push(`${cfg.stretch} min stretch`); ms += PREP_MS + cfg.stretch * 60_000; }
  let when;
  if (open) when = ms ? `sets + ${fmtClock(ms)}` : 'open-ended';
  else when = `${approx ? '~' : ''}${fmtClock(ms)} · ends ${approx ? '~' : ''}${clockFmt.format(now + ms)}`;
  return { text: parts.join(' → '), when };
}

export function mountSetup(root, app) {
  const cfg = app.cfg;
  const seg3 = (name) => STAGE_OPTIONS.map((m) => `<button data-${name}="${m}">${m ? `${m}′` : 'Off'}</button>`).join('');
  root.innerHTML = `
  <main class="screen setup">
    <header class="hd">
      <h1 class="brand">Minute Mark<i>.</i></h1>
      <div class="hd-links">
        <button class="link" data-go="history">History</button>
        <button class="iconbtn" data-go="settings" aria-label="Settings">${icons.gear}</button>
      </div>
    </header>
    <div class="fields">
      <div>
        <p class="flab" id="l-type">Timer</p>
        <div class="seg" role="group" aria-labelledby="l-type">
          <button data-type="emom">EMOM</button>
          <button data-type="rest">Rest timer</button>
        </div>
        <p class="hint" id="type-hint"></p>
      </div>
      <div class="pair">
        <div>
          <p class="flab" id="l-dur"></p>
          <div class="stepper half" role="group" aria-labelledby="l-dur">
            <button id="dur-down" aria-label="Shorter">−</button>
            <output id="dur" aria-live="polite"></output>
            <button id="dur-up" aria-label="Longer">+</button>
          </div>
        </div>
        <div>
          <p class="flab" id="l-tg">Target sets</p>
          <div class="stepper half" role="group" aria-labelledby="l-tg">
            <button id="tg-down" aria-label="Fewer sets">−</button>
            <output id="tg" aria-live="polite" aria-label="Target sets, infinity means no target"></output>
            <button id="tg-up" aria-label="More sets">+</button>
          </div>
        </div>
      </div>
      <div class="pair">
        <div>
          <p class="flab" id="l-warm"><span class="dot warm"></span>Warm-up</p>
          <div class="seg seg3" role="group" aria-labelledby="l-warm">${seg3('warmup')}</div>
        </div>
        <div>
          <p class="flab" id="l-stretch"><span class="dot stretch"></span>Stretch</p>
          <div class="seg seg3" role="group" aria-labelledby="l-stretch">${seg3('stretch')}</div>
        </div>
      </div>
      <div>
        <p class="flab" id="l-mode">Audio</p>
        <div class="seg" role="group" aria-labelledby="l-mode">
          <button data-mode="airpods">${icons.pods}AirPods</button>
          <button data-mode="music">${icons.music}With music</button>
        </div>
        <p class="hint" id="mode-hint"></p>
      </div>
    </div>
    <footer class="startbar">
      <div class="plan" id="plan" aria-live="polite"><div class="plan-bar" id="plan-bar" aria-hidden="true"></div><p id="plan-text"></p><p id="plan-when"></p></div>
      <button class="bigbtn go start" id="start">Start</button>
    </footer>
  </main>`;

  const $ = (s) => root.querySelector(s);
  // the stepper edits the interval (EMOM) or the rest (rest timer)
  const key = () => (cfg.type === 'rest' ? 'rest' : 'interval');
  function paint() {
    const k = key();
    const [min, max] = LIMITS[k];
    $('#l-dur').textContent = k === 'rest' ? 'Rest' : 'Interval';
    $('#dur').textContent = fmtInterval(cfg[k]);
    $('#dur-down').disabled = cfg[k] <= min;
    $('#dur-up').disabled = cfg[k] >= max;
    $('#tg').textContent = cfg.target || '∞';
    $('#tg-down').disabled = cfg.target <= 0;
    const pressed = (attr, value) => root.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value))));
    pressed('type', cfg.type);
    pressed('mode', cfg.mode);
    pressed('warmup', cfg.warmup);
    pressed('stretch', cfg.stretch);
    $('#type-hint').textContent = TYPE_HINT[cfg.type];
    $('#mode-hint').textContent = MODE_HINT[cfg.mode];
    const p = plan(cfg);
    $('#plan-text').textContent = p.text;
    $('#plan-when').textContent = p.when;
    const setsLen = cfg.type === 'emom' ? (cfg.target || 10) * cfg.interval : (cfg.target || 5) * (45 + cfg.rest);
    const segs = [
      cfg.warmup && ['warm', cfg.warmup * 60], cfg.warmup && ['prep', 60],
      ['sets', setsLen], cfg.stretch && ['prep', 60], cfg.stretch && ['stretch', cfg.stretch * 60],
    ].filter(Boolean);
    $('#plan-bar').innerHTML = segs.map(([k2, len]) => `<i class="${k2}${k2 === 'sets' && !cfg.target ? ' open' : ''}" style="flex-grow:${len}"></i>`).join('');
  }
  const change = (fn) => () => { fn(); app.saveCfg(); paint(); };
  $('#dur-down').onclick = change(() => { const k = key(); cfg[k] = Math.max(LIMITS[k][0], cfg[k] - 15); });
  $('#dur-up').onclick = change(() => { const k = key(); cfg[k] = Math.min(LIMITS[k][1], cfg[k] + 15); });
  $('#tg-down').onclick = change(() => { cfg.target = Math.max(0, cfg.target - 1); });
  $('#tg-up').onclick = change(() => { cfg.target = Math.min(99, cfg.target + 1); });
  root.querySelectorAll('[data-type]').forEach((b) => { b.onclick = change(() => { cfg.type = b.dataset.type; }); });
  root.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = change(() => { cfg.mode = b.dataset.mode; }); });
  root.querySelectorAll('[data-warmup]').forEach((b) => { b.onclick = change(() => { cfg.warmup = Number(b.dataset.warmup); }); });
  root.querySelectorAll('[data-stretch]').forEach((b) => { b.onclick = change(() => { cfg.stretch = Number(b.dataset.stretch); }); });
  root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => app.go(b.dataset.go); });
  $('#start').onclick = () => app.start();
  paint();
}
