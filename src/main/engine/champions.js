// Champion select ratings: community Mayhem tier, your own results on the
// champion, and what the team composition is missing.
const { profile } = require('./profile');

const TIER_VALUE = { S: 1, A: 0.8, B: 0.6, C: 0.4, D: 0.2 };
const toTier = (v) => (v >= 0.8 ? 'S' : v >= 0.66 ? 'A' : v >= 0.5 ? 'B' : v >= 0.36 ? 'C' : 'D');

function teamNeeds(teamProfiles) {
  const ap = teamProfiles.filter((t) => t.damage === 'ap').length;
  const ad = teamProfiles.filter((t) => t.damage === 'ad').length;
  return {
    frontline: !teamProfiles.some((t) => t.role === 'Tank' || (t.role === 'Fighter' && t.tanky)),
    magic: teamProfiles.length >= 2 && ap === 0,
    physical: teamProfiles.length >= 2 && ad === 0,
    peel: !teamProfiles.some((t) => t.healsAllies),
  };
}

// candidates: champion ids you can end up on (yours, bench, teammates' for trades)
// team: champion ids of the other four teammates
// personal: { [championId]: { games, wins } }
function rate({ data, community = {}, candidates, team = [], personal = {} }) {
  const tiers = community.champions || {};
  return candidates.map((id) => {
    const champ = data.champions[id];
    if (!champ) return null;
    const p = profile(champ);
    const others = team.filter((t) => t !== id).map((t) => data.champions[t]).filter(Boolean).map(profile);
    const needs = teamNeeds(others);
    const reasons = [];
    const base = TIER_VALUE[tiers[champ.name]] ?? 0.5;
    if (tiers[champ.name]) reasons.push(`Community tier ${tiers[champ.name]}`);
    let comp = 0;
    if (needs.frontline && (p.role === 'Tank' || p.tanky)) { comp += 0.1; reasons.push('Team has no frontline'); }
    if (needs.magic && p.damage === 'ap') { comp += 0.08; reasons.push('Team needs magic damage'); }
    if (needs.physical && p.damage === 'ad') { comp += 0.08; reasons.push('Team needs physical damage'); }
    if (needs.peel && p.healsAllies) { comp += 0.05; reasons.push('Team has no healer or shielder'); }
    const mine = personal[id];
    let you = 0;
    if (mine && mine.games >= 2) {
      you = ((mine.wins + 2) / (mine.games + 4) - 0.5) * 0.4;
      reasons.push(`You: ${mine.wins}W ${mine.games - mine.wins}L`);
    }
    const score = base * 0.8 + comp + you + 0.1;
    return { id, name: champ.name, icon: champ.icon, role: p.role, damage: p.damage, score, tier: toTier(score), reasons };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

module.exports = { rate, teamNeeds };
