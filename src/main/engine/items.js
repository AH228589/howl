// Item recommendations. Each finished item is valued by how much of its gold
// goes into stats this champion wants, plus passive synergies, adjusted for
// the enemy team. Real Mayhem builds from games HOWL has recorded are blended
// in as they accumulate.

// Gold value of one point of each stat (Summoner's Rift base item prices).
const GOLD_PER_POINT = {
  'Ability Power': 20, 'Attack Damage': 35, '% Attack Speed': 25, '% Critical Strike Chance': 40,
  Health: 2.67, Armor: 20, 'Magic Resist': 18, Mana: 1.4, 'Ability Haste': 26.67,
  Lethality: 30, 'Magic Penetration': 31, '% Magic Penetration': 46, '% Armor Penetration': 41,
  'Move Speed': 12, '% Move Speed': 39.5, '% Life Steal': 37.5, '% Omnivamp': 40,
  '% Heal and Shield Power': 54, '% Tenacity': 0, '% Base Mana Regen': 4, '% Base Health Regen': 3,
  'Mana Regen per 5 seconds': 4, 'Health Regen per 5 seconds': 3,
};

const W = {
  Mage: { 'Ability Power': 1, 'Ability Haste': 0.8, 'Magic Penetration': 0.8, '% Magic Penetration': 0.45, Mana: 0.35, Health: 0.25, 'Move Speed': 0.3, '% Move Speed': 0.3, '% Base Mana Regen': 0.3 },
  Marksman: { 'Attack Damage': 1, '% Attack Speed': 1, '% Critical Strike Chance': 1, '% Life Steal': 0.5, '% Armor Penetration': 0.5, Lethality: 0.2, 'Move Speed': 0.4, '% Move Speed': 0.4, Health: 0.1 },
  Assassin: { 'Attack Damage': 1, Lethality: 1, 'Ability Haste': 0.7, 'Move Speed': 0.4, '% Move Speed': 0.4, Health: 0.15, '% Omnivamp': 0.3 },
  Fighter: { 'Attack Damage': 0.9, Health: 0.8, 'Ability Haste': 0.8, Armor: 0.4, 'Magic Resist': 0.3, '% Omnivamp': 0.6, '% Life Steal': 0.3, '% Attack Speed': 0.3, '% Armor Penetration': 0.6, '% Tenacity': 0.2 },
  Tank: { Health: 1, Armor: 1, 'Magic Resist': 1, 'Ability Haste': 0.7, 'Move Speed': 0.3, '% Move Speed': 0.3, '% Base Health Regen': 0.3, 'Health Regen per 5 seconds': 0.3 },
  Enchanter: { '% Heal and Shield Power': 1, 'Ability Power': 0.4, 'Ability Haste': 1, Mana: 0.4, '% Base Mana Regen': 0.6, 'Mana Regen per 5 seconds': 0.6, Health: 0.2, 'Move Speed': 0.3, '% Move Speed': 0.3 },
};

function statWeights(p, ctx) {
  const w = { ...W[p.role] };
  if (p.damage === 'ap' && (p.role === 'Assassin' || p.role === 'Fighter')) {
    // AP bruisers and AP assassins value AP where the table says AD.
    w['Ability Power'] = w['Attack Damage'];
    w['Magic Penetration'] = p.role === 'Assassin' ? 1 : 0.6;
    w['% Magic Penetration'] = w['Magic Penetration'];
    delete w['Attack Damage']; delete w.Lethality; delete w['% Armor Penetration'];
  }
  if (p.damage === 'mixed' && p.role !== 'Tank') w['Ability Power'] = Math.max(w['Ability Power'] || 0, 0.5);
  if (p.onHit) { w['% Attack Speed'] = Math.max(w['% Attack Speed'] || 0, 1); w['% Critical Strike Chance'] = Math.min(w['% Critical Strike Chance'] || 0, 0.2); }
  if (p.role === 'Marksman' && !p.crit && !p.onHit && p.damage === 'ad') w['Ability Haste'] = 0.4;
  if (!p.mana) { delete w.Mana; delete w['% Base Mana Regen']; delete w['Mana Regen per 5 seconds']; }

  // Defensive stats follow the enemy damage mix. Squishies get a little,
  // frontliners a lot.
  const frontline = p.role === 'Tank' || p.role === 'Fighter';
  const base = frontline ? 0.35 : 0.08;
  const swing = frontline ? 0.75 : 0.25;
  w.Armor = Math.max(w.Armor || 0, base + swing * ctx.enemyAdShare);
  w['Magic Resist'] = Math.max(w['Magic Resist'] || 0, base + swing * ctx.enemyApShare);
  if (ctx.enemyCc >= 12) w['% Tenacity'] = 0.5;
  return w;
}

const has = (item, re) => re.test(item.desc);

const critBuild = (p) => p.role === 'Marksman' && !p.onHit && p.damage === 'ad';

// Synergies that do not depend on the enemy team.
function passiveBonus(item, p) {
  const reasons = [];
  let b = 0;
  if (p.onHit && has(item, /on-hit/i)) { b += 0.25; reasons.push('On-hit synergy'); }
  if (p.spellblade && item.passives.includes('Spellblade')) { b += 0.25; reasons.push('Spellblade synergy'); }
  if (p.role === 'Fighter' && item.passives.includes('Spellblade') && p.damage !== 'ap') b += 0.08;
  if (p.role === 'Tank' && !p.ranged && item.passives.includes('Immolate')) { b += 0.15; reasons.push('Immolate for melee tanks'); }
  if (p.damage === 'ap' && !p.ranged && p.role === 'Assassin' && item.name === 'Lich Bane') b += 0.1;
  if (critBuild(p) && has(item, /critical strike damage/i)) { b += 0.3; reasons.push('Crit damage amp'); }
  if (critBuild(p) && item.stats['% Critical Strike Chance']) b += 0.1;
  if (p.damage === 'ap' && p.role === 'Mage' && item.passives.includes('Magical Opus')) b += 0.2;
  if (p.role === 'Enchanter' && has(item, /(heal|shield)(s|ing|ed)?\b[^.]{0,60}\ball(y|ies)|\ball(y|ies)\b[^.]{0,60}\b(heal|shield)/i)) {
    b += 0.35; reasons.push('Empowers your heals and shields');
  }
  return { b, reasons };
}

// Bonuses that answer the enemy team; these items slot in after the core.
function enemyBonus(item, ctx) {
  const reasons = [];
  let b = 0;
  if (ctx.enemyHealers >= 2 && has(item, /Grievous Wounds/)) {
    b += 0.12 * ctx.enemyHealers; reasons.push(`Anti-heal vs ${ctx.enemyHealers} healers`);
  }
  if (ctx.enemyTanks >= 2 && (item.stats['% Armor Penetration'] || item.stats['% Magic Penetration'] || has(item, /max(imum)? Health (physical|magic|true)? ?damage/i))) {
    b += 0.15; reasons.push(`Penetration vs ${ctx.enemyTanks} tanks`);
  }
  return { b, reasons };
}

// Damage-type sanity: an AP champion never wants an item that is mostly AD.
function wrongDamage(item, p) {
  const s = item.stats;
  if (p.damage === 'ap' && (s['Attack Damage'] || 0) >= 30 && !s['Ability Power']) return true;
  if (p.damage === 'ad' && (s['Ability Power'] || 0) >= 50 && !s['Attack Damage'] && p.role !== 'Tank') return true;
  return false;
}

function scoreItem(item, p, ctx, weights) {
  let value = 0;
  let top = null;
  for (const [stat, amount] of Object.entries(item.stats)) {
    const v = (GOLD_PER_POINT[stat] || 0) * amount * (weights[stat] || 0);
    value += v;
    if (!top || v > top.v) top = { stat, v };
  }
  const ratio = item.gold > 0 ? value / item.gold : 0;
  const own = passiveBonus(item, p);
  const vs = enemyBonus(item, ctx);
  const reasons = [...vs.reasons, ...own.reasons];
  if (top && top.v > 0) {
    if (top.stat === 'Armor' && ctx.enemyAdShare >= 0.6) reasons.push('Armor vs AD-heavy team');
    if (top.stat === 'Magic Resist' && ctx.enemyApShare >= 0.6) reasons.push('Magic resist vs AP-heavy team');
  }
  const base = ratio + own.b - (wrongDamage(item, p) ? 1 : 0);
  return { base, score: base + vs.b, reasons };
}

// Enemy team summary from their champion profiles.
function enemyContext(enemyProfiles) {
  const n = enemyProfiles.length || 1;
  const ad = enemyProfiles.reduce((s, e) => s + (e.damage === 'ad' ? 1 : e.damage === 'mixed' ? 0.5 : 0), 0);
  const known = enemyProfiles.length > 0;
  return {
    known,
    enemyAdShare: known ? ad / n : 0.5,
    enemyApShare: known ? 1 - ad / n : 0.5,
    enemyHealers: enemyProfiles.filter((e) => e.healer).length,
    enemyTanks: enemyProfiles.filter((e) => e.tanky).length,
    enemyCc: enemyProfiles.reduce((s, e) => s + e.cc, 0),
  };
}

// Unique passives conflict (two Lifeline items, two Spellblade items...).
function conflicts(a, b) {
  return a.name === b.name || a.passives.some((x) => b.passives.includes(x));
}

// pool: personal/recorded Mayhem item stats for this champion
// { games, items: { [itemId]: { picks, wins } } } or null.
// global: ARAM stats from Riot's match API for this champion
// { games, realGames, items, first: { [itemId]: count } } or null.
function recommend({ data, profile: p, enemies = [], owned = [], pool = null, global = null }) {
  const ctx = enemyContext(enemies);
  const weights = statWeights(p, ctx);
  const confidence = pool ? pool.games / (pool.games + 6) : 0;
  const globalConf = global ? global.realGames / (global.realGames + 10) : 0;
  // With real games behind it, the kit estimate fades to a tie-breaker.
  const kitWeight = 1 - 0.65 * globalConf;
  const firstTotal = global ? Object.values(global.first).reduce((a, b) => a + b, 0) : 0;
  const scored = [];
  for (const item of Object.values(data.items)) {
    if (!item.buildable || !(item.legendary || item.boots)) continue;
    const { base, score, reasons } = scoreItem(item, p, ctx, weights);
    let seen = 0;
    const rec = pool && pool.items[item.id];
    if (rec && pool.games > 0) {
      const share = rec.picks / pool.games;
      seen = 1.2 * share * confidence;
      if (share >= 0.3 && pool.games >= 3) reasons.unshift(`Common in recorded Mayhem games (${rec.picks}/${pool.games})`);
    }
    const g = global && global.items[item.id];
    if (g && global.games > 0) {
      const share = g.picks / global.games;
      seen += 4 * share * globalConf;
      if (share >= 0.25 && global.realGames >= 8) reasons.unshift(`Built in ${Math.round(share * 100)}% of ${global.realGames} ARAM games`);
    }
    // How often real players finish this item first.
    const first = firstTotal ? ((global.first[item.id] || 0) / firstTotal) * globalConf : 0;
    scored.push({ id: item.id, name: item.name, icon: item.icon, gold: item.gold, boots: item.boots, base: base * kitWeight + seen, score: base * kitWeight + seen + (score - base), first, reasons, item });
  }
  scored.sort((a, b) => b.score - a.score);

  const ownedSet = new Set(owned);
  const pickList = (list, count, already) => {
    const out = [];
    for (const c of list) {
      if (out.length >= count) break;
      if ([...already, ...out].some((x) => conflicts(x.item, c.item))) continue;
      out.push(c);
    }
    return out;
  };

  const legendaries = scored.filter((c) => !c.boots);
  const boots = scored.filter((c) => c.boots)[0];
  // Core comes from what the champion wants on its own; answers to the enemy
  // team (anti-heal, penetration) take over from slot three onwards.
  // Multipliers and percent penetration only pay off on top of other items,
  // so they never take the first two slots.
  const late = (c) => c.item.passives.includes('Magical Opus') || !!c.item.stats['% Magic Penetration'] || !!c.item.stats['% Armor Penetration'];
  const byBase = [...legendaries].sort((a, b) => b.base - a.base);
  const opener = byBase.filter((c) => !late(c)).sort((a, b) => (b.base + 2.5 * b.first) - (a.base + 2.5 * a.first));
  const core = pickList([opener[0], ...byBase.filter((c) => !late(c)).slice(0, 2), ...byBase].filter(Boolean), 5, []);
  const answers = pickList(legendaries.filter((c) => c.score - c.base > 0.01 && !core.includes(c)), 2, core.slice(0, 2));
  const later = [...core.slice(2), ...answers].sort((a, b) => b.score - a.score);
  const rest = pickList(later, 3, core.slice(0, 2));
  const estimated = [core[0], boots, core[1], ...rest].filter(Boolean);
  // Buy order: where real players finish each item on average (0 = first),
  // once an item has a few games behind it; the estimate fills the gaps.
  const avgPos = (c) => {
    const o = global?.order?.[c.id];
    return o && o.n >= 3 ? o.sum / o.n : null;
  };
  const ordered = estimated.map((c, i) => ({ c, key: avgPos(c) ?? i }));
  const build = ordered.sort((a, b) => a.key - b.key).map((x) => x.c);
  const orderGames = global ? Math.max(0, ...build.map((c) => global.order?.[c.id]?.n || 0)) : 0;
  const situational = pickList(legendaries.filter((c) => !build.includes(c)), 4, [])
    .filter((c) => c.reasons.length || c.score > build[build.length - 1].score - 0.15);

  // Next buy: first build item not yet owned; also offer the two best
  // alternatives that fit with what is owned.
  const ownedItems = scored.filter((c) => ownedSet.has(c.id));
  const next = [];
  for (const c of [...build, ...situational, ...legendaries]) {
    if (next.length >= 3) break;
    if (ownedSet.has(c.id) || next.includes(c)) continue;
    if ([...ownedItems, ...next].some((x) => conflicts(x.item, c.item))) continue;
    if (c.boots && ownedItems.some((x) => x.boots)) continue;
    next.push(c);
  }

  const strip = ({ item, ...rest }) => ({ ...rest, components: item.from });
  return {
    context: ctx,
    build: build.map(strip),
    situational: situational.map(strip),
    next: next.map(strip),
    source: sourceLabel(pool, confidence, global, globalConf, orderGames),
  };
}

function sourceLabel(pool, confidence, global, globalConf, orderGames) {
  const parts = [];
  if (global && globalConf >= 0.25) parts.push(`${global.realGames} ARAM games`);
  if (pool && confidence >= 0.3) parts.push(`${pool.games} recorded Mayhem games`);
  const base = parts.length ? `Kit estimate blended with ${parts.join(' and ')}` : 'Estimated from your champion\'s kit';
  return orderGames >= 3 ? `${base}. Buy order from ${orderGames} ARAM games` : base;
}

module.exports = { recommend, enemyContext, statWeights, scoreItem };
