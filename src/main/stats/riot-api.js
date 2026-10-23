// Minimal client for Riot's official web API with rate limiting. Limits are
// read from the X-App-Rate-Limit / X-Method-Rate-Limit headers, so a
// development key (20 per second, 100 per 2 minutes) and a personal key both
// work without changes. 429 answers are retried after Retry-After.
const https = require('https');
const http = require('http');

// Client region (from /riotclient/region-locale) -> regional route.
const ROUTES = {
  NA: 'americas', BR: 'americas', LAN: 'americas', LAS: 'americas',
  EUW: 'europe', EUNE: 'europe', TR: 'europe', RU: 'europe', ME: 'europe',
  KR: 'asia', JP: 'asia',
  OCE: 'sea', SG: 'sea', PH: 'sea', TH: 'sea', TW: 'sea', VN: 'sea',
};

// Platform id (EUN1, NA1...) -> regional route, used when the client region is unknown.
const PLATFORM_ROUTES = {
  NA1: 'americas', BR1: 'americas', LA1: 'americas', LA2: 'americas',
  EUW1: 'europe', EUN1: 'europe', TR1: 'europe', RU: 'europe', ME1: 'europe',
  KR: 'asia', JP1: 'asia',
  OC1: 'sea', SG2: 'sea', PH2: 'sea', TH2: 'sea', TW2: 'sea', VN2: 'sea',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class RiotApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

class RiotApi {
  // base: override for tests, e.g. "http://127.0.0.1:47301"; otherwise
  // https://<route>.api.riotgames.com
  constructor({ key, route, base = null }) {
    this.key = key;
    this.base = base || `https://${route}.api.riotgames.com`;
    this.limits = [{ count: 20, ms: 1000 }, { count: 100, ms: 120000 }]; // dev key defaults until headers say otherwise
    this.sent = [];
    this.requests = 0;
  }

  async throttle() {
    for (;;) {
      const now = Date.now();
      const longest = Math.max(...this.limits.map((l) => l.ms));
      this.sent = this.sent.filter((t) => now - t < longest);
      let wait = 0;
      for (const l of this.limits) {
        const inWindow = this.sent.filter((t) => now - t < l.ms);
        // Keep one request of headroom per window.
        if (inWindow.length >= l.count - 1) wait = Math.max(wait, inWindow[inWindow.length - l.count + 1] + l.ms - now + 25);
      }
      if (wait <= 0) break;
      await sleep(Math.min(wait, 5000));
    }
    this.sent.push(Date.now());
  }

  readLimits(headers) {
    const parse = (h) => String(h || '').split(',').map((p) => p.split(':').map(Number)).filter(([c, s]) => c > 0 && s > 0).map(([count, s]) => ({ count, ms: s * 1000 }));
    const app = parse(headers['x-app-rate-limit']);
    if (app.length) this.limits = [...app, ...parse(headers['x-method-rate-limit'])];
  }

  raw(path) {
    const url = new URL(path, this.base);
    const lib = url.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const req = lib.get(url, { headers: { 'X-Riot-Token': this.key, 'User-Agent': 'HOWL/0.1' }, timeout: 15000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error('Riot API timed out')));
      req.on('error', reject);
    });
  }

  async get(path, attempt = 0) {
    await this.throttle();
    this.requests++;
    const res = await this.raw(path);
    this.readLimits(res.headers);
    if (res.status === 429 && attempt < 4) {
      await sleep((Number(res.headers['retry-after']) || 10) * 1000);
      return this.get(path, attempt + 1);
    }
    if (res.status >= 500 && attempt < 2) { await sleep(2000); return this.get(path, attempt + 1); }
    if (res.status === 401 || res.status === 403) throw new RiotApiError(res.status, 'The Riot API key was rejected. Development keys expire every 24 hours; paste a fresh one in Settings.');
    if (res.status === 404) return null;
    if (res.status !== 200) throw new RiotApiError(res.status, `Riot API ${res.status} for ${path.split('?')[0]}`);
    return JSON.parse(res.text);
  }

  accountByRiotId(name, tag) {
    return this.get(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
  }

  matchIds(puuid, { queue, count = 20 } = {}) {
    return this.get(`/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queue}&start=0&count=${count}`);
  }

  match(id) { return this.get(`/lol/match/v5/matches/${id}`); }

  timeline(id) { return this.get(`/lol/match/v5/matches/${id}/timeline`); }
}

module.exports = { RiotApi, RiotApiError, ROUTES, PLATFORM_ROUTES };
