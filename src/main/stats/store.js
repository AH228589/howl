// Recorded Mayhem games. Every finished game in your client's match history
// is saved with all ten players (champion, items, augments, result), and your
// own games also get the skill order, item order and augment offers that HOWL
// saw live. Aggregates from this file feed the engine.
const fs = require('fs');
const path = require('path');
const { profile } = require('../engine/profile');
const { priorityFromSequence } = require('../engine/skills');
const { canonicalItem } = require('../gamedata');

const MAYHEM_QUEUES = new Set([2400, 2401]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class GameStore {
  constructor(file, data) {
    this.file = file;
    this.data = data; // static game data (champions/items/augments)
    this.db = { version: 1, games: {}, live: {} };
    try { this.db = { ...this.db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
    this.cache = null;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.db));
    this.cache = null;
  }

  get games() { return Object.values(this.db.games).sort((a, b) => b.created - a.created); }

  // Live notes for a game in progress (skill sequence, buy order, augments).
  noteLive(gameId, mine) {
    if (!gameId) return;
    this.db.live[gameId] = { ...this.db.live[gameId], ...mine };
    if (this.db.games[gameId]) this.db.games[gameId].mine = this.db.live[gameId];
    this.save();
  }

  static parseGame(g, mePuuid) {
    const ids = Object.fromEntries((g.participantIdentities || []).map((x) => [x.participantId, x.player || {}]));
    const participants = g.participants.map((p) => {
      const s = p.stats || {};
      return {
        puuid: ids[p.participantId]?.puuid || null,
        name: ids[p.participantId]?.gameName || '',
        tag: ids[p.participantId]?.tagLine || '',
        champ: p.championId,
        team: p.teamId,
        win: !!s.win,
        items: [0, 1, 2, 3, 4, 5].map((i) => s[`item${i}`]).filter(Boolean),
        augments: [1, 2, 3, 4, 5, 6].map((i) => s[`playerAugment${i}`]).filter(Boolean),
        spells: [p.spell1Id, p.spell2Id],
        k: s.kills, d: s.deaths, a: s.assists,
        dmg: s.totalDamageDealtToChampions, taken: s.totalDamageTaken, healed: s.totalHeal,
      };
    });
    const me = participants.find((p) => p.puuid === mePuuid);
    return {
      gameId: g.gameId, created: g.gameCreation, duration: g.gameDuration, version: g.gameVersion, platform: g.platformId || null,
      queue: g.queueId, myChamp: me?.champ ?? null, myWin: me?.win ?? null, participants,
    };
  }

  // Pulls new Mayhem games from the client's match history (about the last
  // 20 games are kept by the client, so HOWL keeps its own copy).
  async sync(lcu, mePuuid, log = () => {}) {
    const list = await lcu.get('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=50');
    const games = (list?.games?.games || []).filter((g) => MAYHEM_QUEUES.has(g.queueId));
    let added = 0;
    for (const g of games) {
      // Games saved before Riot tags were recorded are read again once.
      if (this.db.games[g.gameId] && this.db.games[g.gameId].participants[0]?.tag !== undefined) continue;
      try {
        const full = await lcu.get(`/lol-match-history/v1/games/${g.gameId}`);
        const parsed = GameStore.parseGame(full, mePuuid);
        if (this.db.live[g.gameId]) parsed.mine = this.db.live[g.gameId];
        this.db.games[g.gameId] = parsed;
        added++;
      } catch (e) { log(`Could not read game ${g.gameId}: ${e.message}`); }
      await sleep(250);
    }
    if (added) this.save();
    return added;
  }

  // Aggregates, rebuilt lazily after each change.
  agg() {
    if (this.cache) return this.cache;
    const champs = {}; // per champion, all players: items + spells
    const mine = {}; // per champion, you only
    const augByRole = {}; // role -> augment -> picks/wins
    const skills = {}; // per champion, your skill priorities
    const roleOf = (id) => {
      const c = this.data.champions[id];
      return c ? profile(c).role : 'Fighter';
    };
    for (const g of Object.values(this.db.games)) {
      for (const p of g.participants) {
        const c = (champs[p.champ] ||= { games: 0, wins: 0, items: {}, spells: {} });
        c.games++; if (p.win) c.wins++;
        for (const id of new Set(p.items.map(canonicalItem))) {
          const it = this.data.items[id];
          if (!it || !(it.legendary || it.boots)) continue;
          const r = (c.items[id] ||= { picks: 0, wins: 0 });
          r.picks++; if (p.win) r.wins++;
        }
        const pair = [...p.spells].sort((a, b) => a - b).join('+');
        c.spells[pair] = (c.spells[pair] || 0) + 1;
        const role = roleOf(p.champ);
        const ar = (augByRole[role] ||= {});
        for (const a of p.augments) {
          const r = (ar[a] ||= { picks: 0, wins: 0 });
          r.picks++; if (p.win) r.wins++;
        }
      }
      if (g.myChamp != null) {
        const m = (mine[g.myChamp] ||= { games: 0, wins: 0 });
        m.games++; if (g.myWin) m.wins++;
        const seq = g.mine?.skillSeq;
        if (seq && seq.length >= 12) {
          const s = (skills[g.myChamp] ||= { games: 0, priorities: {} });
          const pr = priorityFromSequence(seq);
          s.games++; s.priorities[pr] = (s.priorities[pr] || 0) + 1;
        }
      }
    }
    this.cache = { champs, mine, augByRole, skills };
    return this.cache;
  }

  // Riot IDs of players from your recent Mayhem games, newest first: seeds
  // for the ARAM stats crawler.
  riotIds(mePuuid, limit = 12) {
    const out = [];
    const seen = new Set();
    for (const g of this.games) {
      for (const p of g.participants) {
        if (p.puuid === mePuuid || !p.name || !p.tag || seen.has(p.puuid)) continue;
        seen.add(p.puuid);
        out.push({ name: p.name, tag: p.tag });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  itemPool(champId) {
    const c = this.agg().champs[champId];
    return c ? { games: c.games, items: c.items } : null;
  }

  skillRecord(champId) { return this.agg().skills[champId] || null; }

  augmentRecord(role) { return this.agg().augByRole[role] || null; }

  personalChampions() { return this.agg().mine; }

  // Most used summoner spell pair for the champion in recorded games.
  spellPair(champId) {
    const c = this.agg().champs[champId];
    const all = {};
    for (const x of Object.values(this.agg().champs)) for (const [k, v] of Object.entries(x.spells)) all[k] = (all[k] || 0) + v;
    const best = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
    const pick = (c && c.games >= 3 && best(c.spells)) || best(all);
    return pick ? { spells: pick[0].split('+').map(Number), games: pick[1], champSpecific: !!(c && c.games >= 3) } : null;
  }

  aug(id) { return this.data.augments[id] || this.data.augmentArchive?.[id] || { name: `Augment ${id}` }; }

  summary() {
    const games = this.games;
    const mineGames = games.filter((g) => g.myChamp != null);
    const champs = Object.entries(this.agg().mine).map(([id, v]) => ({ id: Number(id), name: this.data.champions[id]?.name || id, icon: this.data.champions[id]?.icon, ...v }))
      .sort((a, b) => b.games - a.games);
    const augCount = {};
    for (const g of mineGames) {
      const me = g.participants.find((p) => p.champ === g.myChamp);
      for (const a of me?.augments || []) augCount[a] = (augCount[a] || 0) + 1;
    }
    const augments = Object.entries(augCount).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([id, n]) => ({ id: Number(id), name: this.aug(id).name, icon: this.aug(id).icon, rarity: this.aug(id).rarity, picks: n }));
    return {
      totalGames: games.length,
      myGames: mineGames.length,
      myWins: mineGames.filter((g) => g.myWin).length,
      champs,
      augments,
      recent: mineGames.slice(0, 15).map((g) => {
        const me = g.participants.find((p) => p.champ === g.myChamp) || {};
        return {
          gameId: g.gameId, created: g.created, duration: g.duration, win: g.myWin,
          champ: this.data.champions[g.myChamp]?.name, icon: this.data.champions[g.myChamp]?.icon,
          kda: `${me.k}/${me.d}/${me.a}`, dmg: me.dmg,
          items: me.items?.map((id) => ({ id, icon: this.data.items[id]?.icon, name: this.data.items[id]?.name })) || [],
          augments: me.augments?.map((id) => ({ id, name: this.aug(id).name, icon: this.aug(id).icon, rarity: this.aug(id).rarity })) || [],
        };
      }),
    };
  }
}

module.exports = { GameStore, MAYHEM_QUEUES };
