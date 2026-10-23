/* global ui */
const $ = (sel) => document.querySelector(sel);
const { esc } = ui;
let state = null;
let settings = {};
let currentTab = 'live';

// ---------- tabs ----------
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  currentTab = name;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  ({ live: renderLive, builds: renderBuilds, augments: renderAugments, stats: renderStats, settings: renderSettings })[name]();
}

// ---------- shared pieces ----------
const DMG = { ap: 'AP', ad: 'AD', mixed: 'Hybrid' };
const PHASES = {
  None: 'Idle', Lobby: 'In lobby', Matchmaking: 'In queue', ReadyCheck: 'Queue pop', ChampSelect: 'Champ select',
  GameStart: 'Loading', InProgress: 'In game', WaitingForStats: 'Game over', PreEndOfGame: 'Game over', EndOfGame: 'Post-game',
};

function renderStatus() {
  const c = state?.client;
  $('#status').innerHTML = `
    <span class="dot ${c?.connected ? 'on' : ''}"></span>
    <span>${c?.connected ? esc(c.summoner?.name) : 'League client not found'}</span>
    ${c?.connected ? `<span class="chip">${esc(PHASES[state.phase] || state.phase)}${state.isMayhem ? ' · Mayhem' : ''}</span>` : ''}
    <span class="chip">Patch ${esc(state?.data?.version || '...')}</span>`;
}

function itemCell(it, cls = '') {
  return `<div class="item ${cls}">${ui.icon(it.icon, it.name)}<span>${esc(it.name)}</span></div>`;
}

function planView(plan, { owned = [], level = 0 } = {}) {
  if (!plan) return '';
  const own = new Set(owned);
  const build = plan.items.build.map((it, i) => (i ? '<span class="arrow">›</span>' : '') + itemCell(it, own.has(it.id) ? 'owned' : '')).join('');
  const sit = plan.items.situational.map((it) => `
    <div class="sit-row">${ui.icon(it.icon, it.name)}<div><div>${esc(it.name)}</div><div>${ui.chips(it.reasons.slice(0, 2))}</div></div></div>`).join('');
  const sp = plan.spells;
  return `
    <div class="grid cols-2">
      <div class="card">
        <h3>Build</h3>
        <div class="build">${build}</div>
        <p class="muted small">${esc(plan.items.source)}</p>
        ${sit ? `<h3 style="margin-top:1rem">Situational</h3><div class="sit">${sit}</div>` : ''}
      </div>
      <div class="card">
        <h3>Skill order <span class="chip">${plan.skills.priority.map((k) => k).join(' › ')}</span></h3>
        ${ui.skillGrid(plan.skills, level)}
        <p class="muted small">${esc(plan.skills.source)}</p>
        ${sp ? `<h3 style="margin-top:1rem">Summoner spells</h3>
          <div class="row">${sp.list.map((s) => ui.icon(s.icon, s.name)).join('')}
          <span class="muted small">${esc(sp.list.map((s) => s.name).join(' + '))} · most used ${sp.champSpecific ? 'on this champion' : 'in recorded Mayhem games'} (${sp.games})</span></div>` : ''}
      </div>
    </div>`;
}

function augmentCard(a, extra = '') {
  return `<div class="aug">
    ${ui.icon(a.icon, a.name, `rar rar-${a.rarity}`)}
    <div><div class="name">${ui.tier(a.tier)} ${esc(a.name)} ${extra}</div>
    <div class="desc">${esc(a.desc || 'No description available.')}</div>
    ${a.reasons ? `<div class="row" style="margin-top:0.35rem">${ui.chips(a.reasons.slice(0, 3))}</div>` : ''}</div>
  </div>`;
}

// ---------- live ----------
function renderLive() {
  const el = $('#tab-live');
  if (!state) { el.innerHTML = '<div class="empty"><div class="big">Starting up...</div></div>'; return; }
  if (!state.client.connected) {
    el.innerHTML = `<div class="empty"><div class="big">Waiting for the League client</div>
      Open League of Legends and HOWL connects automatically.</div>${lastGameCard()}`;
    return;
  }
  if (state.game) { el.innerHTML = gameView(state.game); return; }
  if (state.champSelect) { el.innerHTML = champSelectView(state.champSelect); bindChampSelect(); return; }
  el.innerHTML = `<div class="empty"><div class="big">${state.isMayhem && ['Matchmaking', 'ReadyCheck'].includes(state.phase) ? 'Queued for ARAM: Mayhem' : 'Waiting for ARAM: Mayhem'}</div>
    Champ select tips, build import and the in-game overlay start on their own when you play Mayhem.
    ${state.party.length ? `<p>Party: ${state.party.map((p) => esc(p.name)).join(', ')}</p>` : ''}</div>${lastGameCard()}`;
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
  const mates = cs.teammates.map((t) => `<div class="row">${ui.icon(t.icon, t.name, 'sm')} ${esc(t.name || 'Picking...')}
    ${t.party ? '<span class="tag">Party</span>' : ''}${t.playedWith ? `<span class="chip">Played with you in ${t.playedWith} recorded game${t.playedWith > 1 ? 's' : ''}</span>` : ''}</div>`).join('');
  const p = cs.plan;
  return `
    ${p ? `<div class="hero">${ui.icon(p.champ.icon, p.champ.name)}<div><div class="name">${esc(p.champ.name)}</div>
      <div class="muted">${esc(p.champ.role)} · ${DMG[p.champ.damage]}</div></div><span class="spacer"></span>
      ${cs.imported ? '<span class="ok">Item set imported ✓</span>' : ''}
      <button class="btn primary" id="import">${cs.imported ? 'Re-import' : 'Import item set'}</button>
      ${p.spells ? '<button class="btn" id="spells">Set spells</button>' : ''}</div>` : ''}
    <div class="card" style="margin-bottom:1rem"><h3>Your options (reroll, bench and trades)</h3><div class="options">${opts}</div></div>
    ${planView(p)}
    ${mates ? `<div class="card" style="margin-top:1rem"><h3>Teammates</h3><div class="grid">${mates}</div></div>` : ''}`;
}

function bindChampSelect() {
  $('#import')?.addEventListener('click', async (e) => { e.target.disabled = true; await window.howl.importBuild(); });
  $('#spells')?.addEventListener('click', async (e) => { e.target.disabled = true; await window.howl.applySpells(); e.target.textContent = 'Spells set ✓'; });
}

function gameView(g) {
  const aug = g.augments.offer.length ? `<div class="card" style="margin-bottom:1rem"><h3>Augment offer</h3>
    <div class="aug-list">${g.augments.offer.map((a) => augmentCard(a, a.best ? '<span class="tag gold">Best pick</span>' : '')).join('')}</div></div>` : '';
  const picked = g.augments.picked.length ? `<p class="muted small">Augments taken: ${g.augments.picked.length}</p>` : '';
  return `
    <div class="hero">${ui.icon(g.champ.icon, g.champ.name)}<div><div class="name">${esc(g.champ.name)}</div>
      <div class="muted">Level ${g.level} · ${g.gold} gold · ${Math.floor(g.time / 60)}:${String(Math.floor(g.time % 60)).padStart(2, '0')}</div></div>
      <span class="spacer"></span>
      ${g.nextSkill ? `<div class="row">Level up ${ui.key(g.nextSkill, true)}</div>` : ''}
      <span class="chip ${g.teamGold.diff >= 0 ? 'good' : ''}">Team item gold ${ui.money(g.teamGold.diff)}</span></div>
    ${aug}${picked}
    <div class="card" style="margin-bottom:1rem"><h3>Next buy</h3><div class="sit">${g.items.next.map((it) => `
      <div class="sit-row">${ui.icon(it.icon, it.name)}<div><div>${esc(it.name)} <span class="muted small">${it.gold} g</span></div>
      <div>${ui.chips(it.reasons.slice(0, 2))}</div></div></div>`).join('')}</div></div>
    ${planView({ items: g.items, skills: g.skills, spells: null }, { owned: g.owned, level: g.level })}
    <p class="muted small">Enemy team: ${g.enemies.map((e) => esc(e.name)).join(', ')}</p>`;
}

function lastGameCard() {
  const lg = state?.lastGame;
  if (!lg) return '';
  return `<div class="card" style="max-width:52rem;margin:0 auto">
    <h3>Last game review</h3>
    <div class="game ${lg.win ? 'win' : ''}">${ui.icon(lg.icon, lg.champ, 'lg')}<div class="res">${lg.win ? 'Victory' : 'Defeat'}</div>
      <div><div>${esc(lg.champ)} · ${esc(lg.kda)} · ${lg.dmg?.toLocaleString()} damage (${lg.teamDamageShare}% of team)</div>
      <div class="mini">${lg.augments.map((a) => ui.icon(a.icon, a.name, `rar rar-${a.rarity}`)).join('')}</div></div></div>
    <div class="row" style="margin-top:0.6rem"><span class="muted small" style="width:6rem">You built</span>${lg.items.map((it) => itemCell(it, it.suggested ? 'suggested' : '')).join('')}</div>
    <div class="row"><span class="muted small" style="width:6rem">HOWL build</span>${lg.suggestedBuild.map((it) => itemCell(it)).join('')}</div>
    <p class="muted small">${lg.matched} of your ${lg.total} finished items matched the HOWL build for that matchup.</p>
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
    el.innerHTML = `<div class="filters"><input type="search" id="champSearch" placeholder="Search champion"></div>
      <div class="grid cols-2" style="grid-template-columns:minmax(min(100%,22rem),1fr) 2.2fr"><div class="card"><div class="champs" id="champGrid"></div></div><div id="champPlan"></div></div>`;
    $('#champSearch').addEventListener('input', drawChampGrid);
  }
  drawChampGrid();
  if (pickedChamp) showChampPlan(pickedChamp);
}

function drawChampGrid() {
  const q = ($('#champSearch')?.value || '').toLowerCase();
  const list = [...champList].sort((a, b) => a.name.localeCompare(b.name)).filter((c) => c.name.toLowerCase().includes(q));
  $('#champGrid').innerHTML = list.map((c) => `<button class="champ" data-id="${c.id}">${ui.icon(c.icon, c.name)}${ui.tier(c.tier)}<span>${esc(c.name)}</span></button>`).join('');
  $('#champGrid').querySelectorAll('.champ').forEach((b) => b.addEventListener('click', () => showChampPlan(Number(b.dataset.id))));
}

let poolCache = null;
async function showChampPlan(id) {
  pickedChamp = id;
  const plan = await window.howl.plan(id);
  poolCache ||= await window.howl.augments();
  const rated = await window.howl.rateAugments(id, poolCache.map((a) => a.id));
  const top = rated.sort((a, b) => b.score - a.score).slice(0, 12);
  const c = champList.find((x) => x.id === id);
  $('#champPlan').innerHTML = `
    <div class="hero">${ui.icon(plan.champ.icon, plan.champ.name)}<div><div class="name">${esc(plan.champ.name)} ${ui.tier(c?.tier)}</div>
      <div class="muted">${esc(plan.champ.role)} · ${DMG[plan.champ.damage]}</div><div>${ui.chips(c?.reasons)}</div></div></div>
    ${planView(plan)}
    <div class="card" style="margin-top:1rem"><h3>Augments to look for</h3><div class="aug-list">${top.map((a) => augmentCard(a)).join('')}</div></div>`;
}

// ---------- augments ----------
const augFilter = { q: '', rarity: 'all', sort: 'tier' };
async function renderAugments() {
  const el = $('#tab-augments');
  poolCache ||= await window.howl.augments();
  if (!el.dataset.ready) {
    el.dataset.ready = '1';
    const src = await window.howl.community();
    el.innerHTML = `<div class="filters">
        <input type="search" id="augSearch" placeholder="Search augments">
        ${['all', 'silver', 'gold', 'prismatic'].map((r) => `<button class="pill ${r === 'all' ? 'on' : ''}" data-r="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}
        <select id="augSort"><option value="tier">Sort by tier</option><option value="name">Sort by name</option></select>
        <span class="muted small">Community tiers compiled ${esc(src.compiledAt || '')} from ${src.sources.length} public sources</span>
      </div><div class="aug-list" id="augList"></div>`;
    $('#augSearch').addEventListener('input', (e) => { augFilter.q = e.target.value.toLowerCase(); drawAugments(); });
    $('#augSort').addEventListener('change', (e) => { augFilter.sort = e.target.value; drawAugments(); });
    el.querySelectorAll('.pill').forEach((b) => b.addEventListener('click', () => {
      augFilter.rarity = b.dataset.r;
      el.querySelectorAll('.pill').forEach((x) => x.classList.toggle('on', x === b));
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
  $('#augList').innerHTML = list.map((a) => augmentCard(a)).join('') || '<p class="muted">No augments match.</p>';
}

// ---------- stats ----------
function renderStats() {
  const el = $('#tab-stats');
  const s = state?.stats;
  if (!s) { el.innerHTML = ''; return; }
  const wr = s.myGames ? Math.round((100 * s.myWins) / s.myGames) : 0;
  el.innerHTML = `
    <div class="row" style="margin-bottom:1rem"><h2 style="margin:0">Your ARAM: Mayhem record</h2><span class="spacer"></span>
      <button class="btn" id="syncBtn">Sync match history</button></div>
    <div class="kpis">
      <div class="card kpi"><div class="v">${s.myGames}</div><div class="l">Your recorded games</div></div>
      <div class="card kpi"><div class="v">${s.myWins}W ${s.myGames - s.myWins}L</div><div class="l">${wr}% of games won</div></div>
      <div class="card kpi"><div class="v">${s.champs.length}</div><div class="l">Champions played</div></div>
      <div class="card kpi"><div class="v">${s.totalGames * 10}</div><div class="l">Player builds HOWL learns from</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Champions</h3><table class="list"><tr><th></th><th>Champion</th><th>Games</th><th>Record</th></tr>
        ${s.champs.map((c) => `<tr><td>${ui.icon(c.icon, c.name, 'sm')}</td><td>${esc(c.name)}</td><td>${c.games}</td><td>${c.wins}W ${c.games - c.wins}L</td></tr>`).join('')}</table></div>
      <div class="card"><h3>Augments you pick most</h3><table class="list"><tr><th></th><th>Augment</th><th>Times picked</th></tr>
        ${s.augments.map((a) => `<tr><td>${ui.icon(a.icon, a.name, `sm rar rar-${a.rarity}`)}</td><td>${esc(a.name)}</td><td>${a.picks}</td></tr>`).join('')}</table>
        <p class="muted small">Augment win rates are not shown: Riot's developer policy does not allow apps to display them.</p></div>
    </div>
    <div class="card" style="margin-top:1rem"><h3>Recent games</h3>
      ${s.recent.map((g) => `<div class="game ${g.win ? 'win' : ''}">${ui.icon(g.icon, g.champ)}<div class="res">${g.win ? 'Win' : 'Loss'}</div>
        <div style="width:9rem"><div>${esc(g.champ)}</div><div class="muted small">${esc(g.kda)} · ${ui.ago(g.created)}</div></div>
        <div class="mini">${g.augments.map((a) => ui.icon(a.icon, a.name, `rar rar-${a.rarity}`)).join('')}</div>
        <span class="spacer"></span><div class="mini">${g.items.map((it) => ui.icon(it.icon, it.name)).join('')}</div></div>`).join('') || '<p class="muted">No Mayhem games recorded yet.</p>'}
    </div>`;
  $('#syncBtn').addEventListener('click', async (e) => { e.target.disabled = true; e.target.textContent = 'Syncing...'; await window.howl.sync(); e.target.disabled = false; e.target.textContent = 'Sync match history'; });
}

// ---------- settings ----------
const SETTINGS = [
  ['autoImport', 'Import item sets automatically', 'In champ select, HOWL writes its build for your champion into the client as an item set (shop › item sets).'],
  ['overlay', 'In-game overlay', 'Shows skill order, next items and augment ratings on top of the game. League must run in borderless or windowed mode.'],
  ['augmentReader', 'Read augment cards', 'Reads the offered augment names from your screen with Windows text recognition and rates them. Nothing touches the game files or memory.'],
  ['showGold', 'Team item gold difference', 'Shows how far ahead or behind your team is in item gold, worked out from the visible scoreboard items.'],
  ['autoAccept', 'Auto accept queue', 'Accepts the ready check for you.'],
];

async function renderSettings() {
  settings = await window.howl.settings();
  const logs = await window.howl.logs();
  const src = await window.howl.community();
  $('#tab-settings').innerHTML = `
    <div class="card" style="margin-bottom:1rem">
      <h3>Global ARAM build stats (Riot API key)</h3>
      <p class="small">Riot keeps Mayhem games private, but regular ARAM games are public. With your own key, HOWL collects recent ARAM matches
        on the same map and blends what real players build and level into its recommendations. Get a key at
        <a href="#" data-url="https://developer.riotgames.com">developer.riotgames.com</a> (log in, then copy the Development API Key on your dashboard).
        <b>No key? Nothing to do:</b> HOWL downloads the stats shared in its GitHub repository instead.</p>
      <div class="row">
        <input type="password" id="apiKey" autocomplete="off" spellcheck="false" placeholder="${settings.riotApiKeySet ? `Key saved (ends in ${esc(settings.riotApiKeyHint)}). Paste a new one to replace it` : 'Paste your key: RGAPI-...'}" style="flex:1;min-width:min(100%,22rem)">
        <button class="btn primary" id="saveKey">Save key</button>
        ${settings.riotApiKeySet ? '<button class="btn" id="clearKey">Remove key</button>' : ''}
        <select id="route" title="Riot API region">
          <option value="auto">Region: from League client</option><option value="europe">Europe</option>
          <option value="americas">Americas</option><option value="asia">Asia</option><option value="sea">SEA / Oceania</option>
        </select>
      </div>
      <div class="row" style="margin-top:0.7rem">
        <button class="btn" id="aramRun">Collect now</button>
        <button class="btn" id="aramStop">Stop</button>
        <span class="spacer small" id="aramStatus"></span>
        <span class="small muted">Collect in the background</span>
        <button class="switch ${settings.aramAuto ? 'on' : ''}" data-k="aramAuto" aria-label="Collect in the background"></button>
      </div>
      <p class="muted small">Development keys expire after 24 hours; HOWL tells you when it needs a new one. The key is stored only on this PC, in HOWL's settings file.</p>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Features</h3>
        ${SETTINGS.map(([k, t, d]) => `<div class="setting"><div class="spacer"><div class="t">${t}</div><div class="d">${d}</div></div>
          <button class="switch ${settings[k] ? 'on' : ''}" data-k="${k}" aria-label="${t}"></button></div>`).join('')}
        <div class="setting"><div class="spacer"><div class="t">Overlay position</div></div>
          <select id="pos"><option value="right-middle">Right, middle</option><option value="right-top">Right, top</option>
          <option value="left-middle">Left, middle</option><option value="left-top">Left, top</option></select></div>
        <div class="setting"><div class="spacer"><div class="t">Overlay size</div></div>
          <select id="size"><option value="0.75">Small</option><option value="0.9">Medium</option><option value="1.05">Large</option></select></div>
        <div class="setting"><div class="spacer"><div class="t">Overlay opacity</div><div class="d" id="opacityLabel"></div></div>
          <input type="range" id="opacity" min="0.3" max="1" step="0.05" style="width:min(40%,12rem)"></div>
        <h3 style="margin-top:1.2rem">Hotkeys</h3>
        <p><span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">H</span> show or hide the overlay<br>
           <span class="kbd">Ctrl</span> + <span class="kbd">Shift</span> + <span class="kbd">J</span> read augment cards now</p>
      </div>
      <div class="card"><h3>Data</h3>
        <p class="small">Champions, items and the Mayhem augment pool come from Riot's game data via Data Dragon and CommunityDragon and update each patch.
        Builds blend a kit-based estimate with the Mayhem games HOWL has recorded. Community tiers (compiled ${esc(src.compiledAt || 'n/a')}):</p>
        <ul class="small">${src.sources.map((s) => `<li><a href="#" data-url="${esc(s.url)}">${esc(s.id)}</a> <span class="muted">${esc(s.patchOrDate)}</span></li>`).join('')}</ul>
        <p class="muted small">HOWL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>
        <h3>Activity</h3><div class="log" id="log">${logs.map(esc).join('\n')}</div>
      </div>
    </div>`;
  $('#pos').value = settings.overlayPosition || 'right-middle';
  $('#pos').addEventListener('change', (e) => window.howl.setSettings({ overlayPosition: e.target.value }));
  const sizes = ['0.75', '0.9', '1.05'];
  $('#size').value = sizes.reduce((a, b) => (Math.abs(b - settings.overlayScale) < Math.abs(a - settings.overlayScale) ? b : a));
  $('#size').addEventListener('change', (e) => window.howl.setSettings({ overlayScale: Number(e.target.value) }));
  const showOpacity = (v) => { $('#opacityLabel').textContent = `${Math.round(v * 100)}%`; };
  $('#opacity').value = settings.overlayOpacity ?? 0.85;
  showOpacity($('#opacity').value);
  $('#opacity').addEventListener('input', (e) => { showOpacity(e.target.value); window.howl.setSettings({ overlayOpacity: Number(e.target.value) }); });
  document.querySelectorAll('.switch').forEach((b) => b.addEventListener('click', async () => {
    settings = await window.howl.setSettings({ [b.dataset.k]: !settings[b.dataset.k] });
    b.classList.toggle('on', !!settings[b.dataset.k]);
  }));
  document.querySelectorAll('[data-url]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.howl.open(a.dataset.url); }));

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

function drawAramStatus(s) {
  const el = $('#aramStatus');
  if (!el || !s) return;
  const kept = s.patches.map((p) => `${p.matches} on patch ${p.patch}`).join(', ');
  if (s.shared) {
    el.innerHTML = s.shared.loaded
      ? `<span class="ok">Using shared stats</span>: ${s.totalMatches} ARAM matches (${esc(kept)}), published ${esc(String(s.shared.publishedAt || '').slice(0, 10))}`
      : 'No key: shared stats will download when online';
    $('#aramRun').disabled = true;
    $('#aramStop').disabled = true;
    return;
  }
  el.innerHTML = s.error ? `<span style="color:var(--loss)">${esc(s.error)}</span>`
    : s.running ? `${esc(s.message || 'Working...')} · ${s.requests} requests`
    : `${s.totalMatches ? `${s.totalMatches} ARAM matches collected (${esc(kept)})` : 'No ARAM matches collected yet'}${s.message ? ` · ${esc(s.message)}` : ''}`;
  $('#aramRun').disabled = s.running;
  $('#aramStop').disabled = !s.running;
}
window.howl.onAram(drawAramStatus);

// ---------- boot ----------
window.howl.onState((s) => {
  const prevPhase = state?.phase;
  state = s;
  renderStatus();
  if (currentTab === 'live') renderLive();
  if (currentTab === 'stats' && prevPhase !== s.phase) renderStats();
});
window.howl.onLog((line) => { const l = $('#log'); if (l) { l.textContent += `\n${line}`; l.scrollTop = l.scrollHeight; } });
window.howl.state().then((s) => { state = s; renderStatus(); renderLive(); });
