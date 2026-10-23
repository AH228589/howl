// Publishes your collected ARAM stats for friends running HOWL without a key.
// Writes shared/aram-stats.json with aggregated counts only (no API key, no
// match ids, no player ids), then with --push commits and pushes it.
//   npm run publish-stats            write the file
//   npm run publish-stats -- --push  write, commit and push
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { AramStats } = require('../src/main/stats/aram');

const ROOT = path.join(__dirname, '..');
const source = process.argv.find((a) => a.endsWith('.json')) || path.join(process.env.APPDATA || '', 'howl', 'aram-stats.json');
const out = path.join(ROOT, 'shared', 'aram-stats.json');
const data = require(path.join(ROOT, 'data', 'gamedata.json'));

if (!fs.existsSync(source)) {
  console.error(`No collected stats at ${source}. Run HOWL with your Riot API key first.`);
  process.exit(1);
}
const stats = new AramStats({ file: source, data });
const shared = stats.exportShared();
const text = JSON.stringify(shared);

// Safety net: nothing that looks like a key, a match id or a player id.
const settingsFile = path.join(path.dirname(source), 'settings.json');
const key = fs.existsSync(settingsFile) ? (JSON.parse(fs.readFileSync(settingsFile, 'utf8')).riotApiKey || '') : '';
if (/RGAPI-/i.test(text) || (key && text.includes(key)) || /[A-Z]{2,4}\d?_\d{6,}/.test(text) || /[\w-]{60,}/.test(text)) {
  console.error('Refusing to publish: the output contains something that looks like a key or an id.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text);
const champs = new Set(Object.values(shared.patches).flatMap((p) => Object.keys(p.champs)));
console.log(`Wrote ${path.relative(ROOT, out)}: ${shared.matches} ARAM matches, ${champs.size} champions, ${(text.length / 1024).toFixed(0)} KB`);

if (process.argv.includes('--push')) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' });
  git('add', 'shared/aram-stats.json');
  try {
    git('commit', '-m', `Update shared ARAM stats (${shared.matches} matches)`);
  } catch {
    console.log('Nothing new to commit.');
  }
  git('push');
}
