// Screenshots of every view at several window sizes, against the fake League
// client and fake Riot API, for checking the layout. Windows stay invisible.
//   node test/shots.js <folder>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const fake = require('./fake-league');
const fakeApi = require('./fake-riot-api');

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'howl-sizes'));
const PORT = 9335;
const SIZES = { narrow: [720, 900], laptop: [1280, 760], hd: [1920, 1080], qhd: [2560, 1440] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve, reject) => http.get(url, (res) => {
  let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
}).on('error', reject));

class Page {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); }
  open() { return new Promise((r) => { this.ws.on('open', r); this.ws.on('message', (m) => { const x = JSON.parse(m); this.pending.get(x.id)?.(x); this.pending.delete(x.id); }); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((r) => { this.pending.set(id, r); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; }
  size(w, h) { return this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); }
  async shot(file, full = false) {
    let clip;
    if (full) {
      const h = await this.eval('Math.min(document.documentElement.scrollHeight, 4000)');
      const w = await this.eval('innerWidth');
      clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
    }
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, 'base64'));
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const f = await fake.start({ lcuPort: 47401, livePort: 47402 });
  const riot = await fakeApi.start({ port: 47403 });
  const app = spawn(require('electron'), ['.', `--remote-debugging-port=${PORT}`], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, HOWL_TEST: '1', HOWL_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'howl-shots-')), HOWL_LCU: `${f.lcuPort}:${f.password}`, HOWL_LIVE: `https://127.0.0.1:${f.livePort}`, HOWL_RIOT_API: riot.base },
    stdio: 'ignore',
  });
  const problems = [];
  try {
    let targets = [];
    for (let i = 0; i < 60 && targets.length < 2; i++) { await sleep(500); targets = (await getJson(`http://127.0.0.1:${PORT}/json/list`).catch(() => [])).filter((t) => t.type === 'page'); }
    const appP = new Page(targets.find((t) => t.url.endsWith('app.html')).webSocketDebuggerUrl); await appP.open();
    const ovP = new Page(targets.find((t) => t.url.endsWith('overlay.html')).webSocketDebuggerUrl); await ovP.open();
    const tab = async (n) => { await appP.eval(`document.querySelector('[data-tab="${n}"]').click()`); await sleep(900); };
    // Any element wider than the window means horizontal scrolling: a layout bug.
    const overflow = () => appP.eval(`(() => { const w = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && !e.closest('.skillgrid-wrap, nav, .champs'); }); return bad.slice(0, 3).map(e => e.className || e.tagName); })()`);
    const snap = async (name, full = true) => {
      for (const [label, [w, h]] of Object.entries(SIZES)) {
        await appP.size(w, h);
        await sleep(450);
        const bad = await overflow();
        if (bad.length) problems.push(`${name} @ ${label}: overflow ${bad.join(', ')}`);
        await appP.shot(`${name}-${label}.png`, full);
      }
    };

    await sleep(2500);
    await appP.eval('window.howl.setSettings({ riotApiKey: "RGAPI-test-key" })');
    await sleep(3000);
    await snap('idle', false);
    f.setPhase('ChampSelect');
    await sleep(2500);
    await snap('champselect');
    f.setPhase('InProgress');
    await sleep(2500);
    const ids = await appP.eval(`(async()=>{const a=await window.howl.augments();return ['Big Brain','Get Excited!','Protein Shake'].map(n=>a.find(x=>x.name===n).id)})()`);
    for (const [label, [w, h]] of Object.entries({ hd: [1920, 1080], qhd: [2560, 1440], laptop: [1366, 768] })) {
      const cards = ids.map((id, i) => ({ id, rect: { x: w * (0.27 + i * 0.19), y: h * 0.48, w: w * 0.09, h: h * 0.03 } }));
      await ovP.size(w, h);
      await appP.eval(`window.howl.debugOffer(${JSON.stringify(cards)})`);
      await appP.eval('window.howl.debugToast("Rated Big Brain · Get Excited! · Protein Shake", "good")');
      await sleep(900);
      await ovP.shot(`overlay-${label}.png`);
    }
    await snap('ingame');
    f.setPhase('EndOfGame');
    await sleep(4000);
    await snap('postgame');
    await tab('builds');
    await appP.eval(`document.querySelector('.champ[title="Lux"]').click()`);
    await sleep(1500);
    await snap('builds');
    await tab('augments');
    await snap('augments', false);
    await tab('stats');
    await snap('stats');
    await tab('settings');
    await snap('settings');
  } finally {
    app.kill(); f.close(); riot.close();
  }
  console.log(problems.length ? `Layout problems:\n${problems.join('\n')}` : 'No horizontal overflow at any size');
  console.log(`Screenshots in ${OUT}`);
}

main();
