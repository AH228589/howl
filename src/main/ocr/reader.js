// Augment card reader. While a Mayhem game runs it captures the middle of
// the screen every so often, reads the text with Windows' built-in OCR and
// reports an offer when two or more augment names sit side by side. When the
// cards disappear, the card under the mouse at that moment is taken as the
// pick. Nothing is injected into or read from the game itself.
const { desktopCapturer, screen } = require('electron');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findOffer, buildIndex } = require('./match');

const WORKER = path.join(__dirname, 'ocr-worker.ps1').replace('app.asar', 'app.asar.unpacked');
// Share of the screen to read: the offer cards sit in the middle.
const REGION = { x: 0.08, y: 0.12, w: 0.84, h: 0.62 };
// Card names are large text; a smaller image reads just as well and faster.
const MAX_WIDTH = 1600;
// The first call warms up Windows OCR and can take several seconds.
const OCR_TIMEOUT = 12000;

class AugmentReader extends EventEmitter {
  constructor({ augments, log = () => {}, scanDir = null }) {
    super();
    this.index = buildIndex(augments);
    this.names = Object.fromEntries(Object.values(augments).map((a) => [a.id, a.name]));
    this.scanDir = scanDir;
    this.runId = 0;
    this.pickDelay = 8000;
    this.recent = null;
    this.log = log;
    this.proc = null;
    this.queue = [];
    this.buffer = '';
    this.offer = null;
    this.misses = 0;
    this.cursor = null;
    this.timer = null;
    this.busy = false;
    this.tmpDir = path.join(fs.realpathSync.native(os.tmpdir()), `howl-ocr-${process.pid}`);
    this.shot = 0;
  }

  // Windows does not always end PowerShell on a plain kill, so the whole
  // process tree is ended.
  killWorker() {
    if (!this.proc) return;
    const pid = this.proc.pid;
    this.proc.kill();
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
    this.proc = null;
    for (const cb of this.queue.splice(0)) cb({ ok: false, error: 'worker restarted' });
  }

  // Old scan images are removed once nothing reads them.
  cleanTmp(keep) {
    for (const f of fs.readdirSync(this.tmpDir)) {
      const p = path.join(this.tmpDir, f);
      if (p !== keep) { try { fs.unlinkSync(p); } catch { /* still open, next time */ } }
    }
  }

  ensureWorker() {
    if (this.proc) return;
    const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WORKER], { windowsHide: true });
    this.proc = proc;
    this.buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      if (this.proc !== proc) return; // output from a worker that was replaced
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if ('ready' in msg) { if (!msg.ready) this.log('Windows OCR is not available for English on this PC'); continue; }
        this.queue.shift()?.(msg);
      }
    });
    proc.stderr.on('data', (d) => this.log(`OCR: ${String(d).trim()}`));
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      for (const cb of this.queue.splice(0)) cb({ ok: false, error: 'worker exited' });
    });
  }

  // A stuck OCR call must never stop scanning for the rest of the game, so
  // slow answers time out and the worker is restarted.
  ocr(file) {
    this.ensureWorker();
    return new Promise((resolve) => {
      let done = false;
      const finish = (msg) => { if (!done) { done = true; clearTimeout(timer); resolve(msg); } };
      const timer = setTimeout(() => {
        finish({ ok: false, error: 'OCR timed out, restarting it' });
        this.killWorker();
      }, OCR_TIMEOUT);
      this.queue.push(finish);
      this.proc.stdin.write(`${file}\n`);
    });
  }

  async capture() {
    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor;
    const full = { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: full });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src) return null;
    const img = src.thumbnail;
    const size = img.getSize();
    const crop = {
      x: Math.round(size.width * REGION.x), y: Math.round(size.height * REGION.y),
      width: Math.round(size.width * REGION.w), height: Math.round(size.height * REGION.h),
    };
    let part = img.crop(crop);
    let scale = 1;
    if (crop.width > MAX_WIDTH) { scale = MAX_WIDTH / crop.width; part = part.resize({ width: MAX_WIDTH }); }
    // A fresh file per scan: a stuck OCR call holding the previous file open
    // must not block the next one.
    fs.mkdirSync(this.tmpDir, { recursive: true });
    const file = path.join(this.tmpDir, `scan-${++this.shot}.png`);
    fs.writeFileSync(file, part.toPNG());
    this.cleanTmp(file);
    // Image pixels -> screen coordinates (DIP) for the overlay.
    const toScreen = (r) => ({
      x: display.bounds.x + (crop.x + r.x / scale) * (display.bounds.width / size.width),
      y: display.bounds.y + (crop.y + r.y / scale) * (display.bounds.height / size.height),
      w: (r.w / scale) * (display.bounds.width / size.width),
      h: (r.h / scale) * (display.bounds.height / size.height),
    });
    return { file, height: part.getSize().height, toScreen, png: part.toPNG(), screen: display.bounds };
  }

  // keep: also save the captured image and what OCR read (Ctrl+Shift+J), so
  // a misread can be checked afterwards.
  async scan({ keep = false } = {}) {
    if (this.busy) return null;
    this.busy = true;
    try {
      const cap = await this.capture();
      if (!cap) return null;
      const res = await this.ocr(cap.file);
      if (!res.ok) { this.log(`OCR failed: ${res.error}`); return null; }
      const cards = findOffer(res.lines, this.index, cap.height, this.offer ? 1 : 2).map((c) => ({ id: c.id, rect: cap.toScreen(c) }));
      if (keep) this.keepScan(cap, res, cards);
      this.handle(cards, cap.screen);
      return cards;
    } catch (e) {
      this.log(`Augment scan failed: ${e.message}`);
      return null;
    } finally { this.busy = false; }
  }

  keepScan(cap, res, cards) {
    if (!this.scanDir) return;
    fs.mkdirSync(this.scanDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(this.scanDir, `${stamp}.png`), cap.png);
    fs.writeFileSync(path.join(this.scanDir, `${stamp}.txt`),
      `Read as augments: ${cards.map((c) => this.names[c.id] || c.id).join(' | ') || 'none'}\n\nOCR lines:\n${res.lines.map((l) => l.text).join('\n')}\n`);
    // Keep the last ten scans (an image and a text file each).
    const files = fs.readdirSync(this.scanDir).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 20))) fs.unlinkSync(path.join(this.scanDir, f));
    this.log(`Saved what HOWL saw to ${this.scanDir}`);
  }

  // Cards are tracked per column: a scan that reads only some names (a card
  // mid-reroll, a name under the cursor) updates those columns and keeps the
  // rest, so rerolls refresh and a reroll animation is not taken for a pick.
  handle(cards, bounds = { width: 1920, height: 1080 }) {
    const cx = (c) => c.rect.x + c.rect.w / 2;
    if (this.offer) {
      const old = this.offer.cards;
      const rowY = old.reduce((s, c) => s + c.rect.y, 0) / old.length;
      const spacing = old.length > 1 ? Math.abs(cx(old[1]) - cx(old[0])) : bounds.width * 0.2;
      const sameRow = cards.filter((c) => Math.abs(c.rect.y - rowY) < bounds.height * 0.06);
      if (sameRow.length) {
        this.misses = 0;
        const merged = old.map((o) => sameRow.find((c) => Math.abs(cx(c) - cx(o)) < spacing * 0.45) || o);
        for (const c of sameRow) if (!merged.some((m) => Math.abs(cx(m) - cx(c)) < spacing * 0.45)) merged.push(c);
        merged.sort((a, b) => cx(a) - cx(b));
        this.setOffer(merged);
        return;
      }
      if (cards.length >= 2) { this.setOffer(cards); return; } // a different row: a new offer
      if (++this.misses >= 3) {
        // Names can be unreadable for a few seconds (hover, reroll
        // animation), so the badges hide now but the pick is only recorded
        // if the same cards do not come back.
        const pick = this.guessPick(this.offer.cards);
        this.recent = { ids: new Set(this.offer.cards.map((c) => c.id)), pick };
        this.offer = null;
        this.trackCursor(false);
        this.emit('cleared', null);
        clearTimeout(this.pickTimer);
        this.pickTimer = setTimeout(() => this.confirmPick(), this.pickDelay);
      }
      return;
    }
    if (cards.length >= 2) {
      if (this.recent && cards.some((c) => this.recent.ids.has(c.id))) {
        clearTimeout(this.pickTimer); // the same cards came back: nothing was picked
        this.recent = null;
      } else if (this.recent) {
        this.confirmPick(); // a different offer: the earlier one really closed
      }
      this.setOffer(cards);
    }
  }

  confirmPick() {
    clearTimeout(this.pickTimer);
    if (!this.recent) return;
    const { pick } = this.recent;
    this.recent = null;
    this.emit('picked', pick);
    this.log(`Augment cards closed${pick ? `, picked ${this.names[pick] || pick}` : ''}`);
  }

  setOffer(cards) {
    const key = cards.map((c) => c.id).join(',');
    const changed = key !== this.offer?.key;
    this.offer = { key, cards };
    if (!changed) return;
    this.emit('offer', cards);
    this.trackCursor(true);
    this.log(`Augments on screen: ${cards.map((c) => this.names[c.id] || c.id).join(' | ')}`);
  }

  // The cursor is sampled while cards are up; whichever card was under it
  // last (by column) is most likely the one that was clicked.
  trackCursor(on) {
    clearInterval(this.cursorTimer);
    if (on) this.cursorTimer = setInterval(() => { this.cursor = screen.getCursorScreenPoint(); }, 120);
  }

  guessPick(cards) {
    const c = this.cursor;
    if (!c) return null;
    let best = null;
    for (const card of cards) {
      const cx = card.rect.x + card.rect.w / 2;
      const d = Math.abs(c.x - cx);
      if (!best || d < best.d) best = { id: card.id, d };
    }
    const spacing = cards.length > 1 ? Math.abs(cards[1].rect.x - cards[0].rect.x) : 400;
    return best && best.d < spacing * 0.6 ? best.id : null;
  }

  start(intervalMs = 1500) {
    this.stop();
    const run = ++this.runId;
    this.timer = true;
    const loop = async () => {
      if (run !== this.runId) return; // stopped or restarted meanwhile
      await this.scan();
      if (run !== this.runId) return;
      this.timer = setTimeout(loop, this.offer ? Math.min(500, intervalMs) : intervalMs);
    };
    loop();
  }

  stop() {
    this.runId++;
    clearTimeout(this.timer);
    this.timer = null;
    this.trackCursor(false);
    clearTimeout(this.pickTimer);
    this.recent = null;
    if (this.offer) { this.offer = null; this.emit('cleared', null); }
  }

  dispose() {
    this.stop();
    this.killWorker();
    try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch { /* not created */ }
  }
}

module.exports = { AugmentReader };
