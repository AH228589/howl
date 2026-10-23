// Static game data: champions, items and the Mayhem augment pool.
// Champions and items come from Data Dragon, augments from CommunityDragon
// (Riot's augment list for mode KIWI = ARAM: Mayhem, names and text from the
// game's string table). Results are cached per patch on disk.
const https = require('https');
const fs = require('fs');
const path = require('path');

const DDRAGON = 'https://ddragon.leagueoflegends.com';
const CDRAGON = 'https://raw.communitydragon.org/latest';
const CDRAGON_DATA = `${CDRAGON}/plugins/rcp-be-lol-game-data/global/default`;
const MAYHEM_MODE = 'KIWI';
const HOWLING_ABYSS = '12';

function getJson(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'HOWL/0.1' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(getJson(new URL(res.headers.location, url).toString(), redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${url} -> HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Riot rich text -> plain text. Template values (@Damage@) become "X".
function plainText(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/@[^@]*@/g, 'X')
    .replace(/%i:[a-zA-Z]+%/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cdragonAsset(p) {
  if (!p) return null;
  return `${CDRAGON_DATA}/${p.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase()}`;
}

function normalizeChampions(full, version) {
  const out = {};
  for (const c of Object.values(full.data)) {
    out[c.key] = {
      id: Number(c.key),
      key: c.id,
      name: c.name,
      title: c.title,
      tags: c.tags,
      info: c.info,
      partype: c.partype,
      range: c.stats.attackrange,
      icon: `${DDRAGON}/cdn/${version}/img/champion/${c.image.full}`,
      passive: { name: c.passive.name, desc: plainText(c.passive.description) },
      spells: c.spells.map((s, i) => ({
        key: 'QWER'[i],
        id: s.id,
        name: s.name,
        desc: plainText(s.description),
        maxrank: s.maxrank,
        cooldown: s.cooldown,
        icon: `${DDRAGON}/cdn/${version}/img/spell/${s.image.full}`,
      })),
    };
  }
  return out;
}

// "<stats><attention>90</attention> Ability Power<br>..." -> { 'Ability Power': 90 }
function parseItemStats(html) {
  const block = /<stats>([\s\S]*?)<\/stats>/i.exec(html || '');
  const stats = {};
  if (!block) return stats;
  for (const line of block[1].split(/<br\s*\/?>/i)) {
    const m = /^([\d.]+)(%?)\s+(.+)$/.exec(line.replace(/<[^>]+>/g, '').trim());
    if (m) stats[(m[2] ? '% ' : '') + m[3].trim()] = Number(m[1]);
  }
  return stats;
}

const itemPassives = (html) => [...String(html || '').matchAll(/<passive>([^<]+)<\/passive>/gi)].map((m) => m[1].trim());

function normalizeItems(itemJson, version) {
  const out = {};
  for (const [id, it] of Object.entries(itemJson.data)) {
    if (!it.maps || !it.maps[HOWLING_ABYSS]) continue;
    if (it.requiredChampion || it.hideFromAll) continue;
    const into = it.into || [];
    const tags = it.tags || [];
    const boots = tags.includes('Boots') && (it.depth || 1) >= 2;
    out[id] = {
      id: Number(id),
      name: it.name,
      plain: it.plaintext || '',
      desc: plainText(it.description),
      tags,
      stats: parseItemStats(it.description),
      passives: itemPassives(it.description),
      gold: it.gold.total,
      purchasable: it.gold.purchasable && it.inStore !== false,
      // Ids above 9999 are mode variants (Arena, augment rewards, legacy
      // event items) and are never recommended, except 12xxxx: those are the
      // Howling Abyss versions of items such as Hubris.
      buildable: (Number(id) < 10000 || (Number(id) >= 120000 && Number(id) < 130000)) && it.gold.purchasable && it.inStore !== false,
      from: (it.from || []).map(Number),
      into: into.map(Number),
      boots,
      // A finished item: nothing builds out of it and it is worth a real slot.
      legendary: !boots && into.length === 0 && it.gold.total >= 2200 && !tags.includes('Consumable'),
      starter: (it.depth || 1) === 1 && it.gold.total <= 500 && tags.includes('Lane'),
      icon: `${DDRAGON}/cdn/${version}/img/item/${id}.png`,
    };
  }
  return out;
}

const TEXT_KINDS = ['summary', 'tooltip', 'description', 'desc'];
const squash = (s) => s.toLowerCase().replace(/^(kiwi|cherry)_/, '').replace(/^aram_/, '').replace(/[^a-z0-9]/g, '');

// String table keys follow "<mode>_<augment>_<kind>", but the augment part
// does not always match the augment's id, so we index by a squashed form and
// also by the augment's display name.
function indexStrings(entries) {
  const text = new Map();
  const byName = new Map();
  for (const [k, v] of Object.entries(entries)) {
    const m = /^(kiwi|cherry)_(.+)_([a-z]+)$/.exec(k);
    if (!m) continue;
    const [, mode, mid, kind] = m;
    const key = squash(mid);
    if (TEXT_KINDS.includes(kind)) {
      const slot = text.get(key) || {};
      const id = `${mode}:${kind}`;
      if (!slot[id]) slot[id] = v;
      text.set(key, slot);
    } else if (kind === 'name') {
      const n = String(v).toLowerCase();
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(key);
    }
  }
  return { entries, text, byName };
}

function augmentText(index, nameId, displayName) {
  const { entries, text, byName } = index;
  const resolve = (v, depth = 0) => String(v).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) =>
    depth < 2 && entries[k.toLowerCase()] ? resolve(entries[k.toLowerCase()], depth + 1) : '');
  const keys = [squash(nameId), ...(byName.get(String(displayName).toLowerCase()) || [])];
  for (const kind of TEXT_KINDS) {
    for (const mode of ['kiwi', 'cherry']) {
      for (const key of keys) {
        const v = text.get(key)?.[`${mode}:${kind}`];
        const t = v && plainText(resolve(v));
        if (t) return t;
      }
    }
  }
  return '';
}

function normalizeAugments(cherry, lists, strings) {
  const pool = lists.find((l) => l.modeName === MAYHEM_MODE);
  if (!pool) throw new Error('No KIWI (ARAM: Mayhem) augment list in CommunityDragon data');
  const byNameId = new Map(cherry.map((a) => [a.augmentNameId, a]));
  const entries = indexStrings(strings.entries || strings);
  const out = {};
  for (const p of pool.augmentList) {
    const nameId = p.split('/').pop();
    const a = byNameId.get(nameId);
    if (!a) continue;
    out[a.id] = {
      id: a.id,
      nameId,
      name: a.nameTRA,
      rarity: { kSilver: 'silver', kGold: 'gold', kPrismatic: 'prismatic' }[a.rarity] || 'silver',
      desc: augmentText(entries, nameId, a.nameTRA),
      icon: cdragonAsset(a.augmentSmallIconPath),
    };
  }
  return out;
}

// Downloads everything for the current patch. `log` gets progress lines.
async function download(log = () => {}) {
  const versions = await getJson(`${DDRAGON}/api/versions.json`);
  const version = versions[0];
  log(`Data Dragon ${version}`);
  const [full, items, cherry, lists, summoners] = await Promise.all([
    getJson(`${DDRAGON}/cdn/${version}/data/en_US/championFull.json`),
    getJson(`${DDRAGON}/cdn/${version}/data/en_US/item.json`),
    getJson(`${CDRAGON_DATA}/v1/cherry-augments.json`),
    getJson(`${CDRAGON_DATA}/v1/augment-lists.json`),
    getJson(`${DDRAGON}/cdn/${version}/data/en_US/summoner.json`),
  ]);
  log('Champions, items and augment list downloaded, fetching augment text');
  const strings = await getJson(`${CDRAGON}/game/en_us/data/menu/en_us/lol.stringtable.json`);
  return {
    version,
    fetchedAt: new Date().toISOString(),
    champions: normalizeChampions(full, version),
    items: normalizeItems(items, version),
    augments: normalizeAugments(cherry, lists, strings),
    // Every augment Riot has shipped (Arena and retired Mayhem ones too), so
    // older recorded games still show names and icons.
    augmentArchive: Object.fromEntries(cherry.map((a) => [a.id, {
      id: a.id, name: a.nameTRA, icon: cdragonAsset(a.augmentSmallIconPath),
      rarity: { kSilver: 'silver', kGold: 'gold', kPrismatic: 'prismatic' }[a.rarity] || 'silver',
    }])),
    spells: Object.fromEntries(Object.values(summoners.data).map((sp) => [sp.key, {
      id: Number(sp.key), name: sp.name, icon: `${DDRAGON}/cdn/${version}/img/spell/${sp.image.full}`,
    }])),
  };
}

// Loads the cached data for the newest patch, downloading it when the patch
// changed. Falls back to the bundled snapshot when offline.
async function load({ cacheDir, snapshotPath, log = () => {}, offline = false }) {
  const cacheFile = path.join(cacheDir, 'gamedata.json');
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const cached = readJson(cacheFile) || readJson(snapshotPath);
  if (offline && cached) return cached;
  try {
    const versions = await getJson(`${DDRAGON}/api/versions.json`);
    if (cached && cached.version === versions[0]) return cached;
    const fresh = await download(log);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(fresh));
    return fresh;
  } catch (err) {
    log(`Game data update failed (${err.message}), using cached copy`);
    if (cached) return cached;
    throw err;
  }
}

// Upgraded items count as the item that was bought (Tear items transform
// once their mana is stacked).
const UPGRADED_FROM = { 3042: 3004, 3040: 3003, 3121: 3119 };
const canonicalItem = (id) => UPGRADED_FROM[id] || id;

module.exports = { canonicalItem, load, download, getJson, plainText, normalizeAugments, augmentText };
