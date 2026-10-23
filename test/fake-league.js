// A fake League client (LCU REST + WebSocket) and fake Live Client Data API,
// so HOWL can be tested end to end without the game. Run on its own with
// `npm run fake` and point HOWL at it:
//   HOWL_LCU=47001:fakepass HOWL_LIVE=https://127.0.0.1:47002 npm start
// then POST /__phase/<ChampSelect|InProgress|EndOfGame|None> to the LCU port.
const https = require('https');
const { WebSocketServer } = require('ws');

// Throwaway self-signed certificate made at test time (the real client uses
// one too), so no key file lives in the repository.
const pems = require('selfsigned').generate([{ name: 'commonName', value: '127.0.0.1' }], { days: 1, keySize: 2048 });
const tls = { key: pems.private, cert: pems.cert };
const PASSWORD = 'fakepass';
const ME = { puuid: 'me-puuid', summonerId: 42, gameName: 'Tester', tagLine: 'HOWL' };

// Champion ids: Jinx 222, Annie 1, Leona 89, Lux 99, Garen 86, Thresh 412,
// Morgana 25, Soraka 16, Malphite 54, Darius 122, Zed 238, Ahri 103.
const CHAMP_SELECT = {
  localPlayerCellId: 0,
  myTeam: [
    { cellId: 0, championId: 222, puuid: ME.puuid },
    { cellId: 1, championId: 99, puuid: 'friend-puuid' },
    { cellId: 2, championId: 86, puuid: 'p3' },
    { cellId: 3, championId: 412, puuid: 'p4' },
    { cellId: 4, championId: 25, puuid: 'p5' },
  ],
  benchChampions: [{ championId: 1 }, { championId: 89 }],
};

function player(name, champ, team, items, level = 9) {
  return {
    championName: champ, riotId: `${name}#EUW`, summonerName: `${name}#EUW`, team, level, isDead: false,
    items: items.map((id, slot) => ({ itemID: id, slot, count: 1 })),
    scores: { kills: 2, deaths: 1, assists: 5, creepScore: 20, wardScore: 0 },
  };
}

function liveData(step) {
  const myItems = [[3006], [3006, 3031], [3006, 3031, 3094]][Math.min(step, 2)];
  const level = [3, 9, 13][Math.min(step, 2)];
  const ranks = [{ Q: 1, W: 1, E: 0, R: 0 }, { Q: 4, W: 2, E: 1, R: 1 }, { Q: 5, W: 3, E: 2, R: 2 }][Math.min(step, 2)];
  return {
    activePlayer: {
      riotId: 'Tester#EUW', summonerName: 'Tester#EUW', level, currentGold: 1234,
      abilities: Object.fromEntries(Object.entries(ranks).map(([k, v]) => [k, { abilityLevel: v }])),
    },
    allPlayers: [
      player('Tester', 'Jinx', 'ORDER', myItems, level),
      player('Friend', 'Lux', 'ORDER', [3020, 6655]),
      player('P3', 'Garen', 'ORDER', [3047, 3071]),
      player('P4', 'Thresh', 'ORDER', [3190]),
      player('P5', 'Morgana', 'ORDER', [3020]),
      player('E1', 'Soraka', 'CHAOS', [3504, 3158]),
      player('E2', 'Malphite', 'CHAOS', [3068, 3047]),
      player('E3', 'Darius', 'CHAOS', [3078, 3047, 3053]),
      player('E4', 'Zed', 'CHAOS', [6692, 3158]),
      player('E5', 'Ahri', 'CHAOS', [3020, 6655, 3089]),
    ],
    events: { Events: [] },
    gameData: { gameMode: 'KIWI', gameTime: 120 + step * 300, mapNumber: 12 },
  };
}

// Synthetic finished Mayhem games for match history.
function historyGame(gameId, created, myChamp, win) {
  const champs = [myChamp, 99, 86, 412, 25, 16, 54, 122, 238, 103];
  const builds = {
    222: [3006, 3031, 3094, 3036, 3046], 99: [3020, 6655, 3089, 3135], 86: [3047, 3071, 3053], 412: [3190, 3109],
    25: [3020, 3165, 3157], 16: [3504, 3158, 6617], 54: [3068, 3047, 3075], 122: [3078, 3047, 3053], 238: [6692, 3158, 3142], 103: [3020, 6655, 3089],
    1: [3020, 6655, 3089, 3157],
  };
  const augPool = [1133, 1084, 1205, 1115, 3086, 3094, 1404, 1030];
  return {
    gameId, gameCreation: created, gameCreationDate: new Date(created).toISOString(), gameDuration: 1100,
    gameMode: 'KIWI', gameVersion: '16.21.1', mapId: 12, queueId: 2400,
    participantIdentities: champs.map((_, i) => ({ participantId: i + 1, player: { puuid: i === 0 ? ME.puuid : `p-${gameId}-${i}`, gameName: i === 0 ? ME.gameName : `Player${i}` } })),
    participants: champs.map((c, i) => {
      const items = builds[c] || [3020];
      const stats = { win: i < 5 ? win : !win, kills: 5, deaths: 4, assists: 12, totalDamageDealtToChampions: 20000 + i * 1000, totalDamageTaken: 15000, totalHeal: 2000 };
      items.forEach((id, k) => { stats[`item${k}`] = id; });
      augPool.slice(i % 4, (i % 4) + 4).forEach((a, k) => { stats[`playerAugment${k + 1}`] = a; });
      return { participantId: i + 1, championId: c, teamId: i < 5 ? 100 : 200, spell1Id: 32, spell2Id: 4, stats };
    }),
  };
}

function start({ lcuPort = 47001, livePort = 47002, log = () => {} } = {}) {
  const st = {
    phase: 'Lobby',
    liveStep: -1, // -1 = no game running
    itemSets: { accountId: 1, itemSets: [{ title: 'My own set', uid: 'keep-me', blocks: [] }], timestamp: 0 },
    games: [historyGame(9001, Date.now() - 86400000, 222, true), historyGame(9002, Date.now() - 7200000, 1, false)],
    calls: [],
    readyCheck: null,
  };
  const sockets = new Set();
  const emit = (uri, data) => {
    const msg = JSON.stringify([8, 'OnJsonApiEvent', { uri, eventType: 'Update', data }]);
    for (const s of sockets) s.send(msg);
  };
  const setPhase = (phase) => {
    st.phase = phase;
    if (phase === 'InProgress' && st.liveStep < 0) st.liveStep = 0;
    if (phase === 'EndOfGame') {
      st.liveStep = -1;
      st.games.unshift(historyGame(9003, Date.now(), 222, true));
    }
    emit('/lol-gameflow/v1/gameflow-phase', phase);
    if (phase === 'ChampSelect') emit('/lol-champ-select/v1/session', CHAMP_SELECT);
  };

  const body = (req) => new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : null); } catch { resolve(null); } });
  });

  const lcu = https.createServer(tls, async (req, res) => {
    const send = (code, json) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(json === undefined ? '' : JSON.stringify(json)); };
    const url = req.url;
    const ctrl = /^\/__phase\/(\w+)/.exec(url);
    if (ctrl) { setPhase(ctrl[1]); return send(200, { phase: st.phase }); }
    if (url === '/__live/next') { st.liveStep++; return send(200, { step: st.liveStep }); }
    if (url === '/__state') return send(200, { calls: st.calls, itemSets: st.itemSets, phase: st.phase });
    if (url === '/__readycheck') { st.readyCheck = { state: 'InProgress', playerResponse: 'None' }; emit('/lol-matchmaking/v1/ready-check', st.readyCheck); return send(200, {}); }
    const expected = 'Basic ' + Buffer.from(`riot:${PASSWORD}`).toString('base64');
    if (req.headers.authorization !== expected) return send(401, { message: 'bad auth' });
    const payload = await body(req);
    st.calls.push({ method: req.method, url, payload });
    log(`${req.method} ${url}`);

    if (url === '/lol-summoner/v1/current-summoner') return send(200, ME);
    if (url === '/riotclient/region-locale') return send(200, { locale: 'en_GB', region: 'EUNE', webLanguage: 'en', webRegion: 'eune' });
    if (url === '/lol-gameflow/v1/gameflow-phase') return send(200, st.phase);
    if (url === '/lol-gameflow/v1/session') return send(200, { phase: st.phase, gameData: { gameId: 9003, queue: { id: 2400 } } });
    if (url === '/lol-lobby/v2/lobby') return send(200, { members: [{ puuid: ME.puuid, gameName: 'Tester' }, { puuid: 'friend-puuid', gameName: 'Friend' }] });
    if (url === '/lol-champ-select/v1/session') return st.phase === 'ChampSelect' ? send(200, CHAMP_SELECT) : send(404, {});
    if (url.startsWith('/lol-item-sets/v1/item-sets/42/sets')) {
      if (req.method === 'GET') return send(200, st.itemSets);
      if (req.method === 'PUT') { st.itemSets = payload; return send(201); }
    }
    if (url === '/lol-champ-select/v1/session/my-selection' && req.method === 'PATCH') return send(204);
    if (url === '/lol-matchmaking/v1/ready-check/accept' && req.method === 'POST') { st.readyCheck = { state: 'InProgress', playerResponse: 'Accepted' }; return send(204); }
    if (url.startsWith('/lol-match-history/v1/products/lol/current-summoner/matches')) {
      return send(200, { games: { games: st.games.map((g) => ({ ...g, participants: g.participants.slice(0, 1) })) } });
    }
    const game = /^\/lol-match-history\/v1\/games\/(\d+)/.exec(url);
    if (game) {
      const g = st.games.find((x) => String(x.gameId) === game[1]);
      return g ? send(200, g) : send(404, {});
    }
    return send(404, { message: `fake LCU has no ${url}` });
  });
  const wss = new WebSocketServer({ server: lcu });
  wss.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  const live = https.createServer(tls, (req, res) => {
    if (st.liveStep < 0 || !req.url.startsWith('/liveclientdata/allgamedata')) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(liveData(st.liveStep)));
  });

  return new Promise((resolve) => {
    lcu.listen(lcuPort, '127.0.0.1', () => live.listen(livePort, '127.0.0.1', () => resolve({
      st, setPhase, emit, lcuPort, livePort, password: PASSWORD,
      close: () => { for (const s of sockets) s.terminate(); lcu.close(); live.close(); },
    })));
  });
}

module.exports = { start, liveData, historyGame, CHAMP_SELECT, ME };

if (require.main === module) {
  start({ log: console.log }).then((f) => {
    console.log(`Fake LCU on ${f.lcuPort} (password ${f.password}), fake live game on ${f.livePort}`);
    console.log(`Start HOWL with HOWL_LCU=${f.lcuPort}:${f.password} HOWL_LIVE=https://127.0.0.1:${f.livePort}`);
  });
}
