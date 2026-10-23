// Augment scoring. Each offer is rated from three things: the community tier
// (data/community), how well the augment's effect fits this champion, and set
// progress. Recorded games nudge the score but no win rate is ever shown:
// Riot's developer policy forbids displaying augment win rates.

const TAGS = {
  ap: /ability power/, ad: /attack damage/, as: /attack speed/, crit: /critical/,
  onhit: /on-hit|basic attacks?|attacks? (deal|apply)/, haste: /ability haste|cooldown/,
  ult: /ultimate/, ally: /\ball(y|ies)\b/, heal: /\bheal/, shield: /\bshield/,
  hp: /\b(max(imum)? )?health\b/, resist: /\barmor\b|magic resist/, ms: /move(ment)? speed/,
  mana: /\bmana\b/, vamp: /omnivamp|life ?steal|vamp/, tenacity: /tenacity/,
  melee: /\bmelee\b/, ranged: /\branged\b/, summoner: /summoner spell/,
};

function wants(p) {
  const w = { haste: 0.6, ms: 0.3, hp: 0.3, resist: 0.2, ult: 0.4, summoner: 0.35 };
  const ap = p.damage === 'ap' ? 1 : p.damage === 'mixed' ? 0.6 : 0;
  const ad = p.damage === 'ad' ? 1 : p.damage === 'mixed' ? 0.6 : 0;
  Object.assign(w, { ap, ad });
  if (p.role === 'Marksman') Object.assign(w, { as: 1, crit: p.onHit ? 0.2 : 1, onhit: p.onHit ? 1 : 0.6, vamp: 0.5, haste: 0.35 });
  if (p.role === 'Mage') Object.assign(w, { haste: 1, mana: p.mana ? 0.5 : 0, ult: 0.7 });
  if (p.role === 'Assassin') Object.assign(w, { haste: 0.8, ms: 0.6, ult: 0.6 });
  if (p.role === 'Fighter') Object.assign(w, { hp: 0.8, resist: 0.5, vamp: 0.8, haste: 0.8, as: p.onHit ? 0.8 : 0.3, onhit: p.onHit ? 0.8 : 0.3, tenacity: 0.4 });
  if (p.role === 'Tank') Object.assign(w, { hp: 1, resist: 1, tenacity: 0.6, ally: 0.4, shield: 0.4, heal: 0.3, ap: Math.min(ap, 0.4), ad: Math.min(ad, 0.4) });
  if (p.role === 'Enchanter') Object.assign(w, { ally: 1, heal: 1, shield: 1, haste: 1, mana: p.mana ? 0.5 : 0 });
  if (p.onHit) Object.assign(w, { as: 1, onhit: 1 });
  if (p.healer && p.role !== 'Enchanter') w.heal = Math.max(w.heal || 0, 0.5);
  return w;
}

const LABEL = {
  ap: 'ability power', ad: 'attack damage', as: 'attack speed', crit: 'crit', onhit: 'on-hit',
  haste: 'ability haste', ult: 'your ultimate', ally: 'helping allies', heal: 'healing', shield: 'shields',
  hp: 'health', resist: 'resists', ms: 'move speed', mana: 'mana', vamp: 'sustain', tenacity: 'tenacity', summoner: 'summoner spells',
};

function augmentTags(aug) {
  const d = (aug.desc || '').toLowerCase();
  const tags = Object.keys(TAGS).filter((t) => TAGS[t].test(d));
  // "...but you cannot use your Ultimate" is a cost, not a synergy.
  return /cannot (use|cast)[^.]*ultimate/.test(d) ? tags.filter((t) => t !== 'ult') : tags;
}

function fit(aug, p) {
  const tags = augmentTags(aug);
  if (!tags.length) return { fit: 0.45, matched: [] };
  if (tags.includes('melee') && !tags.includes('ranged') && p.ranged) return { fit: 0.1, matched: [], note: 'Melee-only' };
  if (tags.includes('ranged') && !tags.includes('melee') && !p.ranged) return { fit: 0.15, matched: [], note: 'Ranged-only' };
  const w = wants(p);
  const scored = tags.filter((t) => LABEL[t]).map((t) => ({ t, v: w[t] || 0 })).sort((a, b) => b.v - a.v);
  if (!scored.length) return { fit: 0.45, matched: [] };
  // The best two matches carry the augment; one stat the champion has no use
  // for (an AP augment on an AD champion) drags it down.
  const best = scored.slice(0, 2);
  let f = best.reduce((s, x) => s + x.v, 0) / best.length;
  const primary = scored.find((x) => ['ap', 'ad', 'as', 'crit', 'heal', 'shield'].includes(x.t));
  if (primary && primary.v === 0 && scored[0].v < 0.7) f *= 0.4;
  return { fit: Math.min(1, f), matched: best.filter((x) => x.v >= 0.6).map((x) => LABEL[x.t]) };
}

const TIER_VALUE = { S: 1, A: 0.8, B: 0.6, C: 0.4, D: 0.2 };
const toTier = (v) => (v >= 0.82 ? 'S' : v >= 0.68 ? 'A' : v >= 0.52 ? 'B' : v >= 0.38 ? 'C' : 'D');

// offer: augment ids. picked: ids already taken this game.
// community: data/community/mayhem-reference.json (may be empty).
// recorded: { [augmentId]: { picks, wins } } for similar champions, or null.
function rateOffer({ data, community = {}, profile: p, offer, picked = [], recorded = null }) {
  const ref = community.augments || {};
  const setsTaken = {};
  for (const id of picked) for (const s of ref[id]?.sets || []) setsTaken[s] = (setsTaken[s] || 0) + 1;

  const rated = offer.map((id) => {
    const aug = data.augments[id];
    if (!aug) return { id, name: `Unknown augment ${id}`, tier: '?', score: 0, reasons: [] };
    const r = ref[id] || {};
    const merged = { ...aug, desc: aug.desc || r.desc || '' };
    const tierValue = TIER_VALUE[r.tier] ?? 0.5;
    const { fit: f, matched, note } = fit(merged, p);
    const reasons = [];
    let set = 0;
    for (const s of r.sets || []) {
      const have = setsTaken[s] || 0;
      const sizes = community?.sets?.[s]?.sizes || [2];
      const nextSize = sizes.find((n) => n > have) || sizes[0];
      if (have > 0) { set = Math.max(set, 0.25 + 0.1 * have); reasons.push(`${s} set ${have + 1}/${nextSize}`); } else reasons.push(`Starts ${s} set`);
    }
    let personal = 0;
    const rec = recorded?.[id];
    if (rec && rec.picks >= 3) {
      // Bayesian-shrunk result vs a coin flip, used only as a nudge.
      personal = ((rec.wins + 3) / (rec.picks + 6) - 0.5) * 0.4;
      if (personal > 0.04) reasons.push('Has done well in your recorded games');
    }
    if (matched.length) reasons.unshift(`Fits your ${matched.join(' and ')}`);
    if (note) reasons.unshift(note);
    if (r.tier) reasons.push(`Community tier ${r.tier}`);
    const score = 0.45 * tierValue + 0.45 * f + set + personal;
    return { id, name: aug.name, rarity: aug.rarity, icon: aug.icon, desc: merged.desc, score, tier: toTier(score), reasons };
  });
  const best = Math.max(...rated.map((r) => r.score));
  for (const r of rated) r.best = r.score === best && rated.length > 1;
  return rated;
}

module.exports = { rateOffer, augmentTags, fit, wants };
