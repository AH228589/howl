// The brain of the app: follows the client (lobby, champ select, game),
// asks the engine for recommendations and keeps one state object that the
// windows render. No Electron here, so it runs under plain Node in tests.
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { profile } = require('./engine/profile');
const items = require('./engine/items');
const skills = require('./engine/skills');
const augments = require('./engine/augments');
const champions = require('./engine/champions');
const { MAYHEM_QUEUES } = require('./stats/store');
const { ROUTES, PLATFORM_ROUTES } = require('./stats/riot-api');
const { canonicalItem } = require('./gamedata');

const MAYHEM_MODE = 'KIWI';
const ITEM_SET_PREFIX = 'HOWL ';

class Session extends EventEmitter {
  constructor({ lcu, live, store, data, community, settings, aram = null, log = () => {} }) {
    super();
    Object.assign(this, { lcu, live, store, data, community, settings, aram, log });
    this.byName = new Map(Object.values(data.champions).map((c) => [c.name.toLowerCase(), c]));
    this.state = {
      client: { connected: false, summoner: null },
      phase: 'None',
      queueId: null,
      isMayhem: false,
      champSelect: null,
      game: null,
      lastGame: null,
      stats: store.summary(),
      party: [],
      data: { version: data.version, augments: Object.keys(data.augments).length },
      notice: null,
    };
    this.importedFor = null;
    this.liveNotes = null;
    this.gameId = null;
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit('state', this.state);
  }

  start() {
    this.lcu.on('connected', () => this.onConnected());
    this.lcu.on('disconnected', () => this.set({ client: { connected: false, summoner: null }, phase: 'None', champSelect: null }));
    this.lcu.on('event', (e) => this.onEvent(e).catch((err) => this.log(`event ${e.uri}: ${err.message}`)));
    this.live.on('update', (d) => this.onLive(d));
    this.live.on('end', () => this.onGameEnd());
    this.lcu.start();
    this.live.start();
  }

  async onConnected() {
    const s = await this.lcu.get('/lol-summoner/v1/current-summoner');
    this.summoner = s;
    this.set({ client: { connected: true, summoner: { name: `${s.gameName}#${s.tagLine}`, puuid: s.puuid, id: s.summonerId } } });
    const phase = await this.lcu.get('/lol-gameflow/v1/gameflow-phase').catch(() => 'None');
    await this.onPhase(phase);
    await this.syncStats();
    this.maybeAutoCrawl();
  }

  async syncStats() {
    if (!this.summoner) return;
    try {
      const added = await this.store.sync(this.lcu, this.summoner.puuid, this.log);
      if (added) this.log(`Recorded ${added} new Mayhem game(s)`);
      this.set({ stats: this.store.summary() });
      return added;
    } catch (e) { this.log(`Match history sync failed: ${e.message}`); return 0; }
  }

  async onEvent({ uri, data }) {
    if (uri === '/lol-gameflow/v1/gameflow-phase') return this.onPhase(data);
    if (uri === '/lol-champ-select/v1/session' && data) return this.onChampSelect(data);
    if (uri === '/lol-matchmaking/v1/ready-check' && data) return this.onReadyCheck(data);
    if (uri === '/lol-lobby/v2/lobby' && data) return this.onLobby(data);
  }

  async onPhase(phase) {
    const prev = this.state.phase;
    let queueId = this.state.queueId;
    if (['Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'InProgress'].includes(phase)) {
      const s = await this.lcu.get('/lol-gameflow/v1/session').catch(() => null);
      queueId = s?.gameData?.queue?.id ?? queueId;
      if (s?.gameData?.gameId) this.gameId = s.gameData.gameId;
    }
    this.set({ phase, queueId, isMayhem: MAYHEM_QUEUES.has(queueId) });
    if (phase === 'Lobby') this.onLobby(await this.lcu.get('/lol-lobby/v2/lobby').catch(() => null));
    if (phase === 'ChampSelect') {
      const cs = await this.lcu.get('/lol-champ-select/v1/session').catch(() => null);
      if (cs) await this.onChampSelect(cs);
    }
    if (!['ChampSelect', 'GameStart', 'InProgress'].includes(phase) && this.state.champSelect) {
      this.importedFor = null;
      this.set({ champSelect: null });
    }
    if (['EndOfGame', 'PreEndOfGame', 'WaitingForStats'].includes(phase) && prev !== phase) this.afterGame();
  }

  onLobby(lobby) {
    if (!lobby?.members) return;
    this.set({ party: lobby.members.filter((m) => m.puuid !== this.summoner?.puuid).map((m) => ({ puuid: m.puuid, name: m.gameName || m.summonerName || '' })) });
  }

  async onReadyCheck(rc) {
    if (!this.settings.get('autoAccept')) return;
    if (rc.state === 'InProgress' && rc.playerResponse === 'None') {
      await this.lcu.request('POST', '/lol-matchmaking/v1/ready-check/accept');
      this.log('Accepted the ready check');
    }
  }

  // ---------- champ select ----------

  async onChampSelect(cs) {
    if (!this.state.isMayhem && !this.settings.get('allQueues')) return;
    const me = (cs.myTeam || []).find((p) => p.cellId === cs.localPlayerCellId);
    const myChamp = me?.championId || 0;
    const bench = (cs.benchChampions || []).map((b) => b.championId ?? b).filter(Boolean)
      .concat(cs.benchChampionIds || []);
    const team = (cs.myTeam || []).map((p) => p.championId).filter(Boolean);
    const partyIds = new Set(this.state.party.map((p) => p.puuid));
    const known = this.knownPlayers();
    const teammates = (cs.myTeam || []).filter((p) => p.cellId !== cs.localPlayerCellId).map((p) => ({
      champ: p.championId, name: this.data.champions[p.championId]?.name || '',
      icon: this.data.champions[p.championId]?.icon,
      party: partyIds.has(p.puuid), playedWith: known[p.puuid] || 0,
    }));

    const candidates = [...new Set([myChamp, ...bench, ...team].filter(Boolean))];
    const ratings = champions.rate({ data: this.data, community: this.community, candidates, team, personal: this.store.personalChampions() })
      .map((r) => ({ ...r, mine: r.id === myChamp, bench: bench.includes(r.id) }));

    let plan = this.state.champSelect?.plan;
    if (myChamp && myChamp !== this.state.champSelect?.myChamp) plan = this.planFor(myChamp, []);
    this.set({ champSelect: { myChamp, bench, team, teammates, ratings, plan, imported: this.importedFor === myChamp } });

    if (myChamp && this.settings.get('autoImport') && this.importedFor !== myChamp) {
      await this.importBuild(myChamp).catch((e) => this.log(`Item set import failed: ${e.message}`));
    }
  }

  planFor(champId, enemies, owned = []) {
    const champ = this.data.champions[champId];
    if (!champ) return null;
    const p = profile(champ);
    const enemyProfiles = enemies.map((id) => this.data.champions[id]).filter(Boolean).map(profile);
    return {
      champ: { id: champ.id, name: champ.name, icon: champ.icon, role: p.role, damage: p.damage },
      items: items.recommend({ data: this.data, profile: p, enemies: enemyProfiles, owned, pool: this.store.itemPool(champId), global: this.globalFor(champId) }),
      skills: skills.recommend({ champ, profile: p, recorded: this.store.skillRecord(champId), global: this.globalFor(champId) }),
      spells: this.spellsFor(champId),
    };
  }

  globalFor(champId) {
    const c = this.aram?.champion(champId);
    return c ? { ...c, realGames: this.aram.realGames(champId) } : null;
  }

  // Region route for Riot's web API: the setting, or the client's region.
  async riotRoute() {
    const chosen = this.settings.get('riotRoute');
    if (chosen && chosen !== 'auto') return chosen;
    const rl = await this.lcu.get('/riotclient/region-locale').catch(() => null);
    const fromClient = ROUTES[String(rl?.region || '').toUpperCase()];
    if (fromClient) return fromClient;
    const platform = this.store.games.find((g) => g.platform)?.platform;
    return PLATFORM_ROUTES[String(platform || '').toUpperCase()] || null;
  }

  // Collects ARAM matches with the user's key, seeded from you and the
  // players in your recent Mayhem games.
  async crawlAram(opts = {}) {
    if (!this.aram) return null;
    const key = this.settings.get('riotApiKey');
    const route = await this.riotRoute();
    if (!route) {
      this.aram.setStatus({ error: 'Could not detect your region. Pick it in the region menu next to the key.' });
      return this.aram.summary();
    }
    const me = this.summoner ? [{ name: this.summoner.gameName, tag: this.summoner.tagLine }] : [];
    const seeds = [...me, ...this.store.riotIds(this.summoner?.puuid)];
    const result = await this.aram.crawl({ key, route, seeds, base: process.env.HOWL_RIOT_API || null, ...opts });
    this.planKey = null;
    if (this.state.champSelect?.myChamp) {
      this.set({ champSelect: { ...this.state.champSelect, plan: this.planFor(this.state.champSelect.myChamp, []) } });
    }
    return result;
  }

  maybeAutoCrawl() {
    if (!this.aram || !this.settings.get('riotApiKey') || !this.settings.get('aramAuto') || this.aram.status.running) return;
    const last = this.aram.db.lastRun ? Date.parse(this.aram.db.lastRun) : 0;
    if (Date.now() - last > 6 * 3600000 || this.aram.orderBacklog() > 30) this.crawlAram().catch((e) => this.log(`ARAM stats: ${e.message}`));
  }

  spellsFor(champId) {
    const sp = this.store.spellPair(champId);
    return sp && { ...sp, list: sp.spells.map((id) => this.data.spells?.[id] || { id, name: `Spell ${id}` }) };
  }

  async importBuild(champId) {
    const plan = this.state.champSelect?.plan?.champ?.id === champId ? this.state.champSelect.plan : this.planFor(champId, []);
    if (!plan || !this.summoner) return;
    const path = `/lol-item-sets/v1/item-sets/${this.summoner.summonerId}/sets`;
    const current = await this.lcu.get(path);
    const first = plan.items.build[0];
    const block = (type, list) => ({ type, items: list.map((i) => ({ id: String(i.id), count: 1 })) });
    const set = {
      title: `${ITEM_SET_PREFIX}${plan.champ.name} Mayhem`,
      associatedChampions: [champId],
      associatedMaps: [12],
      blocks: [
        block('Rush first item', (first?.components || []).map((id) => ({ id })).concat(first ? [first] : [])),
        block('HOWL core build', plan.items.build),
        block('Situational', plan.items.situational),
        block('Consumables', [{ id: 2003 }, { id: 2055 }].filter((i) => this.data.items[i.id])),
      ].filter((b) => b.items.length),
      map: 'any', mode: 'any', preferredItemSlots: [], sortrank: 0, startedFrom: 'blank', type: 'custom',
      uid: crypto.randomUUID(),
    };
    const itemSets = (current.itemSets || []).filter((s) => !String(s.title).startsWith(ITEM_SET_PREFIX));
    await this.lcu.request('PUT', path, { ...current, itemSets: [...itemSets, set], timestamp: Date.now() });
    this.importedFor = champId;
    if (this.state.champSelect) this.set({ champSelect: { ...this.state.champSelect, imported: true } });
    this.log(`Imported item set for ${plan.champ.name}`);
  }

  async applySpells() {
    const spells = this.state.champSelect?.plan?.spells?.spells;
    if (!spells) return;
    await this.lcu.request('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id: spells[0], spell2Id: spells[1] });
  }

  knownPlayers() {
    const n = {};
    for (const g of this.store.games) for (const p of g.participants) if (p.puuid && p.puuid !== this.summoner?.puuid) n[p.puuid] = (n[p.puuid] || 0) + 1;
    return n;
  }

  // ---------- in game ----------

  onLive(d) {
    const mode = d.gameData?.gameMode;
    if (mode !== MAYHEM_MODE && !this.settings.get('allQueues')) {
      if (this.state.game) this.set({ game: null });
      return;
    }
    const meId = d.activePlayer?.riotId;
    const me = d.allPlayers.find((p) => p.riotId === meId) || d.allPlayers.find((p) => p.summonerName === d.activePlayer?.summonerName);
    if (!me) return;
    const champ = this.byName.get(String(me.championName).toLowerCase());
    if (!champ) return;
    const enemies = d.allPlayers.filter((p) => p.team !== me.team);
    const enemyIds = enemies.map((p) => this.byName.get(String(p.championName).toLowerCase())?.id).filter(Boolean);
    const owned = me.items.map((i) => canonicalItem(i.itemID));
    const ab = d.activePlayer.abilities || {};
    const ranks = { Q: ab.Q?.abilityLevel || 0, W: ab.W?.abilityLevel || 0, E: ab.E?.abilityLevel || 0, R: ab.R?.abilityLevel || 0 };
    const level = d.activePlayer.level;

    this.noteProgress(champ.id, ranks, owned);

    // Recompute the plan only when something that matters changes.
    const key = `${champ.id}|${enemyIds.join(',')}|${owned.join(',')}`;
    if (key !== this.planKey) {
      this.planKey = key;
      this.plan = this.planFor(champ.id, enemyIds, owned);
    }
    const teamGold = (team) => d.allPlayers.filter((p) => p.team === team)
      .reduce((s, p) => s + p.items.reduce((t, i) => t + (this.data.items[i.itemID]?.gold || 0) * (i.count || 1), 0), 0);
    const ally = teamGold(me.team);
    const enemy = enemies.length ? teamGold(enemies[0].team) : 0;
    const prevAug = this.state.game?.augments || { offer: [], picked: [] };
    this.set({
      game: {
        champ: this.plan.champ,
        time: d.gameData.gameTime,
        level, gold: Math.floor(d.activePlayer.currentGold || 0), ranks,
        nextSkill: skills.nextSkill(this.plan.skills.order, ranks, level),
        skills: this.plan.skills,
        items: this.plan.items,
        owned,
        enemies: enemyIds.map((id) => ({ id, name: this.data.champions[id].name, icon: this.data.champions[id].icon })),
        teamGold: { ally, enemy, diff: ally - enemy },
        augments: prevAug,
      },
    });
  }

  noteProgress(champId, ranks, owned) {
    const n = (this.liveNotes ||= { champ: champId, skillSeq: [], itemOrder: [], offers: [], picks: [], prevRanks: { Q: 0, W: 0, E: 0, R: 0 } });
    for (const k of ['Q', 'W', 'E', 'R']) {
      for (let r = n.prevRanks[k]; r < ranks[k]; r++) n.skillSeq.push(k);
    }
    n.prevRanks = { ...ranks };
    for (const id of owned) {
      const it = this.data.items[id];
      if (it && (it.legendary || it.boots) && !n.itemOrder.includes(id)) n.itemOrder.push(id);
    }
  }

  // Called by the augment reader with the cards on screen.
  onAugmentOffer(cards) {
    if (!this.state.game) return;
    const picked = this.state.game.augments.picked;
    const champ = this.data.champions[this.state.game.champ.id];
    const p = profile(champ);
    const rated = augments.rateOffer({
      data: this.data, community: this.community, profile: p, offer: cards.map((c) => c.id), picked,
      recorded: this.store.augmentRecord(p.role),
    }).map((r, i) => ({ ...r, rect: cards[i].rect }));
    if (this.liveNotes) this.liveNotes.offers.push(cards.map((c) => c.id));
    this.set({ game: { ...this.state.game, augments: { offer: rated, picked } } });
  }

  onAugmentCleared(pickedId) {
    if (!this.state.game) return;
    const picked = [...this.state.game.augments.picked];
    if (pickedId && !picked.includes(pickedId)) picked.push(pickedId);
    if (pickedId && this.liveNotes) this.liveNotes.picks.push(pickedId);
    this.set({ game: { ...this.state.game, augments: { offer: [], picked } } });
  }

  onGameEnd() {
    if (this.liveNotes && this.gameId) {
      const { prevRanks, ...notes } = this.liveNotes;
      this.store.noteLive(this.gameId, notes);
    }
    this.liveNotes = null;
    this.planKey = null;
    this.set({ game: null });
    this.afterGame();
  }

  // The finished game shows up in match history a little after the game
  // closes, so retry a few times.
  async afterGame() {
    if (this.afterGameRunning) return;
    this.afterGameRunning = true;
    try {
      for (const wait of [5000, 15000, 30000, 60000]) {
        await new Promise((r) => setTimeout(r, this.testDelay ?? wait));
        if (await this.syncStats()) break;
      }
      const last = this.store.games[0];
      if (last) this.set({ lastGame: this.postGame(last) });
    } finally { this.afterGameRunning = false; }
  }

  // Post-game review: what you built versus what HOWL suggested.
  postGame(g) {
    const me = g.participants.find((p) => p.champ === g.myChamp);
    if (!me) return null;
    const plan = this.planFor(g.myChamp, g.participants.filter((p) => p.team !== me.team).map((p) => p.champ));
    const suggested = new Set(plan.items.build.map((i) => i.id));
    const matched = me.items.filter((id) => suggested.has(id)).length;
    const total = me.items.filter((id) => this.data.items[id]?.legendary || this.data.items[id]?.boots).length;
    return {
      gameId: g.gameId, win: g.myWin, duration: g.duration,
      champ: this.data.champions[g.myChamp]?.name, icon: this.data.champions[g.myChamp]?.icon,
      kda: `${me.k}/${me.d}/${me.a}`, dmg: me.dmg,
      teamDamageShare: Math.round(100 * me.dmg / Math.max(1, g.participants.filter((p) => p.team === me.team).reduce((s, p) => s + p.dmg, 0))),
      items: me.items.map((id) => ({ id, name: this.data.items[id]?.name, icon: this.data.items[id]?.icon, suggested: suggested.has(id) })),
      augments: me.augments.map((id) => ({ id, ...this.store.aug(id) })),
      matched, total,
      suggestedBuild: plan.items.build.map((i) => ({ id: i.id, name: i.name, icon: i.icon })),
      skillSeq: g.mine?.skillSeq || null,
    };
  }
}

module.exports = { Session, MAYHEM_MODE };
