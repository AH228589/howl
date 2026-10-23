const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fakeApi = require('./fake-riot-api');
const data = require('../data/gamedata.json');
const { AramStats } = require('../src/main/stats/aram');
const { RiotApi } = require('../src/main/stats/riot-api');
const { profile } = require('../src/main/engine/profile');
const items = require('../src/main/engine/items');
const skills = require('../src/main/engine/skills');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'howl-aram-')), 'aram.json');
const jinx = data.champions[222];

test('crawler collects ARAM matches, survives a 429 and keeps only recent patches', async () => {
  const api = await fakeApi.start({ port: 47311 });
  try {
    const stats = new AramStats({ file: tmp(), data });
    const res = await stats.crawl({ key: api.key, route: 'europe', base: api.base, seeds: [{ name: 'Tester', tag: 'HOWL' }], maxRequests: 80 });
    assert.ifError(res.error);
    assert.ok(res.totalMatches >= 20, `got ${res.totalMatches}`);
    assert.ok(api.st.forced429, 'the fake API sent a 429');
    assert.deepStrictEqual(res.patches.map((p) => p.patch), ['16.21']);

    const j = stats.champion(222);
    assert.ok(j.items[3031].picks > 0, 'Infinity Edge counted');
    assert.ok(j.first[3031] > 0, 'Infinity Edge seen as first legendary');
    assert.strictEqual(Object.keys(j.skills)[0], 'EQW');
    // Fake Jinx players finish boots, then Infinity Edge, then Runaan's...
    const pos = (id) => j.order[id].sum / j.order[id].n;
    assert.ok(pos(3006) < pos(3031) && pos(3031) < pos(3094), 'completion order recorded');

    // Built in that order.
    const build = items.recommend({ data, profile: profile(jinx), global: { ...j, realGames: stats.realGames(222) } }).build.map((i) => i.id);
    const at = (id) => build.indexOf(id);
    assert.ok(at(3006) < at(3031) && at(3031) < at(3094), `build order ${build.join(',')}`);

    // The data persists and is reused.
    const again = new AramStats({ file: stats.file, data });
    assert.strictEqual(again.matchCount(), stats.matchCount());
  } finally { api.close(); }
});

test('a rejected key stops the crawl with a clear message', async () => {
  const api = await fakeApi.start({ port: 47312 });
  try {
    const stats = new AramStats({ file: tmp(), data });
    const res = await stats.crawl({ key: 'RGAPI-wrong', route: 'europe', base: api.base, seeds: [{ name: 'Tester', tag: 'HOWL' }] });
    assert.match(res.error, /rejected/);
    assert.strictEqual(res.running, false);
  } finally { api.close(); }
});

test('rate limiter spaces requests to the window from the headers', async () => {
  const api = new RiotApi({ key: 'x', route: 'europe' });
  api.limits = [{ count: 3, ms: 300 }];
  const t = Date.now();
  for (let i = 0; i < 5; i++) await api.throttle();
  assert.ok(Date.now() - t >= 280, 'waited for the window');
});

test('ARAM stats steer the build and the skill order', () => {
  const p = profile(jinx);
  const global = {
    games: 40, realGames: 40, first: { 3046: 30 }, skills: { EQW: 30, QWE: 10 },
    items: { 3046: { picks: 36, wins: 20 }, 3031: { picks: 30, wins: 18 } },
  };
  const r = items.recommend({ data, profile: p, global });
  assert.strictEqual(r.build[0].name, 'Phantom Dancer', 'most common first item leads the build');
  assert.match(r.source, /40 ARAM games/);
  assert.ok(r.build[0].reasons.some((x) => /% of 40 ARAM games/.test(x)));
  const s = skills.recommend({ champ: jinx, profile: p, global });
  assert.deepStrictEqual(s.priority, ['E', 'Q', 'W']);
  assert.match(s.source, /40 ARAM games/);
});

test('friends without a key read the shared stats file', async () => {
  const api = await fakeApi.start({ port: 47313 });
  try {
    const owner = new AramStats({ file: tmp(), data });
    await owner.crawl({ key: api.key, route: 'europe', base: api.base, seeds: [{ name: 'Tester', tag: 'HOWL' }], maxRequests: 60 });
    const shared = JSON.parse(JSON.stringify(owner.exportShared()));
    assert.ok(!('seen' in shared) && !('frontier' in shared), 'no match or player ids');

    const friend = new AramStats({ file: tmp(), data });
    friend.useShared = true;
    assert.strictEqual(friend.champion(222), null);
    assert.ok(friend.loadShared(shared));
    assert.deepStrictEqual(friend.champion(222), owner.champion(222));
    assert.ok(friend.summary().shared.loaded);
  } finally { api.close(); }
});
