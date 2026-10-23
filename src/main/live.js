// Live Client Data API: Riot's official read-only feed that the game serves
// on port 2999 while a match is running.
const https = require('https');
const { EventEmitter } = require('events');

const agent = new https.Agent({ rejectUnauthorized: false });

function fetchJson(base, path) {
  return new Promise((resolve, reject) => {
    const req = https.get(`${base}${path}`, { agent, timeout: 1500 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

class LiveGame extends EventEmitter {
  constructor({ base = 'https://127.0.0.1:2999', interval = 1000 } = {}) {
    super();
    this.base = base;
    this.interval = interval;
    this.active = false;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        const data = await fetchJson(this.base, '/liveclientdata/allgamedata');
        if (!this.active) { this.active = true; this.emit('start', data); }
        this.emit('update', data);
      } catch {
        if (this.active) { this.active = false; this.emit('end'); }
      }
      this.timer = setTimeout(tick, this.active ? this.interval : 3000);
    };
    tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }
}

module.exports = { LiveGame, fetchJson };
