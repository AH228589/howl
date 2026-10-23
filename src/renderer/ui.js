// Small rendering helpers shared by the app window and the overlay.
(() => {
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Line icons (24 unit grid, drawn with currentColor).
const ICONS = {
  live: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4.5"/>',
  builds: '<path d="M4 20l7-7M14.5 4.5l5 5-8 8-5-5z"/>',
  augments: '<path d="M12 2l2.6 6.2L21 9l-5 4.4L17.5 20 12 16.7 6.5 20 8 13.4 3 9l6.4-.8z"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.7-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.7 4.3L20 15M20 20v-5h-5"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
};

const ui = {
  esc,
  svg(name, cls = '') {
    return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  },
  // HOWL mark: a moon over the abyss bridge.
  logo(cls = '') {
    return `<svg class="logo-mark ${cls}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9af0ff"/><stop offset="1" stop-color="#3fa9d6"/></linearGradient></defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0d1a26" stroke="url(#lg)" stroke-width="1.5"/>
      <circle cx="20" cy="11" r="5" fill="url(#lg)"/><circle cx="22.2" cy="9.6" r="4.2" fill="#0d1a26"/>
      <path d="M5 24c4-5 7-7 11-7s7 2 11 7" fill="none" stroke="url(#lg)" stroke-width="2" stroke-linecap="round"/></svg>`;
  },
  icon(src, title = '', cls = '') {
    return src ? `<img class="icon ${cls}" src="${esc(src)}" title="${esc(title)}" alt="${esc(title)}" loading="lazy">` : `<span class="icon ${cls}"></span>`;
  },
  // Champion splash art from Data Dragon, worked out from the square icon URL.
  splash(iconUrl) {
    const m = /\/cdn\/[^/]+\/img\/champion\/([^/.]+)\.png$/.exec(iconUrl || '');
    return m ? `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${m[1]}_0.jpg` : '';
  },
  tier(t) { return `<span class="tier ${t || 'none'}">${t || '-'}</span>`; },
  chips(list, cls = '') { return (list || []).map((r) => `<span class="chip ${cls}">${esc(r)}</span>`).join(' '); },
  key(k, now = false) { return `<span class="key ${k}${now ? ' now' : ''}">${k}</span>`; },
  // Accelerator text ("Control+Shift+J") as keyboard keys.
  keys(accel) {
    return String(accel || '').split('+').map((k) => `<kbd>${esc(k === 'Control' ? 'Ctrl' : k)}</kbd>`).join('<span class="plus">+</span>');
  },
  // 18-level skill grid: one row per ability, a mark on the level it is taken.
  skillGrid(skills, level = 0) {
    const head = `<tr><th></th>${skills.order.map((_, i) => `<td class="lv${i < level ? ' past' : ''}">${i + 1}</td>`).join('')}</tr>`;
    const rows = ['Q', 'W', 'E', 'R'].map((k) => {
      const cells = skills.order.map((s, i) =>
        `<td class="${s === k ? `on ${k}` : ''}${i < level ? ' past' : ''}">${s === k ? k : ''}</td>`).join('');
      const sp = skills.spells[k];
      return `<tr><th>${ui.icon(sp?.icon, sp?.name, 'sm')}${ui.key(k)}</th>${cells}</tr>`;
    }).join('');
    return `<div class="skillgrid-wrap"><table class="skillgrid">${head}${rows}</table></div>`;
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
