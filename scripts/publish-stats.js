// Publishes your collected ARAM stats for friends running HOWL without a key.
// HOWL does this on its own after each collection run when it runs from this
// git checkout; this script is the manual version.
//   npm run publish-stats            write shared/aram-stats.json
//   npm run publish-stats -- --push  write, commit and push
const fs = require('fs');
const path = require('path');
const { AramStats } = require('../src/main/stats/aram');
const { publishShared } = require('../src/main/stats/publish');

const ROOT = path.join(__dirname, '..');
const source = process.argv.find((a) => a.endsWith('.json')) || path.join(process.env.APPDATA || '', 'howl', 'aram-stats.json');
const data = require(path.join(ROOT, 'data', 'gamedata.json'));

if (!fs.existsSync(source)) {
  console.error(`No collected stats at ${source}. Run HOWL with your Riot API key first.`);
  process.exit(1);
}
const settingsFile = path.join(path.dirname(source), 'settings.json');
const key = fs.existsSync(settingsFile) ? (JSON.parse(fs.readFileSync(settingsFile, 'utf8')).riotApiKey || '') : '';

publishShared({ aram: new AramStats({ file: source, data }), repoDir: ROOT, key, push: process.argv.includes('--push') })
  .then((r) => console.log(`shared/aram-stats.json: ${r.matches} ARAM matches, ${(r.bytes / 1024).toFixed(0)} KB${r.pushed ? ', pushed' : ''}`))
  .catch((e) => { console.error(e.message); process.exit(1); });
