/* global ui */
const { esc } = ui;
const panel = document.getElementById('panel');
const badges = document.getElementById('badges');
let settings = {};

function place() {
  const [side, row] = String(settings.overlayPosition || 'right-middle').split('-');
  panel.className = `${side === 'left' ? 'left' : 'right'} ${row === 'top' ? 'top' : 'middle'}`;
  panel.style.scale = String(settings.overlayScale || 0.9);
  panel.style.opacity = String(settings.overlayOpacity ?? 0.85);
}

function render(state) {
  const g = state?.game;
  if (!g) { panel.innerHTML = ''; badges.innerHTML = ''; return; }
  place();

  // Next six skill points from the current level.
  const start = Math.max(0, Math.min(g.level - 1, 12));
  const seq = g.skills.order.slice(start, start + 6)
    .map((k, i) => ui.key(k, start + i === g.level - 1 && g.nextSkill === k)).join('');
  const owned = new Set(g.owned);
  const next = g.items.next;
  const diff = g.teamGold.diff;

  panel.innerHTML = `
    <div class="line head">${ui.icon(g.champ.icon, g.champ.name, 'sm')}
      <span class="name">${esc(g.champ.name)}</span><span class="lvl">Lv ${g.level}</span>
      ${g.nextSkill ? `<span class="levelup">Level ${ui.key(g.nextSkill, true)}</span>` : ''}</div>
    <div class="line"><span class="lbl">Skills</span><div class="seq">${seq}</div></div>
    <div class="line next"><span class="lbl">Next</span>${next.map((it) => ui.icon(it.icon, `${it.name}${it.reasons[0] ? ` (${it.reasons[0]})` : ''}`, 'sm')).join('')}</div>
    ${next[0] ? `<div class="nextname">${esc(next[0].name)}${next[0].reasons[0] ? ` · ${esc(next[0].reasons[0])}` : ''}</div>` : ''}
    <div class="line"><span class="lbl">Build</span><div class="progress">${g.items.build.map((it) => ui.icon(it.icon, it.name, `sm${owned.has(it.id) ? ' have' : ''}`)).join('')}</div></div>
    ${settings.showGold ? `<div class="line gold"><span class="lbl">Gold</span><b class="${diff >= 0 ? 'up' : 'down'}">${ui.money(diff)}</b></div>` : ''}`;

  // Badges sit just above each card's name, in overlay window coordinates.
  badges.innerHTML = g.augments.offer.filter((a) => a.rect).map((a) => {
    const x = a.rect.x - window.screenX + a.rect.w / 2;
    const y = a.rect.y - window.screenY;
    return `<div class="badge ${a.best ? 'best' : ''}" style="left:${x}px;top:${y}px">
      ${a.best ? '<div class="pick">Best pick</div>' : ''}${ui.tier(a.tier)}
      <div class="why">${esc(a.reasons.slice(0, 2).join(' · '))}</div></div>`;
  }).join('');
}

window.howl.settings().then((s) => { settings = s; window.howl.state().then(render); });
window.howl.onSettings((s) => { settings = s; window.howl.state().then(render); });
window.howl.onState(render);
