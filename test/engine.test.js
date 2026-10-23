const test = require('node:test');
const assert = require('node:assert');
const data = require('../data/gamedata.json');
const community = require('../data/community/mayhem-reference.json');
const { profile } = require('../src/main/engine/profile');
const items = require('../src/main/engine/items');
const skills = require('../src/main/engine/skills');
const augments = require('../src/main/engine/augments');
const champions = require('../src/main/engine/champions');
const { findOffer, buildIndex } = require('../src/main/ocr/match');

const champ = (key) => Object.values(data.champions).find((c) => c.key === key);
const aug = (name) => Object.values(data.augments).find((a) => a.name === name);
const names = (list) => list.map((i) => i.name);

test('game data has the Mayhem pool, champions and items', () => {
  assert.ok(Object.keys(data.augments).length > 200);
  assert.ok(Object.keys(data.champions).length > 160);
  assert.ok(Object.values(data.items).some((i) => i.legendary && i.buildable));
});

test('profiles read damage type and role', () => {
  assert.strictEqual(profile(champ('Lux')).damage, 'ap');
  assert.strictEqual(profile(champ('Jinx')).role, 'Marksman');
  assert.strictEqual(profile(champ('Soraka')).role, 'Enchanter');
  assert.ok(profile(champ('KogMaw')).onHit);
});

test('builds are six distinct items with one pair of boots and match damage type', () => {
  for (const key of ['Lux', 'Jinx', 'Leona', 'Darius', 'Soraka', 'Zed', 'KogMaw']) {
    const p = profile(champ(key));
    const r = items.recommend({ data, profile: p });
    assert.strictEqual(r.build.length, 6, key);
    assert.strictEqual(new Set(r.build.map((i) => i.id)).size, 6, key);
    assert.strictEqual(r.build.filter((i) => i.boots).length, 1, key);
    for (const it of r.build) {
      const s = data.items[it.id].stats;
      if (p.damage === 'ap') assert.ok(!(s['Attack Damage'] >= 30 && !s['Ability Power']), `${key} got AD item ${it.name}`);
    }
  }
});

test('enemy healers bring anti-heal into the build', () => {
  const p = profile(champ('Jinx'));
  const healers = ['Soraka', 'Yuumi', 'Aatrox', 'Vladimir', 'Sona'].map((k) => profile(champ(k)));
  const r = items.recommend({ data, profile: p, enemies: healers });
  const all = [...r.build, ...r.situational];
  assert.ok(all.some((i) => i.reasons.some((x) => x.startsWith('Anti-heal'))), names(all).join(', '));
  assert.ok(!r.build[0].reasons.some((x) => x.startsWith('Anti-heal')), 'anti-heal should not be the first item');
});

test('next buy skips owned items and boots once boots are owned', () => {
  const p = profile(champ('Lux'));
  const first = items.recommend({ data, profile: p });
  const boots = first.build.find((i) => i.boots).id;
  const r = items.recommend({ data, profile: p, owned: [first.build[0].id, boots] });
  assert.ok(!r.next.some((i) => i.id === first.build[0].id));
  assert.ok(!r.next.some((i) => i.boots));
  assert.strictEqual(r.next.length, 3);
});

test('skill order puts R at 6, 11 and 16 and never over-levels', () => {
  const c = champ('Ezreal');
  const s = skills.recommend({ champ: c, profile: profile(c) });
  assert.deepStrictEqual([s.order[5], s.order[10], s.order[15]], ['R', 'R', 'R']);
  const count = (k, n) => s.order.slice(0, n).filter((x) => x === k).length;
  for (let lvl = 1; lvl <= 18; lvl++) for (const k of ['Q', 'W', 'E']) assert.ok(count(k, lvl) <= Math.ceil(lvl / 2));
  assert.strictEqual(s.priority[0], 'Q');
});

test('nextSkill points at the next ability to level', () => {
  const order = ['Q', 'W', 'E', 'Q', 'Q', 'R'];
  assert.strictEqual(skills.nextSkill(order, { Q: 1, W: 1, E: 0, R: 0 }, 3), 'E');
  assert.strictEqual(skills.nextSkill(order, { Q: 1, W: 1, E: 1, R: 0 }, 3), null);
});

test('recorded skill sequences win over the estimate', () => {
  const c = champ('Lux');
  const s = skills.recommend({ champ: c, profile: profile(c), recorded: { games: 4, priorities: { EQW: 3, QEW: 1 } } });
  assert.deepStrictEqual(s.priority, ['E', 'Q', 'W']);
  assert.match(s.source, /recorded/);
  assert.strictEqual(skills.priorityFromSequence(['Q', 'E', 'W', 'E', 'E', 'R', 'E', 'Q', 'E']), 'EQW');
});

test('augment ratings favour fitting augments and never show win rates', () => {
  const lux = profile(champ('Lux'));
  const offer = ['Big Brain', 'Get Excited!', 'Protein Shake'].map((n) => aug(n).id);
  const rated = augments.rateOffer({ data, community, profile: lux, offer });
  assert.strictEqual(rated.length, 3);
  assert.strictEqual(rated.filter((r) => r.best).length, 1);
  for (const r of rated) {
    assert.match(r.tier, /^[SABCD]$/);
    assert.ok(!r.reasons.some((x) => /%/.test(x)), 'no percentages in reasons');
  }
  const bigBrain = rated.find((r) => r.name === 'Big Brain');
  assert.ok(bigBrain.reasons.some((x) => /ability power/.test(x)));
});

test('champion ratings reward filling team gaps', () => {
  const team = [222, 99, 103, 1]; // Jinx, Lux, Ahri, Annie: no frontline
  const r = champions.rate({ data, community, candidates: [89, 25], team });
  const leona = r.find((x) => x.name === 'Leona');
  assert.ok(leona.reasons.includes('Team has no frontline'));
});

test('OCR matcher finds a row of augment names and ignores lone text', () => {
  const index = buildIndex(data.augments);
  const line = (text, x, y) => ({ text, words: [{ t: text, x, y, w: 200, h: 30 }] });
  const offer = findOffer([line('Choose an Augment', 600, 20), line('Big Brian', 100, 300), line('Get Excited!', 600, 302), line('Protein Shake', 1100, 299)], index, 700);
  assert.deepStrictEqual(offer.map((o) => data.augments[o.id].name), ['Big Brain', 'Get Excited!', 'Protein Shake']);
  assert.deepStrictEqual(findOffer([line('Big Brain', 100, 300)], index, 700), []);
});
