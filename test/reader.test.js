// Augment card tracking: rerolls, partial reads and picks. Electron is
// stubbed so this runs under plain Node.
const test = require('node:test');
const assert = require('node:assert');
const data = require('../data/gamedata.json');

let cursor = { x: 0, y: 0 };
require.cache[require.resolve('electron')] = {
  id: 'electron', loaded: true,
  exports: { desktopCapturer: {}, screen: { getCursorScreenPoint: () => cursor } },
};
const { AugmentReader } = require('../src/main/ocr/reader');

const id = (name) => Object.values(data.augments).find((a) => a.name === name).id;
const card = (name, col) => ({ id: id(name), rect: { x: 500 + col * 400, y: 500, w: 200, h: 30 } });
const bounds = { width: 1920, height: 1080 };

test('rerolls update one card at a time and short gaps are not picks', async () => {
  const reader = new AugmentReader({ augments: data.augments });
  reader.pickDelay = 60;
  const offers = [];
  const cleared = [];
  const hidden = [];
  reader.on('offer', (cards) => offers.push(cards.map((c) => data.augments[c.id].name)));
  reader.on('cleared', () => hidden.push(true));
  reader.on('picked', (pick) => cleared.push(pick));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  reader.handle([card('Big Brain', 0), card('Get Excited!', 1), card('Protein Shake', 2)], bounds);
  assert.deepStrictEqual(offers.at(-1), ['Big Brain', 'Get Excited!', 'Protein Shake']);

  // A scan that only reads one unchanged name changes nothing.
  reader.handle([card('Get Excited!', 1)], bounds);
  assert.strictEqual(offers.length, 1);

  // Middle card rerolled, and only that name was read this scan.
  reader.handle([card('Totentanz', 1)], bounds);
  assert.deepStrictEqual(offers.at(-1), ['Big Brain', 'Totentanz', 'Protein Shake']);

  // Reroll animation: two empty scans, then the new name appears.
  reader.handle([], bounds);
  reader.handle([], bounds);
  assert.strictEqual(cleared.length, 0, 'a short gap is not the cards closing');
  reader.handle([card('Big Brain', 0), card('Totentanz', 1), card('Get Jinxed', 2)], bounds);
  assert.deepStrictEqual(offers.at(-1), ['Big Brain', 'Totentanz', 'Get Jinxed']);

  // Names unreadable for a few seconds (hover), then the same cards again:
  // badges hide meanwhile, but nothing counts as picked.
  for (let i = 0; i < 3; i++) reader.handle([], bounds);
  assert.strictEqual(hidden.length, 1);
  reader.handle([card('Big Brain', 0), card('Totentanz', 1), card('Get Jinxed', 2)], bounds);
  await wait(120);
  assert.deepStrictEqual(cleared, [], 'a flicker is not a pick');

  // Player clicks the right-hand card, cards close for good.
  reader.cursor = { x: 1300, y: 600 };
  for (let i = 0; i < 3; i++) reader.handle([], bounds);
  assert.deepStrictEqual(cleared, [], 'the pick waits to be sure');
  await wait(120);
  assert.deepStrictEqual(cleared, [id('Get Jinxed')]);
  reader.trackCursor(false);
});

test('a re-scan pressed during a scan is queued, not dropped, and re-rates the cards', async () => {
  const reader = new AugmentReader({ augments: data.augments });
  const line = (text, x) => ({ text, words: [{ t: text, x, y: 300, w: 200, h: 30 }] });
  let scans = 0;
  reader.capture = async () => ({ file: 'x', height: 700, png: Buffer.alloc(0), screen: bounds, toScreen: (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }) });
  reader.ocr = async () => {
    scans++;
    await new Promise((r) => setTimeout(r, 40));
    return { ok: true, lines: [line('Big Brain', 100), line('Get Excited!', 600), line('Protein Shake', 1100)] };
  };
  const offers = [];
  reader.on('offer', (cards) => offers.push(cards.length));

  const background = reader.scan(); // the regular loop's scan
  const hotkey = reader.scan({ force: true }); // pressed while it runs
  assert.strictEqual(await reader.scan(), null, 'a second regular scan is skipped');
  const [bg, hk] = await Promise.all([background, hotkey]);
  assert.strictEqual(bg.length, 3);
  assert.strictEqual(hk.length, 3, 'the hotkey scan ran and returned cards');
  assert.strictEqual(scans, 2);
  assert.deepStrictEqual(offers, [3, 3], 'the forced re-scan re-rated the same cards');
  reader.trackCursor(false);
});
