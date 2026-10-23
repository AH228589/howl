/* global ui */
const { esc } = ui;
const panel = document.getElementById('panel');
const badges = document.getElementById('badges');
const toastEl = document.getElementById('toast');
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
  const seq = g.skills.order.slice(start, start + 6).map((k, i) => `<div class="step"><span class="n">${start + i + 1}</span>
    ${ui.key(k, start + i === g.level - 1 && g.nextSkill === k)}</div>`).join('');
  const owned = new Set(g.owned);
  const next = g.items.next;
  const diff = g.teamGold.diff;
  const total = Math.max(1, Math.abs(diff) * 2 + 4000);
  const share = Math.round(50 + (50 * diff) / total);

  panel.innerHTML = `
    <div class="head">${ui.icon(g.champ.icon, g.champ.name)}
      <div><div class="name">${esc(g.champ.name)}</div><div class="lvl">Level ${g.level}</div></div>
      ${g.nextSkill ? `<div class="levelup">Level ${ui.key(g.nextSkill, true)}</div>` : ''}</div>
    <div class="line"><span class="lbl">Skills</span><div class="seq">${seq}</div></div>
    <div class="line"><span class="lbl">Next</span><div class="next-items">${next.map((it) => ui.icon(it.icon, `${it.name}${it.reasons[0] ? ` (${it.reasons[0]})` : ''}`)).join('')}</div>
      ${next[0] ? `<div class="nextname"><b>${esc(next[0].name)}</b>${next[0].reasons[0] ? ` · ${esc(next[0].reasons[0])}` : ''}</div>` : ''}</div>
    <div class="line"><span class="lbl">Build</span><div class="progress">${g.items.build.map((it) => `<span class="slot ${owned.has(it.id) ? 'have' : ''}">${ui.icon(it.icon, it.name)}</span>`).join('')}</div></div>
    ${settings.showGold ? `<div class="line"><span class="lbl">Gold</span><div class="gold-bar"><b class="${diff >= 0 ? 'up' : 'down'}">${ui.money(diff)}</b><span class="track"><i style="width:${share}%"></i></span></div></div>` : ''}`;

  // Badges sit just above each card's name, in overlay window coordinates.
  badges.innerHTML = g.augments.offer.filter((a) => a.rect).map((a) => {
    const x = a.rect.x - window.screenX + a.rect.w / 2;
    const y = a.rect.y - window.screenY;
    return `<div class="badge ${a.best ? 'best' : ''}" style="left:${x}px;top:${y}px">
      ${a.best ? '<div class="pick">Best pick</div>' : ''}${ui.tier(a.tier)}
      <div class="why">${esc(a.reasons.slice(0, 2).join(' · '))}</div></div>`;
  }).join('');
}

let toastTimer = null;
window.howl.onToast(({ text, kind }) => {
  const icon = kind === 'busy' ? 'sync' : kind === 'good' ? 'check' : kind === 'bad' ? 'alert' : 'scan';
  toastEl.className = `otoast show ${kind}`;
  toastEl.innerHTML = `${ui.svg(icon)}<span>${esc(text)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'otoast'; }, kind === 'busy' ? 8000 : 2500);
});

window.howl.settings().then((s) => { settings = s; window.howl.state().then(render); });
window.howl.onSettings((s) => { settings = s; window.howl.state().then(render); });
window.howl.onState(render);
