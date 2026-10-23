// A fake Riot web API (account-v1 and match-v5) serving synthetic ARAM games,
// with rate limit headers, one forced 429 and key checking.
const http = require('http');

const KEY = 'RGAPI-test-key';
const JINX = 222;
const CHAMPS = [JINX, 99, 86, 412, 25, 16, 54, 122, 238, 103];
const BUILDS = {
  222: [3006, 3031, 3094, 3046, 3036], 99: [3020, 6655, 3089, 3135], 86: [3047, 3071, 3053], 412: [3190, 3109],
  25: [3020, 3165, 3157], 16: [3504, 3158, 6617], 54: [3068, 3047, 3075], 122: [3078, 3047, 3053], 238: [6692, 3158, 3142], 103: [3020, 6655, 3089],
};
// Jinx players level E first in these games, so the stats should say E > Q > W.
const SKILLS = { 222: 'EQEWEREQEQRQQWWRWW' };

function match(n, version) {
  return {
    metadata: { matchId: `EUN1_${n}` },
    info: {
      queueId: 450, gameVersion: version,
      participants: CHAMPS.map((c, i) => {
        const p = { participantId: i + 1, puuid: `api-p-${(n * 7 + i) % 60}`, championId: c, win: i < 5 ? n % 2 === 0 : n % 2 === 1 };
        (BUILDS[c] || []).forEach((id, k) => { p[`item${k}`] = id; });
        return p;
      }),
    },
  };
}

function timeline(n) {
  const events = [];
  CHAMPS.forEach((c, i) => {
    for (const id of BUILDS[c] || []) events.push({ type: 'ITEM_PURCHASED', participantId: i + 1, itemId: id });
    const seq = SKILLS[c] || 'QWEQQRQWQWRWWEEREE';
    [...seq].forEach((k) => events.push({ type: 'SKILL_LEVEL_UP', participantId: i + 1, skillSlot: 'QWER'.indexOf(k) + 1, levelUpType: 'NORMAL' }));
  });
  return { info: { frames: [{ events }] } };
}

function start({ port = 47301, version = '16.21.555.1234' } = {}) {
  const st = { requests: 0, forced429: false };
  const server = http.createServer((req, res) => {
    st.requests++;
    const send = (code, body, extra = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'X-App-Rate-Limit': '100:1,2000:60', 'X-Method-Rate-Limit': '500:10', ...extra });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.headers['x-riot-token'] !== KEY) return send(401, { status: { message: 'Unauthorized', status_code: 401 } });
    const url = new URL(req.url, 'http://x');
    if (!st.forced429 && url.pathname.includes('/matches/by-puuid/')) { st.forced429 = true; return send(429, {}, { 'Retry-After': '1' }); }
    let m;
    if ((m = /^\/riot\/account\/v1\/accounts\/by-riot-id\/([^/]+)\/([^/]+)$/.exec(url.pathname))) {
      return decodeURIComponent(m[1]) === 'Tester' ? send(200, { puuid: 'api-me', gameName: 'Tester', tagLine: decodeURIComponent(m[2]) }) : send(404, {});
    }
    if ((m = /^\/lol\/match\/v5\/matches\/by-puuid\/([^/]+)\/ids$/.exec(url.pathname))) {
      if (url.searchParams.get('queue') !== '450') return send(200, []);
      const seed = m[1] === 'api-me' ? 0 : Number(m[1].split('-').pop()) || 0;
      return send(200, Array.from({ length: Number(url.searchParams.get('count') || 20) }, (_, i) => `EUN1_${(seed + i) % 40}`));
    }
    if ((m = /^\/lol\/match\/v5\/matches\/EUN1_(\d+)\/timeline$/.exec(url.pathname))) return send(200, timeline(Number(m[1])));
    if ((m = /^\/lol\/match\/v5\/matches\/EUN1_(\d+)$/.exec(url.pathname))) {
      const n = Number(m[1]);
      return send(200, match(n, n >= 35 ? '16.15.1.1' : version)); // a few very old games
    }
    return send(404, {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    st, port, key: KEY, base: `http://127.0.0.1:${port}`, close: () => server.close(),
  })));
}

module.exports = { start, KEY };
