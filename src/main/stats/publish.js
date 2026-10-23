// Publishing the shared ARAM stats for friends without a key: writes
// shared/aram-stats.json (aggregated counts only) into the HOWL git checkout
// and commits and pushes it. Used by the app after each collection run and
// by `npm run publish-stats`.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const run = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => {
    if (err) { err.message = `git ${args[0]}: ${(stderr || err.message).trim()}`; reject(err); } else resolve(stdout);
  });
});

// Safety net: nothing that looks like a key, a match id or a player id.
function unsafe(text, key) {
  return /RGAPI-/i.test(text) || (key && text.includes(key)) || /[A-Z]{2,4}\d?_\d{6,}/.test(text) || /[\w-]{60,}/.test(text);
}

const isCheckout = (repoDir) => !!repoDir && fs.existsSync(path.join(repoDir, '.git'));

async function publishShared({ aram, repoDir, key = '', push = true }) {
  const shared = aram.exportShared();
  const text = JSON.stringify(shared);
  if (unsafe(text, key)) throw new Error('Refusing to publish: the stats contain something that looks like a key or an id.');
  const out = path.join(repoDir, 'shared', 'aram-stats.json');
  const result = { matches: shared.matches, bytes: text.length, pushed: false };
  // Same stats as last time (only the timestamp would differ): nothing to do.
  try {
    const old = JSON.parse(fs.readFileSync(out, 'utf8'));
    if (JSON.stringify(old.patches) === JSON.stringify(shared.patches)) return result;
  } catch { /* first publish */ }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  if (!push) return result;
  await run(repoDir, ['add', 'shared/aram-stats.json']);
  const staged = await run(repoDir, ['diff', '--cached', '--name-only']);
  if (!staged.trim()) return result;
  await run(repoDir, ['commit', '-m', `Update shared ARAM stats (${shared.matches} matches)`, '--', 'shared/aram-stats.json']);
  await run(repoDir, ['push']);
  return { ...result, pushed: true };
}

module.exports = { publishShared, isCheckout, unsafe };
