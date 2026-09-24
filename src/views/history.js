import { fmtClock, fmtInterval } from '../engine.js';
import { esc, fmtDate } from '../ui.js';

export async function mountHistory(root, app) {
  const list = await app.history();
  const names = [...new Set(list.map((r) => r.exercise).filter(Boolean))];
  let filter = app.historyFilter ?? '';
  if (filter && !names.includes(filter)) filter = '';

  root.innerHTML = `
  <main class="screen">
    <header class="hd">
      <h1 class="brand">History</h1>
      <button class="link" id="back">Back</button>
    </header>
    ${names.length ? `<div class="filters" role="group" aria-label="Filter by exercise">
      <button class="chipbtn" data-f="">All</button>
      ${names.map((n) => `<button class="chipbtn" data-f="${esc(n)}">${esc(n)}</button>`).join('')}
    </div>` : ''}
    <ul class="hlist" id="list"></ul>
  </main>`;

  const $ = (s) => root.querySelector(s);
  function paint() {
    root.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === filter)));
    const rows = filter ? list.filter((r) => r.exercise === filter) : list;
    $('#list').innerHTML = rows.length
      ? rows.map((r) => `<li><button class="hrow" data-id="${r.id}">
          <span class="h1"><span>${esc(fmtDate(r.startedAt))}</span><b>${r.sets} ${r.sets === 1 ? 'set' : 'sets'}</b></span>
          <span class="h2">${fmtClock(r.totalMs)} · interval ${fmtInterval(r.interval)} · avg ${r.avg != null ? `${r.avg}s` : '—'}</span>
          ${r.exercise || r.note ? `<span class="h3">${esc([r.exercise, r.note].filter(Boolean).join(' · '))}</span>` : ''}
        </button></li>`).join('')
      : '<li class="empty">No sessions yet. Saved sessions show up here.</li>';
  }
  root.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filter = b.dataset.f; app.historyFilter = filter; paint(); }; });
  $('#list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (row) app.openRecord(Number(row.dataset.id));
  });
  $('#back').onclick = () => app.go('setup');
  paint();
}
