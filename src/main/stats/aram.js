// Global ARAM build statistics from Riot's official match API (queue 450,
// regular ARAM). Mayhem games are private on that API, but plain ARAM is
// public and is the closest real data for item and skill choices on the
// Howling Abyss. Runs in the background with the user's own API key and
// keeps per-patch counts in a local JSON file.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { RiotApi, RiotApiError } = require('./riot-api');
const { priorityFromSequence } = require('../engine/skills');
const { canonicalItem } = require('../gamedata');

const ARAM_QUEUE = 450;
const KEEP_PATCHES = 2;
const patchOf = (v) => String(v || '').split('.').slice(0, 2).join('.');
const previousPatch = (p) => { const [a, b] = p.split('.').map(Number); return b > 1 ? `${a}.${b - 1}` : null; };
const SLOT = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };

class AramStats extends EventEmitter {
  constructor({ file, data, log = () => {} }) {
    super();
    this.file = file;
    this.data = data;
    this.log = log;
    this.db = { version: 1, patches: {}, seen: {}, lastRun: null };
    try { this.db = { ...this.db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
    this.status = { running: false, matches: 0, requests: 0, error: this.db.lastError?.message || null, message: null };
    this.stopRequested = false;
  }

  get currentPatch() { return patchOf(this.data.version); }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.db));
  }

  // Stats the builds read: your own, or the shared file published by the
  // person running HOWL with a key (friends without a key use that one).
  readPatches() { return this.useShared && this.shared ? this.shared.patches : this.db.patches; }

  // Patches we keep: the current one and the one before it.
  livePatches(patches = this.db.patches) {
    return Object.keys(patches).sort((a, b) => {
      const [am, an] = a.split('.').map(Number);
      const [bm, bn] = b.split('.').map(Number);
      return bm - am || bn - an;
    }).slice(0, KEEP_PATCHES);
  }

  // Matches whose item order has not been read yet.
  orderBacklog() {
    return Object.keys(this.db.seen).filter((id) => !this.db.orderSeen?.[id]).length;
  }

  matchCount(patches = this.db.patches) {
    return this.livePatches(patches).reduce((s, p) => s + (patches[p].matches || 0), 0);
  }

  // What gets published for friends: aggregated counts only. No API key,
  // no match ids and no player ids.
  exportShared() {
    const patches = {};
    for (const p of this.livePatches()) patches[p] = this.db.patches[p];
    return { version: 1, publishedAt: new Date().toISOString(), matches: this.matchCount(), patches };
  }

  loadShared(json) {
    if (!json || typeof json.patches !== 'object') return false;
    this.shared = { publishedAt: json.publishedAt || null, patches: json.patches };
    return true;
  }

  setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', this.summary());
  }

  summary() {
    return {
      ...this.status,
      patches: this.livePatches(this.readPatches()).map((p) => ({ patch: p, matches: this.readPatches()[p].matches })),
      totalMatches: this.matchCount(this.readPatches()),
      lastRun: this.db.lastRun,
      shared: this.useShared ? { publishedAt: this.shared?.publishedAt || null, loaded: !!this.shared } : null,
    };
  }

  // ---------- aggregation ----------

  // orderOnly: the match was counted before item order was recorded; only
  // the order is added now.
  addMatch(match, timeline, { orderOnly = false } = {}) {
    const info = match.info;
    const patch = patchOf(info.gameVersion);
    const bucket = (this.db.patches[patch] ||= { matches: 0, champs: {} });
    if (!orderOnly) bucket.matches++;
    (this.db.orderSeen ||= {})[match.metadata?.matchId] = Date.now();

    const byPid = {};
    for (const f of timeline?.info?.frames || []) {
      for (const e of f.events || []) {
        const p = (byPid[e.participantId] ||= { buys: [], skills: [] });
        if (e.type === 'ITEM_PURCHASED') p.buys.push(canonicalItem(e.itemId));
        if (e.type === 'ITEM_UNDO' && e.beforeId) {
          const i = p.buys.lastIndexOf(e.beforeId);
          if (i >= 0) p.buys.splice(i, 1);
        }
        if (e.type === 'SKILL_LEVEL_UP' && e.levelUpType !== 'EVOLVE' && SLOT[e.skillSlot]) p.skills.push(SLOT[e.skillSlot]);
      }
    }

    for (const pt of info.participants) {
      const c = (bucket.champs[pt.championId] ||= { games: 0, wins: 0, items: {}, first: {}, skills: {} });
      const finals = new Set([0, 1, 2, 3, 4, 5].map((i) => canonicalItem(pt[`item${i}`])).filter(Boolean));
      const t = byPid[pt.participantId];
      // Completion order of the finished items this player ended with:
      // position 0 is the first one completed (boots included).
      if (t) {
        const done = [];
        for (const id of t.buys) {
          const it = this.data.items[id];
          if (it && (it.legendary || it.boots) && finals.has(id) && !done.includes(id)) done.push(id);
        }
        c.order ||= {};
        done.forEach((id, pos) => {
          const o = (c.order[id] ||= { n: 0, sum: 0 });
          o.n++;
          o.sum += pos;
        });
      }
      if (orderOnly) continue;
      c.games++;
      if (pt.win) c.wins++;
      for (const id of finals) {
        const it = this.data.items[id];
        if (!it || !(it.legendary || it.boots)) continue;
        const r = (c.items[id] ||= { picks: 0, wins: 0 });
        r.picks++;
        if (pt.win) r.wins++;
      }
      if (t) {
        const firstLegendary = t.buys.find((id) => this.data.items[id]?.legendary);
        if (firstLegendary) c.first[firstLegendary] = (c.first[firstLegendary] || 0) + 1;
        if (t.skills.length >= 12) {
          const pr = priorityFromSequence(t.skills);
          c.skills[pr] = (c.skills[pr] || 0) + 1;
        }
      }
    }
  }

  // Merged counts over the kept patches, newest patch counted double.
  champion(champId) {
    const out = { games: 0, wins: 0, items: {}, first: {}, skills: {}, order: {} };
    const patches = this.readPatches();
    this.livePatches(patches).forEach((p, i) => {
      const c = patches[p].champs[champId];
      if (!c) return;
      const w = i === 0 ? 2 : 1;
      out.games += c.games * w; out.wins += c.wins * w;
      for (const [rawId, r] of Object.entries(c.items)) {
        const id = canonicalItem(Number(rawId)); // data saved before upgrades were mapped
        const o = (out.items[id] ||= { picks: 0, wins: 0 });
        o.picks += r.picks * w; o.wins += r.wins * w;
      }
      for (const [rawId, n] of Object.entries(c.first)) { const id = canonicalItem(Number(rawId)); out.first[id] = (out.first[id] || 0) + n * w; }
      for (const [k, n] of Object.entries(c.skills)) out.skills[k] = (out.skills[k] || 0) + n * w;
      for (const [id, o] of Object.entries(c.order || {})) {
        const r = (out.order[id] ||= { n: 0, sum: 0 });
        r.n += o.n; r.sum += o.sum;
      }
    });
    return out.games ? out : null;
  }

  // Unweighted game count for labels ("in 42 ARAM games").
  realGames(champId) {
    const patches = this.readPatches();
    return this.livePatches(patches).reduce((s, p) => s + (patches[p].champs[champId]?.games || 0), 0);
  }

  // ---------- crawling ----------

  stop() { this.stopRequested = true; }

  // seeds: [{ name, tag }] Riot IDs to start from (you first).
  // The first runs go long (about 25 minutes on a development key) so the
  // stats are useful right away; later runs top up.
  async crawl({ key, route, seeds, base = null, maxRequests = null, targetMatches = 1500 }) {
    maxRequests ??= this.matchCount() < 300 || this.orderBacklog() > 30 ? 1200 : 300;
    if (this.status.running) return this.summary();
    if (!key) { this.setStatus({ error: 'Add a Riot API key in Settings first.' }); return this.summary(); }
    this.stopRequested = false;
    this.setStatus({ running: true, error: null, matches: 0, requests: 0, message: 'Looking up players' });
    const api = new RiotApi({ key, route, base });
    const queue = [];
    const queued = new Set();
    const push = (puuid) => { if (puuid && !queued.has(puuid) && queue.length < 400) { queued.add(puuid); queue.push(puuid); } };
    const current = this.currentPatch;
    const seedErrors = [];
    let added = 0;
    try {
      for (const s of seeds.slice(0, 12)) {
        if (api.requests >= maxRequests / 4) break;
        const acc = await api.accountByRiotId(s.name, s.tag).catch((e) => {
          if (e instanceof RiotApiError && (e.status === 401 || e.status === 403)) throw e;
          seedErrors.push(e.message);
          return null;
        });
        if (acc?.puuid) push(acc.puuid);
      }
      // Players met in earlier runs keep the crawl going when the seeds'
      // matches are all collected already.
      for (const p of [...(this.db.frontier || [])].sort(() => Math.random() - 0.5)) push(p);
      if (!queue.length) throw new Error(`Could not find any of the ${seeds.length} seed players on the Riot API (region ${route}${seedErrors.length ? `; ${seedErrors[0]}` : ''}).`);

      // Matches collected before item order was recorded: read their
      // timelines once more for the order (their item counts stay as they are).
      const backfill = Object.keys(this.db.seen).filter((id) => !this.db.orderSeen?.[id]);
      let reordered = 0;
      for (const id of backfill) {
        if (this.stopRequested || api.requests >= maxRequests * 0.6) break;
        const match = await api.match(id);
        const kept = match?.info?.queueId === ARAM_QUEUE && this.livePatches().includes(patchOf(match.info.gameVersion));
        if (!kept) { (this.db.orderSeen ||= {})[id] = Date.now(); continue; }
        this.addMatch(match, await api.timeline(id), { orderOnly: true });
        for (const p of match.info.participants) push(p.puuid);
        reordered++;
        this.setStatus({ requests: api.requests, message: `Reading item order from ${reordered} earlier matches` });
        if (reordered % 10 === 0) this.save();
      }

      while (queue.length && api.requests < maxRequests - 2 && !this.stopRequested) {
        if (this.matchCount() >= targetMatches) { this.setStatus({ message: `Reached ${targetMatches} matches for this patch` }); break; }
        const puuid = queue.shift();
        const ids = (await api.matchIds(puuid, { queue: ARAM_QUEUE, count: 10 })) || [];
        for (const id of ids) {
          if (this.stopRequested || api.requests >= maxRequests - 2) break;
          if (this.db.seen[id]) {
            // Already counted. When few players are left to visit, read it
            // again only for its players (no timeline, counted once).
            if (queue.length < 30) {
              const again = await api.match(id);
              for (const p of again?.info?.participants || []) push(p.puuid);
            }
            continue;
          }
          this.db.seen[id] = Date.now();
          const match = await api.match(id);
          if (!match || match.info?.queueId !== ARAM_QUEUE) continue;
          const patch = patchOf(match.info.gameVersion);
          // Match ids come newest first: an old patch means this player has
          // nothing newer to give.
          if (patch !== current && patch !== previousPatch(current)) break;
          const timeline = await api.timeline(id);
          this.addMatch(match, timeline);
          added++;
          for (const p of match.info.participants) push(p.puuid);
          this.db.frontier = [...match.info.participants.map((p) => p.puuid), ...(this.db.frontier || [])].slice(0, 300);
          this.setStatus({ matches: added, requests: api.requests, message: `Collected ${added} ARAM matches` });
          if (added % 10 === 0) this.save();
        }
      }
      this.prune();
      this.db.lastRun = new Date().toISOString();
      this.db.lastError = null;
      this.save();
      this.setStatus({ running: false, requests: api.requests, message: `Added ${added} ARAM matches (${this.matchCount()} kept for patches ${this.livePatches().join(', ')})` });
      this.log(`ARAM stats: added ${added} matches with ${api.requests} API requests`);
    } catch (e) {
      this.db.lastError = { at: new Date().toISOString(), message: e.message };
      this.save();
      this.setStatus({ running: false, error: e.message, requests: api.requests });
      this.log(`ARAM stats stopped: ${e.message}`);
    }
    return this.summary();
  }

  prune() {
    const keep = new Set(this.livePatches());
    for (const p of Object.keys(this.db.patches)) if (!keep.has(p)) delete this.db.patches[p];
    // Forget seen ids older than a month.
    const cutoff = Date.now() - 30 * 86400000;
    for (const [id, t] of Object.entries(this.db.seen)) if (t < cutoff) delete this.db.seen[id];
    for (const id of Object.keys(this.db.orderSeen || {})) if (!this.db.seen[id]) delete this.db.orderSeen[id];
  }
}

module.exports = { AramStats, patchOf, ARAM_QUEUE };
