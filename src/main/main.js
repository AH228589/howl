// Electron entry: the HOWL app window, the in-game overlay, hotkeys and the
// wiring between the League client, the live game feed and the engine.
const { app, BrowserWindow, ipcMain, globalShortcut, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const gamedata = require('./gamedata');
const { Lcu } = require('./lcu');
const { LiveGame } = require('./live');
const { GameStore } = require('./stats/store');
const { AramStats } = require('./stats/aram');
const { Session } = require('./session');
const { Settings } = require('./settings');
const { AugmentReader } = require('./ocr/reader');
const champions = require('./engine/champions');
const { profile } = require('./engine/profile');
const augmentsEngine = require('./engine/augments');

const TEST = !!process.env.HOWL_TEST;
if (process.env.HOWL_DATA) app.setPath('userData', process.env.HOWL_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

const ROOT = path.join(__dirname, '..', '..');
const logLines = [];
const log = (msg) => {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  logLines.push(line);
  // Also kept on disk so problems can be traced after the app closes.
  try {
    const file = path.join(app.getPath('userData'), 'howl.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1e6) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `${new Date().toISOString()}  ${msg}
`);
  } catch { /* logging must never break the app */ }
  if (logLines.length > 200) logLines.shift();
  console.log(line);
  appWin?.webContents.send('log', line);
};

let appWin = null;
let overlayWin = null;
let session = null;
let aram = null;
let reader = null;
let settings = null;
let data = null;
let community = {};
let overlayHidden = false;

function createAppWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  appWin = new BrowserWindow({
    width: Math.round(area.width * 0.62), height: Math.round(area.height * 0.8),
    minWidth: Math.round(area.width * 0.35), minHeight: Math.round(area.height * 0.5),
    backgroundColor: '#0b0d14', title: 'HOWL', autoHideMenuBar: true, show: !TEST,
    opacity: TEST && !process.env.HOWL_SHOW ? 0 : 1,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  appWin.loadFile(path.join(ROOT, 'src', 'renderer', 'app.html'));
  // Tests show the window without taking focus (someone may be playing).
  if (TEST) appWin.showInactive();
  appWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  appWin.on('closed', () => { appWin = null; app.quit(); });
}

function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlayWin = new BrowserWindow({
    ...bounds, transparent: true, frame: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setVisibleOnAllWorkspaces(true);
  // Keeps the overlay out of screen captures, including HOWL's own augment
  // reader (so it never reads its own labels).
  overlayWin.setContentProtection(true);
  if (TEST && !process.env.HOWL_SHOW) overlayWin.setOpacity(0);
  overlayWin.loadFile(path.join(ROOT, 'src', 'renderer', 'overlay.html'));
}

function updateOverlay(state) {
  if (!overlayWin) return;
  const want = settings.get('overlay') && !overlayHidden && !!state.game;
  if (want && !overlayWin.isVisible()) overlayWin.showInactive();
  if (!want && overlayWin.isVisible()) overlayWin.hide();
}

function updateReader(state) {
  const want = settings.get('augmentReader') && !!state.game && !TEST;
  if (want && !reader.timer) reader.start(settings.get('scanInterval'));
  if (!want && reader.timer) reader.stop();
}

function broadcast(channel, payload) {
  for (const w of [appWin, overlayWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function augmentPool() {
  const ref = community.augments || {};
  return Object.values(data.augments).map((a) => ({
    id: a.id, name: a.name, rarity: a.rarity, icon: a.icon,
    desc: a.desc || ref[a.id]?.desc || '', tier: ref[a.id]?.tier || null,
  }));
}

// Without a key of your own, builds use the ARAM stats published to the HOWL
// repository by whoever runs HOWL with a key. The last copy is kept on disk
// so it works offline too.
async function refreshShared() {
  if (!aram) return;
  aram.useShared = !settings.get('riotApiKey');
  if (!aram.useShared) { broadcast('aram', aram.summary()); return; }
  const file = path.join(app.getPath('userData'), 'aram-shared.json');
  try { aram.loadShared(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* not downloaded yet */ }
  const url = settings.get('sharedStatsUrl');
  if (url) {
    try {
      const json = await gamedata.getJson(url);
      if (aram.loadShared(json)) {
        fs.writeFileSync(file, JSON.stringify(json));
        log(`Shared ARAM stats loaded: ${json.matches} matches, published ${String(json.publishedAt).slice(0, 10)}`);
      }
    } catch (e) { log(`Shared ARAM stats not available (${e.message})`); }
  }
  if (session) session.planKey = null;
  broadcast('aram', aram.summary());
}

// The API key never goes back to a window; the UI only learns that one is
// saved and its last four characters.
function publicSettings() {
  const { riotApiKey, ...rest } = settings.all();
  return { ...rest, riotApiKeySet: !!riotApiKey, riotApiKeyHint: riotApiKey ? riotApiKey.slice(-4) : '' };
}

function registerIpc() {
  ipcMain.handle('state', () => session?.state || null);
  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const keyChanged = typeof patch.riotApiKey === 'string';
    if (keyChanged) patch = { ...patch, riotApiKey: patch.riotApiKey.trim() };
    settings.update(patch);
    if (session) { updateOverlay(session.state); updateReader(session.state); }
    const shown = publicSettings();
    broadcast('settings', shown);
    if (keyChanged) refreshShared();
    if (keyChanged && settings.get('riotApiKey')) session?.crawlAram().catch((e) => log(`ARAM stats: ${e.message}`));
    return shown;
  });
  ipcMain.handle('aram:status', () => aram?.summary() || null);
  ipcMain.handle('aram:run', () => session.crawlAram());
  ipcMain.handle('aram:stop', () => aram?.stop());
  ipcMain.handle('log:get', () => logLines);
  ipcMain.handle('import', async () => {
    const id = session.state.champSelect?.myChamp;
    if (id) await session.importBuild(id);
    return true;
  });
  ipcMain.handle('spells', () => session.applySpells());
  ipcMain.handle('sync', () => session.syncStats());
  ipcMain.handle('augments', () => augmentPool());
  ipcMain.handle('community', () => ({ sources: community.sources || [], compiledAt: community.compiledAt || null }));
  ipcMain.handle('champions', () => champions.rate({
    data, community, candidates: Object.keys(data.champions).map(Number), personal: session.store.personalChampions(),
  }));
  ipcMain.handle('plan', (_e, champId, enemies) => session.planFor(champId, enemies || []));
  ipcMain.handle('rate-augments', (_e, champId, ids) => augmentsEngine.rateOffer({
    data, community, profile: profile(data.champions[champId]), offer: ids,
  }));
  ipcMain.handle('scan', () => reader?.scan({ keep: true }));
  ipcMain.handle('open', (_e, url) => shell.openExternal(url));
  if (TEST) {
    // Test hooks: fake an augment offer or its disappearance.
    ipcMain.handle('debug:offer', (_e, cards) => { session.onAugmentOffer(cards); return session.state.game?.augments; });
    ipcMain.handle('debug:cleared', (_e, id) => { session.onAugmentCleared(id); return session.state.game?.augments; });
  }
}

async function boot() {
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  registerIpc();
  createAppWindow();
  createOverlay();
  data = await gamedata.load({
    cacheDir: app.getPath('userData'), snapshotPath: path.join(ROOT, 'data', 'gamedata.json'),
    log, offline: TEST,
  });
  try { community = require(path.join(ROOT, 'data', 'community', 'mayhem-reference.json')); } catch { log('No community tier data found'); }
  log(`Game data for patch ${data.version}: ${Object.keys(data.augments).length} Mayhem augments`);

  const store = new GameStore(path.join(app.getPath('userData'), 'games.json'), data);
  const lcu = new Lcu({ override: process.env.HOWL_LCU });
  const live = new LiveGame({ base: process.env.HOWL_LIVE || undefined });
  aram = new AramStats({ file: path.join(app.getPath('userData'), 'aram-stats.json'), data, log });
  aram.on('status', (s) => broadcast('aram', s));
  refreshShared();
  setInterval(refreshShared, 6 * 3600000);
  session = new Session({ lcu, live, store, data, community, settings, aram, log });
  if (TEST) session.testDelay = 500;
  reader = new AugmentReader({ augments: data.augments, log, scanDir: path.join(app.getPath('userData'), 'scans') });
  reader.on('offer', (cards) => session.onAugmentOffer(cards));
  reader.on('cleared', () => session.onAugmentCleared(null));
  reader.on('picked', (id) => session.onAugmentCleared(id));

  session.on('state', (state) => {
    broadcast('state', state);
    updateOverlay(state);
    updateReader(state);
  });
  lcu.on('connected', () => log('Connected to the League client'));
  lcu.on('disconnected', () => log('League client closed'));
  live.on('start', () => log('Game detected'));
  live.on('end', () => log('Game ended'));
  session.start();
  // Collection does not need the League client (region and players are
  // remembered), so it also starts when HOWL opens with League closed.
  setTimeout(() => { if (!session.lcu.connected) session.maybeAutoCrawl(); }, 20000);
  broadcast('state', session.state);

  globalShortcut.register('Control+Shift+H', () => {
    overlayHidden = !overlayHidden;
    updateOverlay(session.state);
  });
  globalShortcut.register('Control+Shift+J', () => reader.scan({ keep: true }));
}

app.whenReady().then(boot).catch((e) => { console.error(e); log(`Startup failed: ${e.message}`); });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  reader?.dispose();
  session?.lcu.stop();
  session?.live.stop();
});
