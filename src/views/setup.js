import { fmtInterval } from '../engine.js';
import { icons } from '../ui.js';

const TYPE_HINT = {
  emom: 'Every minute on the minute: a new set starts every interval.',
  rest: 'Work at your own pace. When you finish a set, the rest countdown starts, then the next set.',
};
const MODE_HINT = {
  airpods: 'Other music will stop. Press your AirPods once to finish a set, twice to undo.',
  music: 'Cues play over your music. Tap the screen to finish a set.',
};
const LIMITS = { interval: [30, 300], rest: [15, 300] };

export function mountSetup(root, app) {
  const cfg = app.cfg;
  root.innerHTML = `
  <main class="screen">
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
      <div>
        <p class="flab" id="l-dur"></p>
        <div class="stepper" role="group" aria-labelledby="l-dur">
          <button id="dur-down" aria-label="Shorter">−</button>
          <output id="dur" aria-live="polite"></output>
          <button id="dur-up" aria-label="Longer">+</button>
        </div>
      </div>
      <div>
        <p class="flab" id="l-tg">Target sets</p>
        <div class="stepper sm" role="group" aria-labelledby="l-tg">
          <button id="tg-down" aria-label="Fewer sets">−</button>
          <output id="tg" aria-live="polite"></output>
          <button id="tg-up" aria-label="More sets">+</button>
        </div>
        <p class="hint" id="tg-hint"></p>
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
    <button class="bigbtn go start" id="start">Start</button>
  </main>`;

  const $ = (s) => root.querySelector(s);
  // the stepper edits the interval (EMOM) or the rest (rest timer)
  const key = () => (cfg.type === 'rest' ? 'rest' : 'interval');
  function paint() {
    const k = key();
    const [min, max] = LIMITS[k];
    $('#l-dur').textContent = k === 'rest' ? 'Rest between sets' : 'Interval';
    $('#dur').textContent = fmtInterval(cfg[k]);
    $('#dur-down').disabled = cfg[k] <= min;
    $('#dur-up').disabled = cfg[k] >= max;
    $('#tg').textContent = cfg.target || '∞';
    $('#tg-hint').textContent = cfg.target ? `Stops after ${cfg.target} sets` : 'No target: runs until you end it';
    $('#tg-down').disabled = cfg.target <= 0;
    root.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === cfg.type)));
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === cfg.mode)));
    $('#type-hint').textContent = TYPE_HINT[cfg.type];
    $('#mode-hint').textContent = MODE_HINT[cfg.mode];
  }
  const change = (fn) => () => { fn(); app.saveCfg(); paint(); };
  $('#dur-down').onclick = change(() => { const k = key(); cfg[k] = Math.max(LIMITS[k][0], cfg[k] - 15); });
  $('#dur-up').onclick = change(() => { const k = key(); cfg[k] = Math.min(LIMITS[k][1], cfg[k] + 15); });
  $('#tg-down').onclick = change(() => { cfg.target = Math.max(0, cfg.target - 1); });
  $('#tg-up').onclick = change(() => { cfg.target = Math.min(99, cfg.target + 1); });
  root.querySelectorAll('[data-type]').forEach((b) => { b.onclick = change(() => { cfg.type = b.dataset.type; }); });
  root.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = change(() => { cfg.mode = b.dataset.mode; }); });
  root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => app.go(b.dataset.go); });
  $('#start').onclick = () => app.start();
  paint();
}
