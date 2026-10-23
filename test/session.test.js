// Full flow against the fake League client: connect, sync history, champ
// select with item set import, in-game updates, augment offer, game end.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fake = require('./fake-league');
const data = require('../data/gamedata.json');
const community = require('../data/community/mayhem-reference.json');
const { Lcu } = require('../src/main/lcu');
const { LiveGame } = require('../src/main/live');
const { GameStore } = require('../src/main/stats/store');
const { Session } = require('../src/main/session');
const { Settings } = require('../src/main/settings');

const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting');
};

test('session flow against the fake client', async () => {
  const f = await fake.start({ lcuPort: 47101, livePort: 47102 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'howl-test-'));
  const settings = new Settings(path.join(dir, 'settings.json'));
  settings.update({ autoAccept: true });
  const store = new GameStore(path.join(dir, 'games.json'), data);
  const lcu = new Lcu({ override: `${f.lcuPort}:${f.password}` });
  const live = new LiveGame({ base: `https://127.0.0.1:${f.livePort}`, interval: 100 });
  const session = new Session({ lcu, live, store, data, community, settings });
  session.testDelay = 50;
  session.start();
  try {
    await waitFor(() => session.state.client.connected);
    await waitFor(() => session.state.stats.totalGames === 2);
    assert.strictEqual(session.state.stats.myGames, 2);
    assert.strictEqual(session.state.party[0]?.name, 'Friend');

    // Ready check is accepted when the setting is on.
    await fetchCtl(f, '/__readycheck');
    await waitFor(() => f.st.readyCheck?.playerResponse === 'Accepted');

    f.setPhase('ChampSelect');
    const cs = await waitFor(() => session.state.champSelect?.plan && session.state.champSelect.imported && session.state.champSelect);
    assert.strictEqual(cs.plan.champ.name, 'Jinx');
    assert.ok(cs.ratings.some((r) => r.name === 'Leona' && r.bench));
    assert.ok(cs.teammates.find((t) => t.name === 'Lux').party);
    const sets = f.st.itemSets.itemSets;
    assert.ok(sets.some((s) => s.uid === 'keep-me'), 'keeps the user\'s own item sets');
    const howlSet = sets.find((s) => s.title.startsWith('HOWL '));
    assert.deepStrictEqual(howlSet.associatedChampions, [222]);
    assert.ok(howlSet.blocks.find((b) => b.type === 'HOWL core build').items.length === 6);
    assert.deepStrictEqual([...cs.plan.spells.spells].sort((a, b) => a - b), [4, 32]);

    f.setPhase('InProgress');
    const g = await waitFor(() => session.state.game);
    assert.strictEqual(g.champ.name, 'Jinx');
    assert.strictEqual(g.enemies.length, 5);
    assert.strictEqual(g.nextSkill, 'E'); // level 3 with only Q and W taken
    assert.ok(g.items.next.length > 0);

    // Augment offer and pick.
    const ids = ['Big Brain', 'Get Excited!', 'Protein Shake'].map((n) => Object.values(data.augments).find((a) => a.name === n).id);
    session.onAugmentOffer(ids.map((id, i) => ({ id, rect: { x: 300 + i * 400, y: 400, w: 200, h: 30 } })));
    assert.strictEqual(session.state.game.augments.offer.length, 3);
    session.onAugmentCleared(ids[1]);
    assert.deepStrictEqual(session.state.game.augments.picked, [ids[1]]);

    // Skill sequence is recorded as the game goes on.
    await fetchCtl(f, '/__live/next');
    await waitFor(() => session.state.game?.level === 9);
    assert.ok(session.liveNotes.skillSeq.length >= 8);

    f.setPhase('EndOfGame');
    await waitFor(() => session.state.game === null);
    await waitFor(() => session.state.lastGame?.gameId === 9003);
    assert.strictEqual(session.state.stats.totalGames, 3);
    const recorded = store.db.games[9003];
    assert.ok(recorded.mine.skillSeq.length >= 8, 'live notes are attached to the recorded game');
    assert.deepStrictEqual(recorded.mine.picks, [ids[1]]);
    assert.ok(session.state.lastGame.matched >= 0);
  } finally {
    lcu.stop();
    live.stop();
    f.close();
  }
});

function fetchCtl(f, p) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    https.get({ host: '127.0.0.1', port: f.lcuPort, path: p, rejectUnauthorized: false }, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject);
  });
}
