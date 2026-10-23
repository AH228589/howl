// What a champion wants: damage type, role and play pattern, read from the
// champion's tags, ratings and ability text. A few champions build against
// what their tags suggest, so those are corrected by hand below.

const OVERRIDES = {
  KogMaw: { onHit: true, damage: 'mixed' },
  Kayle: { onHit: true, damage: 'ap' },
  Varus: { onHit: true },
  Kalista: { onHit: true },
  Vayne: { onHit: true },
  Kaisa: { onHit: true, damage: 'mixed' },
  Gwen: { onHit: true, damage: 'ap' },
  Teemo: { onHit: true, damage: 'ap' },
  MasterYi: { onHit: true },
  Ezreal: { damage: 'ad', spellblade: true },
  Corki: { damage: 'ad' },
  Katarina: { damage: 'ap' },
  Akali: { damage: 'ap' },
  Mordekaiser: { damage: 'ap', role: 'Fighter' },
  Sylas: { damage: 'ap' },
  Gragas: { damage: 'ap' },
  Diana: { damage: 'ap' },
  Ekko: { damage: 'ap' },
  Fizz: { damage: 'ap' },
  Kennen: { damage: 'ap' },
  Rumble: { damage: 'ap' },
  Singed: { damage: 'ap', role: 'Tank' },
  Lillia: { damage: 'ap' },
  Elise: { damage: 'ap' },
  Nidalee: { damage: 'ap' },
};

const CC = /\b(stun|root|knock(s|ed)? (up|back|aside)|airborne|suppress|fear|charm|taunt|sleep|polymorph|slow)/g;

function profile(champ) {
  const o = OVERRIDES[champ.key] || {};
  const text = [champ.passive.desc, ...champ.spells.map((s) => s.desc)].join(' ').toLowerCase();
  const tags = champ.tags || [];
  const { attack = 5, magic = 5, defense = 5 } = champ.info || {};

  let damage = o.damage;
  if (!damage) {
    if (magic >= attack + 2) damage = 'ap';
    else if (attack >= magic + 2) damage = 'ad';
    else damage = tags[0] === 'Mage' ? 'ap' : tags[0] === 'Marksman' ? 'ad' : 'mixed';
  }

  const healsAllies = /(heal|shield)s?\b[^.]{0,40}\b(ally|allies|allied champion)/.test(text) ||
    /(ally|allies)[^.]{0,40}\b(heal|shield)/.test(text);
  const selfHeal = /(heals? (himself|herself|itself|for)|restores? [^.]{0,20}health|life ?steal|omnivamp|drain)/.test(text);

  let role = o.role || tags[0] || 'Fighter';
  if (role === 'Support' && tags.includes('Tank')) role = 'Tank';
  if (role === 'Support' && !healsAllies) role = tags[1] || 'Mage';
  if (role === 'Support') role = 'Enchanter';

  return {
    key: champ.key,
    name: champ.name,
    role, // Marksman | Mage | Assassin | Fighter | Tank | Enchanter
    damage, // ap | ad | mixed
    ranged: champ.range >= 300,
    mana: champ.partype === 'Mana',
    onHit: o.onHit ?? /on-hit/.test(text),
    crit: /critical strike/.test(text),
    spellblade: o.spellblade ?? false,
    healsAllies,
    healer: healsAllies || selfHeal,
    tanky: role === 'Tank' || defense >= 7,
    cc: (text.match(CC) || []).length,
  };
}

module.exports = { profile, OVERRIDES };
