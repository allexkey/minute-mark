import { toCSV } from '../store.js';
import { offerFile } from '../ui.js';

export function mountSettings(root, app) {
  const cfg = app.cfg;
  root.innerHTML = `
  <main class="screen">
    <header class="hd">
      <h1 class="brand">Settings</h1>
      <button class="link" id="back">Back</button>
    </header>
    <div class="fields">
      <div>
        <label class="toggle"><span>Announce every 5 minutes<small>“10 minutes” instead of “Set 10”</small></span><input type="checkbox" id="announce"></label>
        <label class="toggle"><span>Say “Rest”<small>Voice confirmation when a set is marked</small></span><input type="checkbox" id="sayrest"></label>
      </div>
      <div>
        <p class="flab">Back up your history</p>
        <p class="hint" style="margin-top:0">iOS can clear data of apps left unused for weeks. Export a copy from time to time.</p>
        <div class="rowbtns">
          <button class="chipbtn" id="csv">Export CSV</button>
          <button class="chipbtn" id="json">Export JSON</button>
        </div>
      </div>
    </div>
    <p class="hint">Minute Mark · version ${__APP_VERSION__}</p>
  </main>`;

  const $ = (s) => root.querySelector(s);
  $('#announce').checked = cfg.announceMinutes;
  $('#sayrest').checked = cfg.sayRest;
  $('#announce').onchange = (e) => { cfg.announceMinutes = e.target.checked; app.saveCfg(); };
  $('#sayrest').onchange = (e) => { cfg.sayRest = e.target.checked; app.saveCfg(); };
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('#csv').onclick = async () => offerFile(`minute-mark-${stamp()}.csv`, 'text/csv', toCSV(await app.history()));
  $('#json').onclick = async () => offerFile(`minute-mark-${stamp()}.json`, 'application/json', JSON.stringify(await app.history(), null, 2));
  $('#back').onclick = () => app.go('setup');
}
