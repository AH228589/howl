// End-to-end run of the real Electron app against the fake League client.
// Windows stay invisible (opacity 0, no focus) and screenshots of every view
// are written to the folder given as the first argument.
//   node test/e2e.js <screenshot-folder>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const fake = require('./fake-league');
const fakeApi = require('./fake-riot-api');

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'howl-shots'));
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve, reject) => http.get(url, (res) => {
  let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
}).on('error', reject));

class Page {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); }
  open() {
    return new Promise((resolve) => {
      this.ws.on('open', resolve);
      this.ws.on('message', (m) => { const msg = JSON.parse(m); this.pending.get(msg.id)?.(msg); this.pending.delete(msg.id); });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  }
  async shot(file, clip) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, 'base64'));
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const f = await fake.start({ lcuPort: 47201, livePort: 47202 });
  const riot = await fakeApi.start({ port: 47203 });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'howl-e2e-'));
  const electron = require('electron');
  // HOWL_E2E_EXE runs the packaged app instead of the source.
  const exe = process.env.HOWL_E2E_EXE;
  const app = spawn(exe || electron, exe ? [`--remote-debugging-port=${PORT}`] : ['.', `--remote-debugging-port=${PORT}`], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOWL_TEST: '1', HOWL_DATA: dataDir, HOWL_LCU: `${f.lcuPort}:${f.password}`, HOWL_LIVE: `https://127.0.0.1:${f.livePort}`, HOWL_RIOT_API: riot.base },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  app.stdout.on('data', (d) => logs.push(String(d)));
  app.stderr.on('data', (d) => logs.push(String(d)));
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

  try {
    let targets = [];
    for (let i = 0; i < 60 && targets.length < 2; i++) {
      await sleep(500);
      targets = (await getJson(`http://127.0.0.1:${PORT}/json/list`).catch(() => [])).filter((t) => t.type === 'page');
    }
    const appT = targets.find((t) => t.url.endsWith('app.html'));
    const ovT = targets.find((t) => t.url.endsWith('overlay.html'));
    const appP = new Page(appT.webSocketDebuggerUrl); await appP.open();
    const ovP = new Page(ovT.webSocketDebuggerUrl); await ovP.open();
    await appP.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });

    const waitEval = async (page, expr, ms = 10000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { const v = await page.eval(expr).catch(() => null); if (v) return v; await sleep(150); }
      return null;
    };
    const tab = async (name) => { await appP.eval(`document.querySelector('[data-tab="${name}"]').click()`); await sleep(700); };

    check('connects to the client', !!await waitEval(appP, `document.querySelector('#status .dot.on') && document.querySelector('#status').textContent.includes('Tester#HOWL')`));
    await waitEval(appP, '(async()=>{const s=await window.howl.state();return s.stats.totalGames===2})()');
    await sleep(800);
    await appP.shot('01-idle.png');

    f.setPhase('ChampSelect');
    check('champ select view', !!await waitEval(appP, `document.querySelector('.options .opt') && document.body.textContent.includes('Item set imported')`));
    await sleep(1200); // icons
    await appP.shot('02-champ-select.png');
    check('item set written to client', f.st.itemSets.itemSets.some((s) => s.title === 'HOWL Jinx Mayhem'));

    f.setPhase('InProgress');
    check('in-game view', !!await waitEval(appP, `document.body.textContent.includes('Next buy')`));
    check('overlay renders', !!await waitEval(ovP, `document.querySelector('#panel .head') !== null`));
    const ids = await appP.eval(`(async()=>{const a=await window.howl.augments();return ['Big Brain','Get Excited!','Protein Shake'].map(n=>a.find(x=>x.name===n).id)})()`);
    // Cards roughly where Mayhem draws them on a 1920x1080 screen.
    const cards = ids.map((id, i) => ({ id, rect: { x: 520 + i * 360, y: 520, w: 180, h: 30 } }));
    await appP.eval(`window.howl.debugOffer(${JSON.stringify(cards)})`);
    check('augment badges on overlay', (await waitEval(ovP, `document.querySelectorAll('.badge').length`)) === 3);
    check('exactly one best pick', (await ovP.eval(`document.querySelectorAll('.badge.best').length`)) === 1);
    await sleep(1200);
    const vw = await ovP.eval('innerWidth'); const vh = await ovP.eval('innerHeight');
    await ovP.shot('03-overlay.png', { x: 0, y: 0, width: vw, height: vh });
    await appP.shot('04-in-game.png');
    await appP.eval(`window.howl.debugCleared(${ids[0]})`);

    await fetchCtl(f, '/__live/next');
    check('level updates', !!await waitEval(appP, `document.body.textContent.includes('Level 9')`));

    f.setPhase('EndOfGame');
    check('post-game review', !!await waitEval(appP, `document.body.textContent.includes('Last game review')`, 15000));
    await sleep(1000);
    await appP.shot('05-post-game.png');

    await tab('builds');
    await appP.eval(`document.querySelector('#champSearch').value='Lux';document.querySelector('#champSearch').dispatchEvent(new Event('input'))`);
    await sleep(300);
    await appP.eval(`document.querySelector('.champ').click()`);
    check('builds tab', !!await waitEval(appP, `document.querySelector('#champPlan .aug-list .aug')`));
    await sleep(1200);
    await appP.shot('06-builds.png');

    await tab('augments');
    check('augments tab', (await waitEval(appP, `document.querySelectorAll('#augList .aug').length`)) > 200);
    await sleep(1000);
    await appP.shot('07-augments.png');

    await tab('stats');
    check('stats tab', !!await waitEval(appP, `document.querySelectorAll('.game').length >= 3`));
    await sleep(800);
    await appP.shot('08-stats.png');

    await tab('settings');
    await sleep(800);
    // Save a key through the Settings box and let the crawler run.
    await appP.eval(`document.querySelector('#apiKey').value=${JSON.stringify(riot.key)};document.querySelector('#saveKey').click()`);
    check('ARAM stats collected from the Riot API', !!await waitEval(appP, `/\\d+ ARAM matches/.test(document.querySelector('#aramStatus')?.textContent || '')`, 30000));
    const exposed = await appP.eval('(async()=>JSON.stringify(await window.howl.settings()))()');
    check('API key never reaches the window', !exposed.includes(riot.key) && exposed.includes('"riotApiKeySet":true'));
    await sleep(500);
    await appP.shot('09-settings.png');
    const emdash = await appP.eval(`document.body.innerText.includes('\\u2014')`);
    check('no em dash in UI text', !emdash);
  } catch (e) {
    check('e2e run', false, e.message);
  } finally {
    app.kill();
    f.close();
    riot.close();
    fs.writeFileSync(path.join(OUT, 'app-log.txt'), logs.join(''));
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed. Screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
}

function fetchCtl(f, p) {
  return new Promise((resolve, reject) => {
    require('https').get({ host: '127.0.0.1', port: f.lcuPort, path: p, rejectUnauthorized: false }, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject);
  });
}

main();
