/* global ui */
const $ = (sel) => document.querySelector(sel);
const { esc } = ui;
let state = null;
let settings = {};
let currentTab = 'live';

// ---------- shell ----------
$('#brand').innerHTML = `${ui.logo()}<div><div class="wordmark">HOWL</div><div class="tagline">ARAM: Mayhem companion</div></div>`;
document.querySelectorAll('#tabs button').forEach((b) => {
  b.innerHTML = `${ui.svg(b.dataset.icon)}<span>${esc(b.textContent)}</span>`;
  b.title = b.textContent;
  b.addEventListener('click', () => showTab(b.dataset.tab));
});
function showTab(name) {
  currentTab = name;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  ({ live: renderLive, builds: renderBuilds, augments: renderAugments, stats: renderStats, settings: renderSettings })[name]();
}

const DMG = { ap: 'AP', ad: 'AD', mixed: 'Hybrid' };
const PHASES = {
  None: 'Idle', Lobby: 'In lobby', Matchmaking: 'In queue', ReadyCheck: 'Queue pop', ChampSelect: 'Champ select',
  GameStart: 'Loading', InProgress: 'In game', WaitingForStats: 'Game over', PreEndOfGame: 'Game over', EndOfGame: 'Post-game',
};

function renderStatus() {
  const c = state?.client;
  $('#status').innerHTML = `
    <span class="who"><span class="dot ${c?.connected ? 'on' : ''}"></span>${c?.connected ? esc(c.summoner?.name) : 'League not running'}</span>
    ${c?.connected ? `<span class="chip">${esc(PHASES[state.phase] || state.phase)}${state.isMayhem ? ' · Mayhem' : ''}</span>` : ''}
    <span class="chip">Patch ${esc(state?.data?.version || '...')}</span>
    ${keyExpired ? `<button class="chip expired" id="keyChip" title="Paste a new Riot API key in Settings">${ui.svg('alert')} Riot key expired</button>` : ''}`;
  $('#keyChip')?.addEventListener('click', () => showTab('settings'));
}

// A rejected key shows in the top bar until a new one is saved.
let keyExpired = false;
const watchKey = (s) => {
  const now = !!(s && !s.shared && s.error && /rejected/i.test(s.error));
  if (now !== keyExpired) { keyExpired = now; renderStatus(); }
};
window.howl.onAram(watchKey);
window.howl.aramStatus().then(watchKey);
window.howl.onOpenTab((name) => showTab(name));

// ---------- toasts ----------
window.howl.onToast(({ text, kind }) => {
  const box = $('#toasts');
  const icon = kind === 'busy' ? 'sync' : kind === 'good' ? 'check' : kind === 'bad' ? 'alert' : 'scan';
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${ui.svg(icon)}<span>${esc(text)}</span>`;
  box.querySelectorAll('.toast.busy').forEach((t) => t.remove());
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, kind === 'busy' ? 6000 : 3200);
});

// ---------- shared pieces ----------
function itemCell(it, cls = '') {
  return `<div class="item ${cls}">${ui.icon(it.icon, it.name)}<span>${esc(it.name)}</span></div>`;
}

function hero({ champ, sub = '', actions = '', extra = '' }) {
  const splash = ui.splash(champ.icon);
  return `<div class="hero" style="${splash ? `--splash:url('${splash}')` : ''}">
    ${ui.icon(champ.icon, champ.name, 'portrait')}
    <div><div class="name">${esc(champ.name)} ${extra}</div><div class="sub">${sub}</div></div>
    ${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

function priority(skills) {
  return `<span class="priority">${skills.priority.map((k) => ui.key(k)).join('<span class="sep">›</span>')}</span>`;
}

function planView(plan, { owned = [], level = 0 } = {}) {
  if (!plan) return '';
  const own = new Set(owned);
  const build = plan.items.build.map((it) => itemCell(it, own.has(it.id) ? 'owned' : '')).join('');
  const sit = plan.items.situational.map((it) => `
    <div class="list-row">${ui.icon(it.icon, it.name)}<div><div class="title">${esc(it.name)}</div><div class="chips">${ui.chips(it.reasons.slice(0, 2))}</div></div></div>`).join('');
  const sp = plan.spells;
  return `
    <div class="grid cols-2">
      <div class="card">
        <h3>${ui.svg('builds')} Build, in buy order</h3>
        <div class="build numbered">${build}</div>
        <p class="note">${esc(plan.items.source)}</p>
        ${sit ? `<h3 class="section-gap">Situational</h3><div class="list-rows">${sit}</div>` : ''}
      </div>
      <div class="card">
        <h3>${ui.svg('stats')} Skill order ${priority(plan.skills)}</h3>
        ${ui.skillGrid(plan.skills, level)}
        <p class="note">${esc(plan.skills.source)}</p>
        ${sp ? `<h3 class="section-gap">Summoner spells</h3>
          <div class="row">${sp.list.map((s) => ui.icon(s.icon, s.name)).join('')}
          <span class="muted small">${esc(sp.list.map((s) => s.name).join(' + '))} · most used ${sp.champSpecific ? 'on this champion' : 'in recorded Mayhem games'} (${sp.games})</span></div>` : ''}
      </div>
    </div>`;
}

function augmentCard(a) {
  return `<div class="aug ${a.best ? 'best' : ''}">
    ${ui.icon(a.icon, a.name, `rar rar-${a.rarity}`)}
    <div><div class="name">${ui.tier(a.tier)} ${esc(a.name)} ${a.best ? '<span class="tag gold">Best pick</span>' : ''}</div>
    <div class="desc">${esc(a.desc || 'No description available.')}</div>
    ${a.reasons?.length ? `<div class="chips">${ui.chips(a.reasons.slice(0, 3))}</div>` : ''}</div>
  </div>`;
}

function empty(title, text, extra = '') {
  return `<div class="empty">${ui.logo()}<div class="big">${title}</div><p>${text}</p>${extra}</div>`;
}

// ---------- live ----------
function renderLive() {
  const el = $('#tab-live');
  if (!state) { el.innerHTML = empty('Starting up', 'Loading champions, items and the Mayhem augment pool.'); return; }
  if (!state.client.connected) {
    el.innerHTML = empty('Waiting for League of Legends', 'Open the League client and HOWL connects on its own.',
      `<div class="steps"><span class="chip">${ui.keys(settings.hotkeyOverlay || 'Control+Shift+H')} overlay</span><span class="chip">${ui.keys(settings.hotkeyScan || 'Control+Shift+J')} rescan augments</span></div>`) + lastGameCard();
    return;
  }
  if (state.game) { el.innerHTML = gameView(state.game); return; }
  if (state.champSelect) { el.innerHTML = champSelectView(state.champSelect); bindChampSelect(); return; }
  const queued = state.isMayhem && ['Matchmaking', 'ReadyCheck'].includes(state.phase);
  el.innerHTML = empty(queued ? 'Queued for ARAM: Mayhem' : 'Ready when you are',
    'Champ select ratings, build import and the in-game overlay start on their own when you play ARAM: Mayhem.',
    state.party.length ? `<div class="steps"><span class="chip">Party: ${state.party.map((p) => esc(p.name)).join(', ')}</span></div>` : '') + lastGameCard();
}

function champSelectView(cs) {
  const best = cs.ratings[0];
  const opts = cs.ratings.map((r) => `
    <div class="opt ${r === best && cs.ratings.length > 1 ? 'best' : ''} ${r.mine ? 'mine' : ''}">
      ${ui.icon(r.icon, r.name, 'lg')}
      <div class="meta">
        <div class="title">${ui.tier(r.tier)} ${esc(r.name)}
          ${r.mine ? '<span class="tag">You</span>' : r.bench ? '<span class="tag">Bench</span>' : '<span class="tag">Teammate</span>'}
          ${r === best && cs.ratings.length > 1 ? '<span class="tag gold">Best option</span>' : ''}</div>
        <div class="muted small">${esc(r.role)} · ${DMG[r.damage]}</div>
        <div class="reasons">${ui.chips(r.reasons.slice(0, 3))}</div>
      </div>
    </div>`).join('');
  const mates = cs.teammates.map((t) => `<div class="mate">${ui.icon(t.icon, t.name, 'sm')} <span>${esc(t.name || 'Picking...')}</span>
    ${t.party ? '<span class="tag">Party</span>' : ''}${t.playedWith ? `<span class="chip">Played together ${t.playedWith}x</span>` : ''}</div>`).join('');
  const p = cs.plan;
  return `
    ${p ? hero({
      champ: p.champ,
      sub: `<span>${esc(p.champ.role)} · ${DMG[p.champ.damage]}</span>${cs.imported ? `<span class="ok">${ui.svg('check')} Item set imported</span>` : ''}`,
      actions: `<button class="btn primary" id="import">${cs.imported ? 'Re-import build' : 'Import item set'}</button>${p.spells ? '<button class="btn" id="spells">Set spells</button>' : ''}`,
    }) : ''}
    <div class="card"><h3>${ui.svg('live')} Your options: reroll, bench and trades</h3><div class="options">${opts}</div></div>
    ${planView(p)}
    ${mates ? `<div class="card"><h3>Teammates</h3><div class="mates">${mates}</div></div>` : ''}`;
}

function bindChampSelect() {
  $('#import')?.addEventListener('click', async (e) => { e.currentTarget.disabled = true; await window.howl.importBuild(); });
  $('#spells')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    await window.howl.applySpells();
    b.innerHTML = `${ui.svg('check')} Spells set`;
  });
}

function gameView(g) {
  const clock = `${Math.floor(g.time / 60)}:${String(Math.floor(g.time % 60)).padStart(2, '0')}`;
  const aug = g.augments.offer.length ? `<div class="card"><h3>${ui.svg('augments')} Augment offer</h3>
    <div class="aug-list">${g.augments.offer.map(augmentCard).join('')}</div></div>` : '';
  const next = g.items.next.map((it) => `
    <div class="list-row">${ui.icon(it.icon, it.name, 'lg')}<div><div class="title">${esc(it.name)} <span class="muted small">${it.gold} g</span></div>
    <div class="chips">${ui.chips(it.reasons.slice(0, 2))}</div></div></div>`).join('');
  return `
    ${hero({
      champ: g.champ,
      sub: `<span>Level ${g.level}</span><span>${g.gold} gold</span><span>${clock}</span>${g.augments.picked.length ? `<span>${g.augments.picked.length} augment${g.augments.picked.length > 1 ? 's' : ''} taken</span>` : ''}`,
      actions: `${g.nextSkill ? `<span class="levelup">Level up ${ui.key(g.nextSkill, true)}</span>` : ''}
        <span class="chip ${g.teamGold.diff >= 0 ? 'good' : ''}">Team item gold ${ui.money(g.teamGold.diff)}</span>
        <button class="btn small" id="rescan">${ui.svg('scan')} Rescan augments</button>`,
    })}
    ${aug}
    <div class="card next"><h3>${ui.svg('builds')} Next buy</h3><div class="list-rows">${next}</div></div>
    ${planView({ items: g.items, skills: g.skills, spells: null }, { owned: g.owned, level: g.level })}
    <p class="muted small">Enemy team: ${g.enemies.map((e) => esc(e.name)).join(', ')}</p>`;
}
document.addEventListener('click', (e) => { if (e.target.closest('#rescan')) window.howl.scan(); });

function lastGameCard() {
  const lg = state?.lastGame;
  if (!lg) return '';
  return `<div class="card review">
    <h3>${ui.svg('stats')} Last game review</h3>
    <div class="game ${lg.win ? 'win' : ''}">${ui.icon(lg.icon, lg.champ, 'lg')}<div class="res">${lg.win ? 'Victory' : 'Defeat'}</div>
      <div class="who-cell"><div>${esc(lg.champ)} · ${esc(lg.kda)}</div><div class="muted small">${lg.dmg?.toLocaleString()} damage, ${lg.teamDamageShare}% of team</div></div>
      <div class="mini">${lg.augments.map((a) => ui.icon(a.icon, a.name, `rar rar-${a.rarity}`)).join('')}</div><span class="spacer"></span><span></span></div>
    <div class="compare"><span class="muted small">You built</span><div class="build">${lg.items.map((it) => itemCell(it, it.suggested ? 'suggested' : '')).join('')}</div></div>
    <div class="compare"><span class="muted small">HOWL build</span><div class="build numbered">${lg.suggestedBuild.map((it) => itemCell(it)).join('')}</div></div>
    <p class="note">${lg.matched} of your ${lg.total} finished items matched the HOWL build for that matchup.</p>
  </div>`;
}

// ---------- builds ----------
let champList = null;
let pickedChamp = null;
async function renderBuilds() {
  const el = $('#tab-builds');
  champList ||= await window.howl.champions();
  if (!el.dataset.ready) {
    el.dataset.ready = '1';
    el.innerHTML = `<div class="browser">
      <div class="card picker"><input type="search" id="champSearch" placeholder="Search ${champList.length} champions"><div class="champs" id="champGrid"></div></div>
      <div class="stack" id="champPlan">${empty('Pick a champion', 'See the build in buy order, the skill order and the augments that fit.')}</div></div>`;
    $('#champSearch').addEventListener('input', drawChampGrid);
  }
  drawChampGrid();
  if (pickedChamp) showChampPlan(pickedChamp);
}

function drawChampGrid() {
  const q = ($('#champSearch')?.value || '').toLowerCase();
  const list = [...champList].sort((a, b) => a.name.localeCompare(b.name)).filter((c) => c.name.toLowerCase().includes(q));
  $('#champGrid').innerHTML = list.map((c) => `<button class="champ ${c.id === pickedChamp ? 'on' : ''}" data-id="${c.id}" title="${esc(c.name)}">${ui.icon(c.icon, c.name)}${ui.tier(c.tier)}<span>${esc(c.name)}</span></button>`).join('')
    || '<p class="muted small">No champion matches.</p>';
  $('#champGrid').querySelectorAll('.champ').forEach((b) => b.addEventListener('click', () => showChampPlan(Number(b.dataset.id))));
}

let poolCache = null;
async function showChampPlan(id) {
  pickedChamp = id;
  document.querySelectorAll('.champ').forEach((b) => b.classList.toggle('on', Number(b.dataset.id) === id));
  const plan = await window.howl.plan(id);
  poolCache ||= await window.howl.augments();
  const rated = await window.howl.rateAugments(id, poolCache.map((a) => a.id));
  const top = rated.sort((a, b) => b.score - a.score).slice(0, 12).map((a) => ({ ...a, best: false }));
  const c = champList.find((x) => x.id === id);
  $('#champPlan').innerHTML = `
    ${hero({ champ: plan.champ, extra: ui.tier(c?.tier), sub: `<span>${esc(plan.champ.role)} · ${DMG[plan.champ.damage]}</span>${ui.chips(c?.reasons)}` })}
    ${planView(plan)}
    <div class="card"><h3>${ui.svg('augments')} Augments to look for</h3><div class="aug-list">${top.map(augmentCard).join('')}</div></div>`;
  if (window.innerWidth < 900) $('#champPlan').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- augments ----------
const augFilter = { q: '', rarity: 'all', sort: 'tier' };
async function renderAugments() {
  const el = $('#tab-augments');
  poolCache ||= await window.howl.augments();
  if (!el.dataset.ready) {
    el.dataset.ready = '1';
    const src = await window.howl.community();
    el.innerHTML = `<div class="card"><div class="filters">
        <input type="search" id="augSearch" placeholder="Search ${poolCache.length} augments by name or effect">
        <div class="segmented" id="rarity">${['all', 'silver', 'gold', 'prismatic'].map((r) => `<button class="${r === 'all' ? 'on' : ''}" data-r="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}</div>
        <select id="augSort"><option value="tier">Sort by tier</option><option value="name">Sort by name</option></select>
      </div><p class="note">Tiers compiled ${esc(src.compiledAt || '')} from ${src.sources.length} public sources. No win rates: Riot's policy does not allow them for augments.</p></div>
      <div class="aug-list" id="augList"></div>`;
    $('#augSearch').addEventListener('input', (e) => { augFilter.q = e.target.value.toLowerCase(); drawAugments(); });
    $('#augSort').addEventListener('change', (e) => { augFilter.sort = e.target.value; drawAugments(); });
    el.querySelectorAll('#rarity button').forEach((b) => b.addEventListener('click', () => {
      augFilter.rarity = b.dataset.r;
      el.querySelectorAll('#rarity button').forEach((x) => x.classList.toggle('on', x === b));
      drawAugments();
    }));
  }
  drawAugments();
}

function drawAugments() {
  const order = { S: 0, A: 1, B: 2, C: 3, D: 4 };
  const list = poolCache
    .filter((a) => a.name && (augFilter.rarity === 'all' || a.rarity === augFilter.rarity))
    .filter((a) => !augFilter.q || a.name.toLowerCase().includes(augFilter.q) || a.desc.toLowerCase().includes(augFilter.q))
    .sort((a, b) => (augFilter.sort === 'name' ? a.name.localeCompare(b.name) : (order[a.tier] ?? 9) - (order[b.tier] ?? 9) || a.name.localeCompare(b.name)));
  $('#augList').innerHTML = list.map(augmentCard).join('') || '<p class="muted">No augments match.</p>';
}

// ---------- stats ----------
function renderStats() {
  const el = $('#tab-stats');
  const s = state?.stats;
  if (!s) { el.innerHTML = ''; return; }
  const wr = s.myGames ? Math.round((100 * s.myWins) / s.myGames) : 0;
  const champRows = s.champs.map((c) => `<div class="trow">${ui.icon(c.icon, c.name, 'sm')}
    <div><div class="name">${esc(c.name)}</div><div class="bar"><i style="width:${Math.round((100 * c.wins) / c.games)}%"></i></div></div>
    <div class="num">${c.wins}W ${c.games - c.wins}L</div></div>`).join('');
  const augRows = s.augments.map((a) => `<div class="trow">${ui.icon(a.icon, a.name, `sm rar rar-${a.rarity}`)}
    <div class="name">${esc(a.name)}</div><div class="num">${a.picks}x</div></div>`).join('');
  el.innerHTML = `
    <div class="page-head"><h2>Your ARAM: Mayhem record</h2><span class="spacer"></span>
      <button class="btn" id="syncBtn">${ui.svg('sync')} Sync match history</button></div>
    <div class="kpis">
      <div class="card kpi"><div class="v">${s.myGames}</div><div class="l">Your recorded games</div></div>
      <div class="card kpi"><div class="v"><span class="w">${s.myWins}W</span> <span class="ls">${s.myGames - s.myWins}L</span></div><div class="l">${wr}% of games won</div></div>
      <div class="card kpi"><div class="v">${s.champs.length}</div><div class="l">Champions played</div></div>
      <div class="card kpi"><div class="v">${(s.totalGames * 10).toLocaleString()}</div><div class="l">Player builds HOWL learned from</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Champions</h3><div class="table">${champRows || '<p class="muted small">No games yet.</p>'}</div></div>
      <div class="card"><h3>Augments you pick most</h3><div class="table">${augRows || '<p class="muted small">No games yet.</p>'}</div>
        <p class="note">Augment win rates are not shown: Riot's developer policy does not allow apps to display them.</p></div>
    </div>
    <div class="card games"><h3>Recent games</h3>
      ${s.recent.map((g) => `<div class="game ${g.win ? 'win' : ''}">${ui.icon(g.icon, g.champ)}<div class="res">${g.win ? 'Win' : 'Loss'}</div>
        <div class="who-cell"><div>${esc(g.champ)}</div><div class="muted small">${esc(g.kda)} · ${ui.ago(g.created)}</div></div>
        <div class="mini">${g.augments.map((a) => ui.icon(a.icon, a.name, `rar rar-${a.rarity}`)).join('')}</div>
        <span class="spacer"></span><div class="mini">${g.items.map((it) => ui.icon(it.icon, it.name)).join('')}</div></div>`).join('') || '<p class="muted">No Mayhem games recorded yet.</p>'}
    </div>`;
  $('#syncBtn').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.innerHTML = `${ui.svg('sync')} Syncing...`;
    await window.howl.sync();
    b.disabled = false;
    b.innerHTML = `${ui.svg('sync')} Sync match history`;
  });
}

// ---------- settings ----------
const SETTINGS = [
  ['autoImport', 'Import item sets automatically', 'In champ select, HOWL writes its build into the client (shop › item sets).'],
  ['overlay', 'In-game overlay', 'Skill order, next items and augment ratings on top of the game. League must be borderless or windowed.'],
  ['augmentReader', 'Read augment cards', 'Reads the offered augment names from your screen with Windows text recognition. Nothing touches game files or memory.'],
  ['showGold', 'Team item gold difference', 'How far ahead or behind your team is in item gold, from the visible scoreboard items.'],
  ['autoAccept', 'Auto accept queue', 'Accepts the ready check for you.'],
];
const HOTKEYS = [
  ['hotkeyOverlay', 'Show or hide the overlay'],
  ['hotkeyScan', 'Read the augment cards now'],
];

async function renderSettings() {
  settings = await window.howl.settings();
  const logs = await window.howl.logs();
  const src = await window.howl.community();
  const hk = settings.hotkeyStatus || {};
  $('#tab-settings').innerHTML = `
    <div class="card">
      <h3>${ui.svg('key')} ARAM build stats</h3>
      <p class="small">Riot keeps Mayhem games private, but regular ARAM games are public. With a Riot API key, HOWL collects recent ARAM matches on the same map
        and builds from what real players buy and level. <b>No key? Nothing to do:</b> HOWL downloads the shared stats instead.
        Keys come from <a href="#" data-url="https://developer.riotgames.com">developer.riotgames.com</a>.</p>
      <div class="key-field">
        <input type="password" id="apiKey" autocomplete="off" spellcheck="false" placeholder="${settings.riotApiKeySet ? `Key saved (ends in ${esc(settings.riotApiKeyHint)}). Paste a new one to replace it` : 'Paste your key: RGAPI-...'}">
        <button class="btn primary" id="saveKey">Save key</button>
        ${settings.riotApiKeySet ? '<button class="btn" id="clearKey">Remove</button>' : ''}
        <select id="route" title="Riot API region">
          <option value="auto">Region: from League client</option><option value="europe">Europe</option>
          <option value="americas">Americas</option><option value="asia">Asia</option><option value="sea">SEA / Oceania</option>
        </select>
      </div>
      <div class="row section-gap">
        <button class="btn small" id="aramRun">${ui.svg('sync')} Collect now</button>
        <button class="btn small" id="aramStop">Stop</button>
        <span class="spacer small" id="aramStatus"></span>
      </div>
      <div class="setting"><div class="text"><div class="t">Collect in the background</div><div class="d">Runs at startup and every few hours while a key is saved.</div></div>
        <button class="switch ${settings.aramAuto ? 'on' : ''}" data-k="aramAuto" aria-label="Collect in the background"></button></div>
      ${settings.canPublish ? `<div class="setting"><div class="text"><div class="t">Publish for friends</div><div class="d">After each run, push the stats (counts only, never the key) to the HOWL repository.</div></div>
        <button class="switch ${settings.autoPublish ? 'on' : ''}" data-k="autoPublish" aria-label="Publish stats for friends"></button></div>` : ''}
    </div>
    <div class="grid cols-2">
      <div class="card">
        <h3>${ui.svg('settings')} Features</h3>
        ${SETTINGS.map(([k, t, d]) => `<div class="setting"><div class="text"><div class="t">${t}</div><div class="d">${d}</div></div>
          <button class="switch ${settings[k] ? 'on' : ''}" data-k="${k}" aria-label="${t}"></button></div>`).join('')}
        <h3 class="section-gap">Overlay look</h3>
        <div class="setting"><div class="text"><div class="t">Position</div></div>
          <select id="pos"><option value="right-middle">Right, middle</option><option value="right-top">Right, top</option>
          <option value="left-middle">Left, middle</option><option value="left-top">Left, top</option></select></div>
        <div class="setting"><div class="text"><div class="t">Size</div><div class="d">Also follows your screen resolution on its own.</div></div>
          <div class="segmented" id="size">${[['0.75', 'Small'], ['0.9', 'Medium'], ['1.05', 'Large']].map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div></div>
        <div class="setting"><div class="text"><div class="t">Opacity</div><div class="d" id="opacityLabel"></div></div>
          <input type="range" id="opacity" min="0.3" max="1" step="0.05"></div>
      </div>
      <div class="stack">
        <div class="card">
          <h3>${ui.svg('key')} Hotkeys</h3>
          ${HOTKEYS.map(([k, label]) => `<div class="setting"><div class="text"><div class="t">${label}</div>
              <div class="d inline-msg" id="msg-${k}">${hk[k] === false ? '<span class="bad">Taken by another app, pick a different one.</span>' : 'Works anywhere, even in game.'}</div></div>
            <div class="keyrow"><span class="state-dot ${hk[k] === false ? 'off' : ''}"></span><span class="combo" id="combo-${k}">${ui.keys(settings[k])}</span>
            <button class="btn small" data-hotkey="${k}">Change</button></div></div>`).join('')}
        </div>
        <div class="card">
          <h3>Data</h3>
          <p class="small">Champions, items and the Mayhem augment pool come from Riot's game data (Data Dragon, CommunityDragon) and update each patch.
          Community tiers compiled ${esc(src.compiledAt || 'n/a')} from:</p>
          <ul class="sources">${src.sources.map((s) => `<li><a href="#" data-url="${esc(s.url)}">${esc(s.id)}</a> <span class="faint">${esc(s.patchOrDate)}</span></li>`).join('')}</ul>
          <h3>Activity</h3><div class="log" id="log">${logs.map(esc).join('\n')}</div>
          <p class="legal">HOWL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>
        </div>
      </div>
    </div>`;

  $('#pos').value = settings.overlayPosition || 'right-middle';
  $('#pos').addEventListener('change', (e) => window.howl.setSettings({ overlayPosition: e.target.value }));
  const sizes = [...document.querySelectorAll('#size button')];
  const nearest = sizes.reduce((a, b) => (Math.abs(b.dataset.v - settings.overlayScale) < Math.abs(a.dataset.v - settings.overlayScale) ? b : a));
  nearest.classList.add('on');
  sizes.forEach((b) => b.addEventListener('click', () => {
    sizes.forEach((x) => x.classList.toggle('on', x === b));
    window.howl.setSettings({ overlayScale: Number(b.dataset.v) });
  }));
  const showOpacity = (v) => { $('#opacityLabel').textContent = `${Math.round(v * 100)}%`; };
  $('#opacity').value = settings.overlayOpacity ?? 0.85;
  showOpacity($('#opacity').value);
  $('#opacity').addEventListener('input', (e) => { showOpacity(e.target.value); window.howl.setSettings({ overlayOpacity: Number(e.target.value) }); });
  document.querySelectorAll('.switch').forEach((b) => b.addEventListener('click', async () => {
    settings = await window.howl.setSettings({ [b.dataset.k]: !settings[b.dataset.k] });
    b.classList.toggle('on', !!settings[b.dataset.k]);
  }));
  document.querySelectorAll('[data-url]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.howl.open(a.dataset.url); }));
  document.querySelectorAll('[data-hotkey]').forEach((b) => b.addEventListener('click', () => captureHotkey(b.dataset.hotkey, b)));

  $('#route').value = settings.riotRoute || 'auto';
  $('#route').addEventListener('change', (e) => window.howl.setSettings({ riotRoute: e.target.value }));
  $('#saveKey').addEventListener('click', async () => {
    const key = $('#apiKey').value.trim();
    if (!key) return;
    $('#apiKey').value = '';
    await window.howl.setSettings({ riotApiKey: key });
    renderSettings();
  });
  $('#clearKey')?.addEventListener('click', async () => { await window.howl.setSettings({ riotApiKey: '' }); renderSettings(); });
  $('#aramRun').addEventListener('click', () => window.howl.aramRun());
  $('#aramStop').addEventListener('click', () => window.howl.aramStop());
  drawAramStatus(await window.howl.aramStatus());
}

// "Change" listens for the next key combination (with Ctrl, Alt or Shift,
// or an F key on its own) and asks the app to register it.
const KEY_NAMES = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' };
function captureHotkey(name, button) {
  const combo = $(`#combo-${name}`);
  const msg = $(`#msg-${name}`);
  combo.classList.add('listening');
  combo.innerHTML = '<kbd>Press keys…</kbd>';
  msg.innerHTML = 'Hold Ctrl, Alt or Shift and press a key. Esc cancels.';
  button.disabled = true;
  const done = () => { window.removeEventListener('keydown', onKey, true); button.disabled = false; };
  const onKey = async (e) => {
    e.preventDefault();
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape') { done(); renderSettings(); return; }
    const key = KEY_NAMES[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
    if (!mods.length && !/^F\d{1,2}$/.test(key)) { msg.innerHTML = '<span class="bad">Add Ctrl, Alt or Shift so normal typing is not affected.</span>'; return; }
    done();
    const accel = [...mods, key].join('+');
    const res = await window.howl.setSettings({ [name]: accel });
    await renderSettings();
    const m = $(`#msg-${name}`);
    if (res.hotkeyError) m.innerHTML = `<span class="bad">${esc(res.hotkeyError)}</span>`;
    else m.innerHTML = `<span class="ok">${ui.svg('check')} Saved, works right away.</span>`;
  };
  window.addEventListener('keydown', onKey, true);
}

function drawAramStatus(s) {
  const el = $('#aramStatus');
  if (!el || !s) return;
  const kept = s.patches.map((p) => `${p.matches} on ${p.patch}`).join(', ');
  if (s.shared) {
    el.innerHTML = s.shared.loaded
      ? `<span class="ok">${ui.svg('check')} Using shared stats</span> <span class="muted">${s.totalMatches} ARAM matches (${esc(kept)}), published ${esc(String(s.shared.publishedAt || '').slice(0, 10))}</span>`
      : '<span class="muted">No key: shared stats download when online</span>';
    $('#aramRun').disabled = true;
    $('#aramStop').disabled = true;
    return;
  }
  el.innerHTML = s.error ? `<span class="bad">${esc(s.error)}</span>`
    : s.running ? `<span class="muted">${esc(s.message || 'Working...')} · ${s.requests} requests</span>`
    : `<span class="muted">${s.totalMatches ? `${s.totalMatches} ARAM matches (${esc(kept)})` : 'No ARAM matches collected yet'}${s.message ? ` · ${esc(s.message)}` : ''}</span>`;
  $('#aramRun').disabled = s.running;
  $('#aramStop').disabled = !s.running;
}
window.howl.onAram(drawAramStatus);
window.howl.onSettings((s) => { settings = s; });

// ---------- boot ----------
window.howl.onState((s) => {
  const prevPhase = state?.phase;
  state = s;
  renderStatus();
  if (currentTab === 'live') renderLive();
  if (currentTab === 'stats' && prevPhase !== s.phase) renderStats();
});
window.howl.onLog((line) => { const l = $('#log'); if (l) { l.textContent += `\n${line}`; l.scrollTop = l.scrollHeight; } });
window.howl.settings().then((s) => { settings = s; });
window.howl.state().then((s) => { state = s; renderStatus(); renderLive(); });
