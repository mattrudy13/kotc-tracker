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
  version: 1,
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

// Simulates a slate. `players`: [{ pid, gid, mean, sd, pPlay }]. Returns { pid: { win, top3 } }.
// Players who can't plausibly reach the top are dropped first to keep it fast.
function simulateSlate(players, date, m = MODEL, sims = m.sims) {
  const live = players.filter((p) => p.pPlay > 0 && p.mean > 0);
  const best = Math.max(0, ...live.map((p) => p.mean));
  const pool = live.filter((p) => p.mean + 4.5 * p.sd >= best);
  const gids = [...new Set(pool.map((p) => p.gid))];
  const gi = Object.fromEntries(gids.map((g, i) => [g, i]));
  const out = Object.fromEntries(pool.map((p) => [p.pid, { win: 0, top3: 0 }]));
  const norm = normals(rng(seedFor(date)));
  const rand = rng(seedFor(date) ^ 0x9e3779b9);
  const vals = new Float64Array(pool.length);
  const gf = new Float64Array(gids.length);
  for (let s = 0; s < sims; s++) {
    for (let g = 0; g < gids.length; g++) gf[g] = 1 + m.gameSd * norm();
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (p.pPlay < 1 && rand() > p.pPlay) {
        vals[i] = -1;
        continue;
      }
      vals[i] = Math.max(0, Math.round(p.mean * gf[gi[p.gid]] + p.sd * norm()));
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

// Full prediction for one day. `games`: [{ gid, home, away, spread, total }]. `candidates`:
// [{ pid, tm, pPlay }]. `hist` from historyBefore(), `prior` from priorTotals().
function predictDay(date, games, candidates, hist, prior, m = MODEL, sims = m.sims) {
  const byTeam = {};
  for (const g of games) {
    byTeam[g.home] = { g, home: true, opp: g.away };
    byTeam[g.away] = { g, home: false, opp: g.home };
  }
  const players = [];
  for (const c of candidates) {
    const t = byTeam[c.tm];
    if (!t) continue;
    const proj = projectPlayer(hist[c.pid], prior[c.pid], m);
    const mean = gameMean(proj, t.g, t.home, m);
    players.push({ pid: c.pid, tm: c.tm, opp: t.opp, home: t.home, gid: t.g.gid, pPlay: c.pPlay, mean, sd: playerSd(mean, m), min: proj.min, rate: proj.rate, gp: proj.gp, isNew: proj.isNew });
  }
  const sim = simulateSlate(players, date, m, sims);
  for (const p of players) {
    p.win = sim[p.pid]?.win ?? 0;
    p.top3 = sim[p.pid]?.top3 ?? 0;
  }
  return players.sort((a, b) => b.win - a.win || b.mean - a.mean);
}

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
    promoInfo, promoCrowns, playChance,
  };
}
