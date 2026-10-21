// Data and model code shared by the pages (as globals) and the Node scripts (via createRequire).
// No DOM access here. Any change to the model changes recorded predictions, so the page and the
// Action always agree.

// ---- Box-score rows ----

// Season files store player games as arrays (`cols` names the fields) to keep them small.
function rowObjects(data) {
  const ix = Object.fromEntries(data.cols.map((c, i) => [c, i]));
  return data.rows.map((r) => {
    const g = data.games[r[ix.gid]];
    const tm = r[ix.tm];
    const home = g ? g.home === tm : null;
    return {
      d: r[ix.d], gid: r[ix.gid], pid: r[ix.pid], tm,
      opp: g ? (home ? g.away : g.home) : null,
      home,
      min: r[ix.min], pts: r[ix.pts], reb: r[ix.reb], ast: r[ix.ast], start: !!r[ix.start],
      pra: r[ix.pts] + r[ix.reb] + r[ix.ast],
    };
  });
}

// Compact { pid: { n: name, t: team } } for the pages, optionally limited to some players.
// Headshots aren't stored: they follow ESPN's URL pattern (see headshotUrl in common.js).
function nameMap(data, pids) {
  const out = {};
  for (const pid of pids ?? Object.keys(data.players)) {
    const p = data.players[pid];
    if (p) out[pid] = { n: p.name, t: p.team };
  }
  return out;
}

// Dates whose games are all final (a day isn't settled until its last game ends).
function finishedDays(data) {
  const done = new Set(data.processedEvents);
  const byDay = {};
  for (const [gid, g] of Object.entries(data.games)) {
    (byDay[g.d] ??= { games: 0, done: 0 }).games++;
    if (g.state === "post" && done.has(gid)) byDay[g.d].done++;
  }
  return byDay;
}

// Top `n` PRA lines for every game day. Everyone tied for the top PRA is a King (DK splits the
// prize across all of them).
function dailyLeaders(data, n = 10) {
  const rows = rowObjects(data);
  const status = finishedDays(data);
  const byDay = {};
  for (const r of rows) (byDay[r.d] ??= []).push(r);
  return Object.keys(status)
    .sort()
    .filter((d) => byDay[d])
    .map((d) => {
      const list = byDay[d].sort((a, b) => b.pra - a.pra || b.pts - a.pts);
      const top = list[0].pra;
      return {
        d,
        games: status[d].games,
        final: status[d].done === status[d].games,
        kings: list.filter((r) => r.pra === top).map((r) => r.pid),
        top: list.slice(0, n).map((r) => ({ pid: r.pid, tm: r.tm, opp: r.opp, home: r.home, min: r.min, pts: r.pts, reb: r.reb, ast: r.ast, pra: r.pra })),
      };
    });
}

// Per-player season averages, plus team games so far for the 70% qualifier.
function seasonAverages(data) {
  const rows = rowObjects(data);
  const done = new Set(data.processedEvents);
  const teamGames = {};
  for (const [gid, g] of Object.entries(data.games)) {
    if (!done.has(gid)) continue;
    teamGames[g.home] = (teamGames[g.home] ?? 0) + 1;
    teamGames[g.away] = (teamGames[g.away] ?? 0) + 1;
  }
  const by = {};
  for (const r of rows) {
    const p = (by[r.pid] ??= { pid: r.pid, gp: 0, min: 0, pts: 0, reb: 0, ast: 0, best: 0, bestD: null, gs: 0 });
    p.gp++;
    p.min += r.min;
    p.pts += r.pts;
    p.reb += r.reb;
    p.ast += r.ast;
    p.gs += r.start ? 1 : 0;
    if (r.pra > p.best) {
      p.best = r.pra;
      p.bestD = r.d;
    }
  }
  return {
    teamGames,
    players: Object.values(by).map((p) => ({ ...p, tm: data.players[p.pid]?.team ?? null })),
  };
}

// ---- Projection model ----
//
// Each player's PRA for a day is projected as minutes × PRA per minute, adjusted for the game's
// expected pace (betting total) and blowout risk (spread). The day is then simulated many times
// to get each player's chance of finishing first (and top 3). Constants are fitted on 2025-26
// October–January games (scripts/backtest.mjs --fit); February–April is the holdout.

const MODEL = {
  version: 2, // v2 (2026-10-21): teammates out and opponent defense
  halfLife: 6, // games: weight of a game halves every 6 games back (current season)
  minPriorGames: 1, // last season's minutes count as this many current-season games
  ratePriorMin: 100, // last season's PRA/min counts as this many current-season minutes
  leagueRate: 0.78, // PRA per minute for a player with no history
  leaguePriorMin: 150, // shrink every rate toward leagueRate by this many minutes
  newMin: 16, // projected minutes for a player with no NBA history
  totalAvg: 230, // league-average game total; a higher total means more possessions
  paceExp: 0.6, // PRA scales with (total / totalAvg) ^ paceExp
  blowoutFrom: 7, // points of spread before starters start losing minutes
  // Share of minutes lost per point of spread beyond that, for 28+ minute players. Tested at 0.006
  // and 0.012 on 2025-26 Oct–Jan: both made projections worse, so it's off.
  blowoutPerPt: 0,
  sd0: 5.6, // player noise: sd = sd0 + sd1 × mean (fitted on projection errors, so it includes them)
  sd1: 0.12,
  gameSd: 0.12, // shared game factor (pace/overtime), as a share of PRA
  dtdPlay: 0.7, // chance a day-to-day (questionable) player suits up
  sims: 10000,
  // Teammates out (v2): mean × (1 + teamK × (tonight's missing share − the player's usual share)).
  // A team's regulars are players whose last game was for it, within its last regularGames games,
  // projected regularMin+ minutes; the missing share is their projected PRA that isn't playing.
  teamK: 0.4,
  regularGames: 5,
  regularMin: 10,
  missBase: 0.15, // the usual missing share before a player has games of their own (worth missBaseGames)
  missBaseGames: 1,
  // Opponent defense (v2): PRA allowed ÷ what the players who faced them were projected for, shrunk
  // toward the league by defShrink projected PRA (null = off). defByPos splits it into G/F/C.
  defShrink: 12000,
  defByPos: false,
  // Public pick share: softmax of bWin·log(win) + bSeason·season PRA avg + bPrior·last season's avg.
  // Fitted by scripts/fit-share.mjs on nights where DK published every player's payout.
  share: { version: 2, bWin: 0.915, bSeason: 0.021, bPrior: -0.003, fallbackAvg: 15, minShareForEntrants: 0.05 },
  valueMinWin: 0.02, // the best-value list skips long shots below this win chance
};

// Last season's per-player totals, used as the prior.
function priorTotals(rows) {
  const by = {};
  for (const r of rows) {
    const p = (by[r.pid] ??= { gp: 0, min: 0, pra: 0 });
    p.gp++;
    p.min += r.min;
    p.pra += r.pra;
  }
  return by;
}

// Current-season games per player, newest first, for dates before `date`.
function historyBefore(rows, date) {
  const by = {};
  for (const r of rows) if (r.d < date) (by[r.pid] ??= []).push(r);
  for (const k in by) by[k].sort((a, b) => (a.d < b.d ? 1 : -1));
  return by;
}

function projectPlayer(games, prior, m = MODEL) {
  let wSum = 0, wMin = 0, wPra = 0;
  (games ?? []).forEach((g, i) => {
    const w = Math.pow(0.5, i / m.halfLife);
    wSum += w;
    wMin += w * g.min;
    wPra += w * g.pra;
  });
  const priorMin = prior?.gp ? prior.min / prior.gp : null;
  const priorRateRaw = prior?.min ? prior.pra / prior.min : null;
  const priorRate = prior?.min ? (prior.pra + m.leagueRate * m.leaguePriorMin) / (prior.min + m.leaguePriorMin) : m.leagueRate;
  let min;
  if (wSum && priorMin != null) min = (wMin + m.minPriorGames * priorMin) / (wSum + m.minPriorGames);
  else if (wSum) min = wMin / wSum;
  else if (priorMin != null) min = priorMin;
  else min = m.newMin;
  const priorW = prior?.min ? m.ratePriorMin : m.leaguePriorMin;
  const rate = (wPra + priorW * priorRate) / (wMin + priorW);
  return { min, rate, gp: games?.length ?? 0, priorGp: prior?.gp ?? 0, priorRate: priorRateRaw, isNew: !wSum && !prior?.gp };
}

// Mean PRA for a player in a given game.
function gameMean(proj, game, isHome, m = MODEL) {
  let min = proj.min;
  const spread = game?.spread;
  if (spread != null && min >= 28) {
    const over = Math.max(0, Math.abs(spread) - m.blowoutFrom);
    min *= 1 - m.blowoutPerPt * over;
  }
  const pace = game?.total ? Math.pow(game.total / m.totalAvg, m.paceExp) : 1;
  return min * proj.rate * pace;
}

const playerSd = (mean, m = MODEL) => m.sd0 + m.sd1 * Math.max(mean, 0);

// Small seeded RNG so the same inputs always give the same probabilities (page = Action).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normals(rand) {
  let spare = null;
  return () => {
    if (spare != null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0, v = 0;
    while (u === 0) u = rand();
    v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}
function seedFor(date) {
  let h = 2166136261;
  for (const c of date) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Simulates a slate. `players`: [{ pid, tm, gid, mean, sd, pPlay, k }]. Returns { pid: { win, top3 } }.
// `sitters` ({ tm: [{ pid, pPlay, share }] }) are questionable regulars: in each simulation where
// one sits, teammates' means rise by k × that player's share (teammates out, only when they sit).
// Players who can't plausibly reach the top are dropped first to keep it fast.
function simulateSlate(players, date, m = MODEL, sims = m.sims, sitters = null) {
  const live = players.filter((p) => p.pPlay > 0 && p.mean > 0);
  const best = Math.max(0, ...live.map((p) => p.mean));
  const upside = (p) => p.mean + (p.k ?? 0) * (sitters?.[p.tm] ?? []).reduce((s, q) => s + q.share, 0);
  const pool = live.filter((p) => upside(p) + 4.5 * Math.max(p.sd, playerSd(upside(p), m)) >= best);
  const gids = [...new Set(pool.map((p) => p.gid))];
  const gi = Object.fromEntries(gids.map((g, i) => [g, i]));
  const out = Object.fromEntries(pool.map((p) => [p.pid, { win: 0, top3: 0 }]));
  // One play/sit draw per questionable player per simulation, shared by their own line and their
  // teammates' bump.
  const pPlayOf = {};
  for (const p of pool) if (p.pPlay < 1) pPlayOf[p.pid] = p.pPlay;
  for (const list of Object.values(sitters ?? {})) for (const q of list) pPlayOf[q.pid] = q.pPlay;
  const drawPids = Object.keys(pPlayOf);
  const dj = Object.fromEntries(drawPids.map((pid, j) => [pid, j]));
  const playing = new Uint8Array(drawPids.length);
  const teams = Object.entries(sitters ?? {}).filter(([tm]) => pool.some((p) => p.tm === tm && p.k));
  const ti = Object.fromEntries(teams.map(([tm], t) => [tm, t]));
  const extra = new Float64Array(teams.length);
  const own = pool.map((p) => dj[p.pid] ?? -1);
  const team = pool.map((p) => (p.k ? ti[p.tm] ?? -1 : -1));
  const norm = normals(rng(seedFor(date)));
  const rand = rng(seedFor(date) ^ 0x9e3779b9);
  const vals = new Float64Array(pool.length);
  const gf = new Float64Array(gids.length);
  for (let s = 0; s < sims; s++) {
    for (let g = 0; g < gids.length; g++) gf[g] = 1 + m.gameSd * norm();
    for (let j = 0; j < drawPids.length; j++) playing[j] = rand() > pPlayOf[drawPids[j]] ? 0 : 1;
    for (let t = 0; t < teams.length; t++) {
      extra[t] = 0;
      for (const q of teams[t][1]) if (!playing[dj[q.pid]]) extra[t] += q.share;
    }
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (own[i] >= 0 && !playing[own[i]]) {
        vals[i] = -1;
        continue;
      }
      const bump = team[i] >= 0 ? p.k * extra[team[i]] : 0;
      const mean = p.mean + bump;
      const sd = bump ? playerSd(mean, m) : p.sd;
      vals[i] = Math.max(0, Math.round(mean * gf[gi[p.gid]] + sd * norm()));
    }
    // First place (ties split) and top 3 (counting everyone tied at 3rd).
    let top = -1;
    for (let i = 0; i < vals.length; i++) if (vals[i] > top) top = vals[i];
    let n = 0;
    for (let i = 0; i < vals.length; i++) if (vals[i] === top) n++;
    const sorted = Array.from(vals).sort((a, b) => b - a);
    const third = sorted[Math.min(2, sorted.length - 1)];
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] < 0) continue;
      if (vals[i] === top) out[pool[i].pid].win += 1 / n;
      if (vals[i] >= third) out[pool[i].pid].top3++;
    }
  }
  for (const k in out) {
    out[k].win /= sims;
    out[k].top3 /= sims;
  }
  return out;
}

// ---- Team context (v2): teammates out and opponent defense ----
//
// Built one finished day at a time (addDay), so it only knows days before the one being predicted.
// It keeps each team's recent players, the share of each team's usual production that sat out on
// each date, and every team's PRA allowed against what the players who faced it were projected for.

const posGroup = (pos) => (pos === "C" ? "C" : /G$/.test(pos ?? "") ? "G" : "F");

// `posOf(pid)` gives ESPN's position (G, F, C, PG, …). `m` sets the projection constants.
function newContext(prior, posOf, m = MODEL) {
  return { prior, posOf, m, hist: {}, members: {}, teamDays: {}, miss: {}, allowed: {}, league: {}, lastDay: null };
}

// A team's regulars before the context's next day, each with projected PRA (minutes × rate).
function teamRegulars(ctx, tm) {
  const m = ctx.m;
  const recent = new Set((ctx.teamDays[tm] ?? []).slice(0, m.regularGames));
  const out = [];
  for (const pid of ctx.members[tm] ?? []) {
    const h = ctx.hist[pid];
    if (!recent.has(h[0].d)) continue;
    const pr = projectPlayer(h, ctx.prior[pid], m);
    if (pr.min >= m.regularMin) out.push({ pid, pra: pr.min * pr.rate });
  }
  return out;
}

// Adds a finished day's box-score rows (rowObjects) to the context. Days must come in order.
function addDay(ctx, d, dayRows, games) {
  const m = ctx.m;
  if (ctx.lastDay && d <= ctx.lastDay) throw new Error(`context day ${d} after ${ctx.lastDay}`);
  const played = new Set(dayRows.map((r) => r.pid));
  for (const tm of new Set(dayRows.map((r) => r.tm))) {
    const regs = teamRegulars(ctx, tm);
    const total = regs.reduce((s, r) => s + r.pra, 0);
    if (total) (ctx.miss[tm] ??= {})[d] = regs.filter((r) => !played.has(r.pid)).reduce((s, r) => s + r.pra, 0) / total;
  }
  // Defense compares against the plain projection (no context), so it doesn't depend on teamK.
  for (const r of dayRows) {
    const g = games[r.gid];
    const mean = gameMean(projectPlayer(ctx.hist[r.pid], ctx.prior[r.pid], m), g, g?.home === r.tm, m);
    for (const key of ["all", posGroup(ctx.posOf(r.pid))]) {
      const a = ((ctx.allowed[r.opp] ??= {})[key] ??= { pra: 0, proj: 0 });
      const l = (ctx.league[key] ??= { pra: 0, proj: 0 });
      a.pra += r.pra;
      a.proj += mean;
      l.pra += r.pra;
      l.proj += mean;
    }
  }
  for (const r of dayRows) {
    const h = (ctx.hist[r.pid] ??= []);
    const was = h[0]?.tm;
    if (was !== r.tm) {
      if (was) ctx.members[was].delete(r.pid);
      (ctx.members[r.tm] ??= new Set()).add(r.pid);
    }
    h.unshift(r);
    const td = (ctx.teamDays[r.tm] ??= []);
    if (td[0] !== d) td.unshift(d);
  }
  ctx.lastDay = d;
}

// A context holding every day of `rows` before `date`.
function contextBefore(rows, games, prior, posOf, date, m = MODEL) {
  const ctx = newContext(prior, posOf, m);
  const byDay = {};
  for (const r of rows) if (r.d < date) (byDay[r.d] ??= []).push(r);
  for (const d of Object.keys(byDay).sort()) addDay(ctx, d, byDay[d], games);
  return ctx;
}

// The missing share a player's recent games had (weighted like the projection), so the bump is
// relative: a star who has been out for weeks is already in the teammates' numbers.
function missBaseline(ctx, pid, m = MODEL) {
  let w = m.missBaseGames, s = m.missBaseGames * m.missBase;
  (ctx.hist[pid] ?? []).forEach((g, i) => {
    const x = ctx.miss[g.tm]?.[g.d];
    if (x == null) return;
    const wi = Math.pow(0.5, i / m.halfLife);
    w += wi;
    s += wi * x;
  });
  return s / w;
}

function defenseFactor(ctx, opp, pid, m = MODEL) {
  if (m.defShrink == null || !opp) return 1;
  const key = m.defByPos ? posGroup(ctx.posOf(pid)) : "all";
  const a = ctx.allowed[opp]?.[key], l = ctx.league[key];
  if (!a || !l?.proj) return 1;
  const r = l.pra / l.proj;
  return (a.pra + m.defShrink * r) / (a.proj + m.defShrink) / r;
}

// Context adjustments for one date: per player { bump, outPct, bumpIf, def }, and the questionable regulars
// by team (`sitters`) for simulateSlate. A regular who isn't a candidate (or can't play) is out.
function contextAdjust(ctx, date, candidates, byTeam, m = MODEL) {
  if (ctx.lastDay && ctx.lastDay >= date) throw new Error(`context includes ${ctx.lastDay}, predicting ${date}`);
  const cand = Object.fromEntries(candidates.map((c) => [c.pid, c]));
  const teams = {}, sitters = {};
  for (const tm of new Set(candidates.map((c) => c.tm))) {
    const regs = teamRegulars(ctx, tm);
    const total = regs.reduce((s, r) => s + r.pra, 0);
    const t = (teams[tm] = { total, outShare: 0, q: [] });
    for (const r of regs) {
      const c = cand[r.pid];
      const share = r.pra / total;
      if (!c || c.tm !== tm || !(c.pPlay > 0)) t.outShare += share;
      else if (c.pPlay < 1) t.q.push({ pid: r.pid, pPlay: c.pPlay, share });
    }
    if (t.q.length && m.teamK) sitters[tm] = t.q;
  }
  const players = {};
  for (const c of candidates) {
    const t = teams[c.tm];
    let bump = 1, outPct = 0, bumpIf = null;
    // A team's first game has no regulars yet: no bump either way.
    if (t.total && m.teamK) {
      const base = missBaseline(ctx, c.pid, m);
      bump = Math.max(0, 1 + m.teamK * (t.outShare - base));
      // For the page: the rise over the same night with every regular available (a fully healthy
      // team sits a little below its recent games, which had the usual absences in them).
      const healthy = 1 - m.teamK * base;
      outPct = healthy > 0 ? bump / healthy - 1 : 0;
      const top = t.q.filter((q) => q.pid !== c.pid).sort((a, b) => b.share - a.share)[0];
      if (top && bump) bumpIf = { pid: top.pid, pct: (m.teamK * top.share) / bump };
    }
    players[c.pid] = { bump, outPct, bumpIf, def: defenseFactor(ctx, byTeam[c.tm]?.opp, c.pid, m) };
  }
  return { players, sitters };
}

// Full prediction for one day. `games`: [{ gid, home, away, spread, total }]. `candidates`:
// [{ pid, tm, pPlay }]. `hist` from historyBefore(), `prior` from priorTotals(). `ctx` (a context
// of the days before `date`) adds teammates out and opponent defense; without it this is model v1.
function predictDay(date, games, candidates, hist, prior, m = MODEL, sims = m.sims, ctx = null) {
  const byTeam = {};
  for (const g of games) {
    byTeam[g.home] = { g, home: true, opp: g.away };
    byTeam[g.away] = { g, home: false, opp: g.home };
  }
  const adj = ctx ? contextAdjust(ctx, date, candidates.filter((c) => byTeam[c.tm]), byTeam, m) : null;
  const players = [];
  for (const c of candidates) {
    const t = byTeam[c.tm];
    if (!t) continue;
    const proj = projectPlayer(hist[c.pid], prior[c.pid], m);
    const base = gameMean(proj, t.g, t.home, m);
    const a = adj?.players[c.pid] ?? { bump: 1, outPct: 0, bumpIf: null, def: 1 };
    const mean = base * a.def * a.bump;
    // k: how much the mean rises per unit of share a questionable teammate takes with them.
    const k = adj?.sitters[c.tm] ? base * a.def * m.teamK : 0;
    players.push({ pid: c.pid, tm: c.tm, opp: t.opp, home: t.home, gid: t.g.gid, pPlay: c.pPlay, mean, sd: playerSd(mean, m), k, bump: a.bump, outPct: a.outPct, bumpIf: a.bumpIf, def: a.def, min: proj.min, rate: proj.rate, gp: proj.gp, isNew: proj.isNew });
  }
  const sim = simulateSlate(players, date, m, sims, adj?.sitters);
  for (const p of players) {
    p.win = sim[p.pid]?.win ?? 0;
    p.top3 = sim[p.pid]?.top3 ?? 0;
  }
  return players.sort((a, b) => b.win - a.win || b.mean - a.mean);
}

// ---- Pick share and value ----
//
// The prize is split among everyone on the King, so a pick's value depends on how many people
// pick the same player. The public's picks track the model's win chance closely (prop lines carry
// the same information), with a lean toward big names, so the share estimate uses both.

// Season PRA average so far and last season's, as the public sees them.
function shareFeatures(games, prior, m = MODEL) {
  const season = games?.length ? games.reduce((s, g) => s + g.pra, 0) / games.length : null;
  const last = prior?.gp ? prior.pra / prior.gp : null;
  return { season: season ?? last ?? m.share.fallbackAvg, last: last ?? season ?? m.share.fallbackAvg };
}

// Estimated share of entrants on each player. `players` need { win, season, last }; every
// candidate that night must be included, since shares are relative to the whole field.
function pickShares(players, m = MODEL) {
  const s = m.share;
  const z = players.map((p) => Math.exp(s.bWin * Math.log(Math.max(p.win, 1e-4)) + s.bSeason * p.season + s.bPrior * p.last));
  const total = z.reduce((a, b) => a + b, 0);
  return z.map((x) => x / total);
}

// Value fields for one player. On Three Kings nights each place has its own pool (pool ÷ 3), so the
// chance that matters is finishing top 3.
function valueFields(p, promo, entrants) {
  const three = promo?.format === "three";
  const chance = three ? p.top3 : p.win;
  const poolPerPlace = promo ? promo.pool / (three ? 3 : 1) : null;
  const estPayout = poolPerPlace && entrants && p.share ? poolPerPlace / (entrants * p.share) : null;
  return {
    value: p.share ? chance / p.share : null, // 1.0 = picked exactly in line with its chance
    estPayout,
    ev: estPayout != null ? chance * estPayout : null,
  };
}

// Entrants implied by a winner's payout: everyone on the winners split the pool, so
// bettors on them = pool ÷ payout, and entrants = that ÷ their combined estimated share.
// Only trusted when the winners' share is big enough to be estimated well.
function impliedEntrants(promo, shareOf, m = MODEL) {
  if (promo?.format !== "king") return null;
  const paid = (promo.winners ?? []).filter((w) => w.payout);
  if (!paid.length || paid.length !== promo.winners.length) return null;
  const share = paid.reduce((s, w) => s + (shareOf(w.pid) ?? 0), 0);
  if (share < m.share.minShareForEntrants) return null;
  return promo.pool / paid[0].payout / share;
}

// Adds share, value, estPayout and ev to every player of a night. `players` must be the whole field
// (shares are relative to it) and need { pid, win, top3 }; `featsOf(pid)` gives shareFeatures().
function addValue(players, featsOf, promo, entrants, m = MODEL) {
  const withFeats = players.map((p) => ({ ...p, ...featsOf(p.pid) }));
  const shares = pickShares(withFeats, m);
  players.forEach((p, i) => {
    p.share = shares[i];
    Object.assign(p, valueFields(p, promo, entrants));
  });
  return players;
}

// The three ways of picking the Model page tracks: the model's favorite, the best value among
// players with a real chance, and the public's favorite (highest estimated share).
function valuePicks(players, m = MODEL) {
  const top = (list, key) => list.reduce((a, b) => (b[key] > (a?.[key] ?? -Infinity) ? b : a), null)?.pid ?? null;
  return {
    favorite: top(players, "win"),
    value: top(players.filter((p) => p.win >= m.valueMinWin && p.value != null), "value"),
    public: top(players, "share"),
  };
}

// Bonus bets one token on `pid` won: DK's payout if they were paid, else 0. Null when the night's
// payouts aren't known (or it was a Three Kings night, which the record leaves out).
function pickReturn(pid, promo) {
  if (promo?.format !== "king" || !promo.winners?.length || promo.winners.some((w) => w.payout == null)) return null;
  return promo.winners.find((w) => w.pid === pid)?.payout ?? 0;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

// ---- Promo days and crowns ----

// The promo for date `d`, or null. Listed entries win; otherwise a season `default` (e.g. every
// Wednesday with games) applies, marked `assumed` until someone checks it.
function promoInfo(promos, d, gameDays) {
  if (!promos) return null;
  const listed = promos.promos?.find((p) => p.date === d);
  if (listed) return { winners: [], ...listed };
  const def = promos.default;
  if (!def || d < def.from || promos.skip?.includes(d)) return null;
  if (gameDays && !gameDays.includes(d)) return null;
  if (new Date(`${d}T12:00:00Z`).getUTCDay() !== def.weekday) return null;
  return { date: d, format: def.format, pool: def.pool, winners: [], assumed: true };
}

// Who gets a crown for a promo day: only #1 counts, even on Three Kings nights (Rudy's call).
// When DK's paid list is known it settles ties and stat corrections (e.g. Duren on 3/17/26).
function promoCrowns(promo, day) {
  const paid = (promo?.winners ?? []).map((w) => w.pid);
  if (!paid.length) return day?.kings ?? [];
  if (promo.format === "king") return paid;
  const firsts = (day?.kings ?? []).filter((pid) => paid.includes(pid));
  return firsts.length ? firsts : paid.slice(0, 1);
}

// Chance a player suits up, from the ESPN injury report.
function playChance(injury, m = MODEL) {
  if (!injury) return 1;
  const s = `${injury.status ?? ""} ${injury.fantasy ?? ""}`.toLowerCase();
  if (/\bout\b|injured reserve|suspen/.test(s)) return 0;
  if (/doubtful/.test(s)) return 0.25;
  if (/probable/.test(s)) return 0.95;
  return m.dtdPlay; // Day-To-Day, Questionable, GTD
}

if (typeof module !== "undefined") {
  module.exports = {
    rowObjects, nameMap, finishedDays, dailyLeaders, seasonAverages,
    MODEL, priorTotals, historyBefore, projectPlayer, gameMean, playerSd, simulateSlate, predictDay,
    posGroup, newContext, addDay, contextBefore, contextAdjust, missBaseline, defenseFactor,
    promoInfo, promoCrowns, playChance,
    shareFeatures, pickShares, valueFields, addValue, valuePicks, pickReturn, impliedEntrants, median,
  };
}
