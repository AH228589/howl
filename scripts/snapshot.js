// Downloads the current patch's game data into data/gamedata.json, the copy
// the app ships with and falls back to when offline.
const fs = require('fs');
const path = require('path');
const { download } = require('../src/main/gamedata');

download(console.log).then((d) => {
  const out = path.join(__dirname, '..', 'data', 'gamedata.json');
  fs.writeFileSync(out, JSON.stringify(d));
  const augs = Object.values(d.augments);
  const missing = augs.filter((a) => !a.desc).map((a) => a.nameId);
  console.log(`Patch ${d.version}: ${Object.keys(d.champions).length} champions, ` +
    `${Object.keys(d.items).length} Howling Abyss items, ${augs.length} Mayhem augments`);
  console.log(`Augments without text: ${missing.length}${missing.length ? ' ' + missing.join(', ') : ''}`);
}).catch((e) => { console.error(e); process.exit(1); });
