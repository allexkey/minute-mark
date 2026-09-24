import { fmtClock, fmtInterval } from '../engine.js';
import { esc, fmtDate, confirmTap } from '../ui.js';

/**
 * rec: { id?, startedAt, interval, sets, totalMs, durations, avg, slowest, exercise, note }
 * opts: { isNew, targetReached }
 */
export function mountSummary(root, app, rec, opts = {}) {
  const bars = rec.durations.map((d) => {
    if (d == null) return '<div class="bar miss" title="Not marked"></div>';
    const slow = rec.slowest != null && d === rec.slowest ? ' slow' : '';
    return `<div class="bar${slow}" style="height:${Math.max(3, Math.min(100, (d / rec.interval) * 100)).toFixed(1)}%" title="${d} s"></div>`;
  }).join('');
  const title = opts.targetReached ? 'Target reached' : opts.isNew ? 'Done' : 'Session';

  root.innerHTML = `
  <main class="screen">
    <header class="hd">
      <h1 class="brand">${title}<i>.</i></h1>
      ${opts.isNew ? `<span class="hint" style="margin:0">${esc(fmtDate(rec.startedAt))}</span>` : '<button class="link" id="back">Back</button>'}
    </header>
    ${opts.isNew ? '' : `<p class="hint" style="margin:0">${esc(fmtDate(rec.startedAt))}</p>`}
    <div class="stats">
      <div class="stat"><b>${rec.sets}</b><span>Sets</span></div>
      <div class="stat"><b>${fmtClock(rec.totalMs)}</b><span>Total</span></div>
      <div class="stat"><b>${rec.avg != null ? `${rec.avg}s` : '—'}</b><span>Avg set</span></div>
    </div>
    ${rec.sets ? `<div class="chart" role="img" aria-label="Time per set">${bars}</div>
    <div class="chart-cap"><span>Set 1</span><span>set time / ${fmtInterval(rec.interval)}</span><span>${rec.sets}</span></div>` : ''}
    <div class="fields">
      <div>
        <label class="flab" for="exercise">Exercise</label>
        <input class="input" id="exercise" list="exercise-list" autocomplete="off" placeholder="e.g. Push-ups × 15" value="${esc(rec.exercise)}">
        <datalist id="exercise-list"></datalist>
      </div>
      <div>
        <label class="flab" for="note">Note</label>
        <textarea class="textarea" id="note" placeholder="How did it feel?">${esc(rec.note)}</textarea>
      </div>
    </div>
    <div class="actions">
      ${opts.isNew
        ? `<button class="bigbtn ghost" id="discard">Discard</button>
           ${opts.targetReached ? '<button class="bigbtn ghost" id="keep">Keep going</button>' : ''}
           <button class="bigbtn go" id="save">Save</button>`
        : `<button class="bigbtn warn" id="delete">Delete</button>
           <button class="bigbtn go" id="save">Save</button>`}
    </div>
  </main>`;

  const $ = (s) => root.querySelector(s);
  app.exercises().then((names) => {
    $('#exercise-list').innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
  });
  const read = () => ({ ...rec, exercise: $('#exercise').value.trim(), note: $('#note').value.trim() });

  $('#save').onclick = () => app.saveRecord(read(), opts);
  if (opts.isNew) {
    confirmTap($('#discard'), 'Tap again', () => app.discard());
    if (opts.targetReached) $('#keep').onclick = () => app.keepGoing();
  } else {
    $('#back').onclick = () => app.go('history');
    confirmTap($('#delete'), 'Tap again', () => app.deleteRecord(rec.id));
  }
}
