// Auto-publishing shared stats: commits only the stats file and pushes it,
// against a throwaway local repository and remote.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const fakeApi = require('./fake-riot-api');
const data = require('../data/gamedata.json');
const { AramStats } = require('../src/main/stats/aram');
const { publishShared, unsafe } = require('../src/main/stats/publish');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('stats are committed alone and pushed, and only when they changed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'howl-pub-'));
  const remote = path.join(dir, 'remote.git');
  const repo = path.join(dir, 'repo');
  git(dir, 'init', '--bare', '-q', '-b', 'main', remote);
  git(dir, 'clone', '-q', remote, repo);
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(repo, 'README.md'), 'x');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(repo, 'work-in-progress.js'), 'not for this commit');

  const api = await fakeApi.start({ port: 47321 });
  try {
    const aram = new AramStats({ file: path.join(dir, 'aram.json'), data });
    await aram.crawl({ key: api.key, route: 'europe', base: api.base, seeds: [{ name: 'Tester', tag: 'HOWL' }], maxRequests: 40 });

    const first = await publishShared({ aram, repoDir: repo, key: api.key });
    assert.ok(first.pushed);
    assert.match(git(remote, 'log', '-1', '--format=%s', 'main'), /Update shared ARAM stats/);
    assert.deepStrictEqual(git(remote, 'show', '--name-only', '--format=', 'main').split('\n'), ['shared/aram-stats.json']);
    assert.ok(!git(repo, 'status', '--short').includes('shared/'), 'stats committed');
    assert.ok(git(repo, 'status', '--short').includes('work-in-progress.js'), 'other work left alone');

    const again = await publishShared({ aram, repoDir: repo, key: api.key });
    assert.strictEqual(again.pushed, false, 'nothing to push when unchanged');
  } finally { api.close(); }

  assert.ok(unsafe('{"key":"RGAPI-abc"}'));
  assert.ok(unsafe('{"id":"EUN1_4018126919"}'));
  assert.ok(!unsafe('{"champs":{"222":{"games":3}}}'));
});
