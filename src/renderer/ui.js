// Small rendering helpers shared by the app window and the overlay.
(() => {
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  esc,
  icon(src, title = '', cls = '') {
    return src ? `<img class="icon ${cls}" src="${esc(src)}" title="${esc(title)}" alt="${esc(title)}" loading="lazy">` : `<span class="icon ${cls}"></span>`;
  },
  tier(t) { return `<span class="tier ${t || 'none'}">${t || '-'}</span>`; },
  chips(list, cls = '') { return (list || []).map((r) => `<span class="chip ${cls}">${esc(r)}</span>`).join(' '); },
  key(k, now = false) { return `<span class="key ${k}${now ? ' now' : ''}">${k}</span>`; },
  // 18-level skill grid: one row per ability, a mark on the level it is taken.
  skillGrid(skills, level = 0) {
    const rows = ['Q', 'W', 'E', 'R'].map((k) => {
      const cells = skills.order.map((s, i) =>
        `<td class="${s === k ? `on ${k}` : ''}${i < level ? ' past' : ''}">${s === k ? i + 1 : ''}</td>`).join('');
      const sp = skills.spells[k];
      return `<tr><th>${ui.icon(sp?.icon, sp?.name, 'sm')}${ui.key(k)}</th>${cells}</tr>`;
    }).join('');
    return `<table class="skillgrid">${rows}</table>`;
  },
  money(n) { return `${n < 0 ? '-' : '+'}${Math.abs(Math.round(n)).toLocaleString()}`; },
  ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
  },
};

window.ui = ui;
})();
