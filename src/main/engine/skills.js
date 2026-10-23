// Skill order. Recorded games (HOWL logs your ability levels while you play)
// win when there are enough of them; otherwise the max order is estimated
// from the ability text: damaging, low-cooldown spells first, dashes and
// pure crowd control last.

const DASH = /\b(dash|blink|leap|jump|lunge|teleport)/;
const CC = /\b(stun|root|knock|suppress|fear|charm|taunt|sleep|polymorph)/;

function estimatePriority(champ, p) {
  const basics = champ.spells.slice(0, 3).map((s) => {
    const d = s.desc.toLowerCase();
    let score = 0;
    const reasons = [];
    if (/damag/.test(d)) { score += 3; reasons.push('deals damage'); }
    if (p.onHit && /attack speed/.test(d)) { score += 3; reasons.push('attack speed'); } else if (p.role === 'Marksman' && /attack speed/.test(d)) score += 2;
    if (p.role === 'Enchanter' && /(heal|shield)/.test(d)) { score += 3; reasons.push('heals or shields'); }
    if (p.role === 'Tank' && /(armor|magic resist|damage reduction)/.test(d)) score += 1;
    const cd = Array.isArray(s.cooldown) ? s.cooldown[0] : 10;
    if (cd <= 6) { score += 2; reasons.push('short cooldown'); } else if (cd <= 10) score += 1; else if (cd >= 18) score -= 1;
    if (DASH.test(d)) score -= 2;
    if (CC.test(d) && !/damag/.test(d)) score -= 1;
    score += { Q: 0.5, W: 0, E: 0.25 }[s.key];
    return { key: s.key, score, reasons };
  });
  return basics.sort((a, b) => b.score - a.score);
}

// Expands a max priority (e.g. Q > E > W) into one skill per level 1-18.
function expandOrder(priority, champ) {
  const maxRank = Object.fromEntries(champ.spells.map((s) => [s.key, s.maxrank]));
  const rank = { Q: 0, W: 0, E: 0, R: 0 };
  const rLevels = maxRank.R === 3 ? [6, 11, 16] : [6, 11, 16, 18].slice(0, maxRank.R || 3);
  const order = [];
  for (let level = 1; level <= 18; level++) {
    let pick = null;
    if (rLevels.includes(level) && rank.R < (maxRank.R || 3)) pick = 'R';
    else if (level <= 3) pick = priority.find((k) => rank[k] === 0) || priority[0];
    if (!pick || (pick !== 'R' && rank[pick] >= Math.ceil(level / 2))) {
      pick = priority.find((k) => rank[k] < maxRank[k] && rank[k] < Math.ceil(level / 2)) || 'R';
    }
    rank[pick]++;
    order.push(pick);
  }
  return order;
}

// recorded: your Mayhem games { games, priorities: { "QEW": count } } or null
// global: ARAM games from Riot's API { realGames, skills: { "QEW": count } } or null
function recommend({ champ, profile, recorded = null, global = null }) {
  let priority;
  let source;
  let reasons = {};
  const top = recorded && Object.entries(recorded.priorities).sort((a, b) => b[1] - a[1])[0];
  const gTotal = global ? Object.values(global.skills).reduce((a, b) => a + b, 0) : 0;
  const gTop = gTotal && Object.entries(global.skills).sort((a, b) => b[1] - a[1])[0];
  if (top && recorded.games >= 3 && top[1] / recorded.games >= 0.4) {
    priority = top[0].split('');
    source = `Most common in your ${recorded.games} recorded games`;
  } else if (gTop && global.realGames >= 5 && gTop[1] / gTotal >= 0.35) {
    priority = gTop[0].split('');
    source = `Most common in ${global.realGames} ARAM games (${Math.round((100 * gTop[1]) / gTotal)}% of them)`;
  } else {
    const est = estimatePriority(champ, profile);
    priority = est.map((e) => e.key);
    reasons = Object.fromEntries(est.map((e) => [e.key, e.reasons]));
    source = 'Estimated from ability text';
  }
  const names = Object.fromEntries(champ.spells.map((s) => [s.key, { name: s.name, icon: s.icon }]));
  return { priority, order: expandOrder(priority, champ), source, reasons, spells: names };
}

// Which skill to level now, given current ability ranks and champion level.
function nextSkill(order, ranks, level) {
  const spent = ['Q', 'W', 'E', 'R'].reduce((s, k) => s + (ranks[k] || 0), 0);
  if (spent >= level) return null;
  const want = { Q: 0, W: 0, E: 0, R: 0 };
  for (let i = 0; i < level; i++) {
    want[order[i]]++;
    const k = order[i];
    if (want[k] > (ranks[k] || 0)) return k;
  }
  return null;
}

// "QEW" from a sequence of skill level-ups (first ability to reach 5 first).
function priorityFromSequence(seq) {
  const rank = { Q: 0, W: 0, E: 0 };
  const done = [];
  for (const k of seq) {
    if (!(k in rank)) continue;
    rank[k]++;
    if (rank[k] === 5) done.push(k);
  }
  const rest = ['Q', 'W', 'E'].filter((k) => !done.includes(k)).sort((a, b) => rank[b] - rank[a]);
  return [...done, ...rest].join('');
}

module.exports = { recommend, expandOrder, estimatePriority, nextSkill, priorityFromSequence };
