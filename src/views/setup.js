import { fmtInterval } from '../engine.js';
import { icons } from '../ui.js';

const HINT = {
  airpods: 'Other music will stop. Press your AirPods once to finish a set, twice to undo.',
  music: 'Cues play over your music. Tap the screen to finish a set.',
};

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
        <p class="flab" id="l-int">Interval</p>
        <div class="stepper" role="group" aria-labelledby="l-int">
          <button id="int-down" aria-label="Shorter interval">−</button>
          <output id="int" aria-live="polite"></output>
          <button id="int-up" aria-label="Longer interval">+</button>
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
  function paint() {
    $('#int').textContent = fmtInterval(cfg.interval);
    $('#tg').textContent = cfg.target || '∞';
    $('#tg-hint').textContent = cfg.target ? `Stops after ${cfg.target} sets` : 'No target: runs until you end it';
    $('#int-down').disabled = cfg.interval <= 30;
    $('#int-up').disabled = cfg.interval >= 300;
    $('#tg-down').disabled = cfg.target <= 0;
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === cfg.mode)));
    $('#mode-hint').textContent = HINT[cfg.mode];
  }
  const change = (fn) => () => { fn(); app.saveCfg(); paint(); };
  $('#int-down').onclick = change(() => { cfg.interval = Math.max(30, cfg.interval - 15); });
  $('#int-up').onclick = change(() => { cfg.interval = Math.min(300, cfg.interval + 15); });
  $('#tg-down').onclick = change(() => { cfg.target = Math.max(0, cfg.target - 1); });
  $('#tg-up').onclick = change(() => { cfg.target = Math.min(99, cfg.target + 1); });
  root.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = change(() => { cfg.mode = b.dataset.mode; }); });
  root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => app.go(b.dataset.go); });
  $('#start').onclick = () => app.start();
  paint();
}
