#!/usr/bin/env node
// Replays a finished season day by day with model.js, using only games before each day, and
// writes data/backtest-<season>.json for the Model page.
//
//   node scripts/backtest.mjs [season]        # default 2025 (2025-26), prior = season − 1
//   node scripts/backtest.mjs --fit           # grid-search the constants on Oct–Jan only
//
// Known lookahead, stated on the Model page: the candidate list for a day is the players who
// actually played, which stands in for the final injury report at tip-off (late scratches are
// "known"). Minutes and stats are never taken from the day itself.

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const M = require("../model.js");
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

const args = process.argv.slice(2);
const season = Number(args.find((a) => /^\d{4}$/.test(a)) ?? 2025);
const fit = args.includes("--fit");
// Fit window: October–January. Holdout: February to the end of the season.
const HOLDOUT_FROM = `${season + 1}-02-01`;

const load = async (f) => JSON.parse(await readFile(path.join(DATA_DIR, `${f}.json`), "utf8"));
const cur = await load(season);
const prev = await load(season - 1);
const rows = M.rowObjects(cur);
const prior = M.priorTotals(M.rowObjects(prev));
const days = M.dailyLeaders(cur, 3).filter((d) => d.final);
let promos = null, pickshare = null;
try {
  promos = await load(`promos-${season}`);
} catch {}
try {
  pickshare = await load(`pickshare-${season}`);
} catch {}
const fittedOn = new Set((pickshare?.nights ?? []).filter((n) => !n.partial).map((n) => n.date));
const gameDays = days.map((d) => d.d);

const byDay = {};
for (const r of rows) (byDay[r.d] ??= []).push(r);

// Current-season games per player, newest first, built incrementally as the days advance.
function* replay(filter) {
  const hist = {};
  let i = 0;
  const sorted = [...rows].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  for (const day of days) {
    while (i < sorted.length && sorted[i].d < day.d) {
      (hist[sorted[i].pid] ??= []).unshift(sorted[i]);
      i++;
    }
    if (!filter(day.d)) continue;
    // No lookahead: everything in `hist` is from an earlier date.
    for (const k in hist) if (hist[k][0] && hist[k][0].d >= day.d) throw new Error(`lookahead on ${day.d}`);
    const games = [...new Set(byDay[day.d].map((r) => r.gid))].map((gid) => ({ gid, ...cur.games[gid] }));
    const candidates = byDay[day.d].map((r) => ({ pid: r.pid, tm: r.tm, pPlay: 1 }));
    yield { day, games, candidates, hist };
  }
}

const inFit = (d) => d < HOLDOUT_FROM;
const praOf = (d, pid) => byDay[d].find((r) => r.pid === pid)?.pra;

// ---- Fitting: projection error for players who could plausibly win, then the spread ----

if (fit) {
  const grid = [];
  for (const halfLife of [3, 4, 6, 8])
    for (const minPriorGames of [0.5, 1, 2])
      for (const ratePriorMin of [25, 50, 100])
        for (const paceExp of [0, 0.6, 1])
          for (const blowoutPerPt of [0, 0.006, 0.012]) grid.push({ ...M.MODEL, halfLife, minPriorGames, ratePriorMin, paceExp, blowoutPerPt });
  const results = grid.map((m) => {
    let se = 0, n = 0;
    for (const { day, games, candidates, hist } of replay(inFit)) {
      const byTeam = {};
      for (const g of games) {
        byTeam[g.home] = { g, home: true };
        byTeam[g.away] = { g, home: false };
      }
      for (const c of candidates) {
        const proj = M.projectPlayer(hist[c.pid], prior[c.pid], m);
        const mean = M.gameMean(proj, byTeam[c.tm].g, byTeam[c.tm].home, m);
        if (mean < 28) continue; // only the players who can realistically win a day
        const e = praOf(day.d, c.pid) - mean;
        se += e * e;
        n++;
      }
    }
    return { m, rmse: Math.sqrt(se / n), n };
  });
  results.sort((a, b) => a.rmse - b.rmse);
  console.log("Best projection constants (RMSE on players projected 28+ PRA, Oct–Jan):");
  for (const r of results.slice(0, 8)) {
    const { halfLife, minPriorGames, ratePriorMin, paceExp, blowoutPerPt } = r.m;
    console.log(`  rmse ${r.rmse.toFixed(3)} n=${r.n}  halfLife=${halfLife} minPriorGames=${minPriorGames} ratePriorMin=${ratePriorMin} paceExp=${paceExp} blowoutPerPt=${blowoutPerPt}`);
  }
  // Spread: residual sd by projected PRA bucket, with the best projection constants.
  const best = results[0].m;
  const buckets = {};
  for (const { day, games, candidates, hist } of replay(inFit)) {
    const byTeam = {};
    for (const g of games) {
      byTeam[g.home] = { g, home: true };
      byTeam[g.away] = { g, home: false };
    }
    for (const c of candidates) {
      const proj = M.projectPlayer(hist[c.pid], prior[c.pid], best);
      const mean = M.gameMean(proj, byTeam[c.tm].g, byTeam[c.tm].home, best);
      const b = Math.min(50, Math.floor(mean / 5) * 5);
      const e = praOf(day.d, c.pid) - mean;
      const x = (buckets[b] ??= { n: 0, se: 0, sm: 0, me: 0 });
      x.n++;
      x.se += e * e;
      x.sm += mean;
      x.me += e;
    }
  }
  console.log("Residual sd by projected PRA (with the best constants) vs current sd formula:");
  for (const [b, x] of Object.entries(buckets).sort((a, b) => a[0] - b[0])) {
    const mean = x.sm / x.n;
    console.log(`  ${String(b).padStart(2)}+  n=${String(x.n).padStart(5)}  mean ${mean.toFixed(1)}  bias ${(x.me / x.n).toFixed(2)}  sd ${Math.sqrt(x.se / x.n).toFixed(2)}  formula ${M.playerSd(mean, best).toFixed(2)}`);
  }
  // Calibration of the spread and game factor: log loss of the actual King on fit days.
  console.log("Log loss of the King's win chance, Oct–Jan (2,000 sims a day):");
  for (const sdScale of [0.85, 1, 1.15])
    for (const gameSd of [0, 0.06, 0.12]) {
      const m = { ...best, sd0: best.sd0 * sdScale, sd1: best.sd1 * sdScale, gameSd };
      const s = score(m, inFit, 2000);
      console.log(`  sd×${sdScale} gameSd=${gameSd}: log loss ${s.logLoss.toFixed(3)}, top pick won ${s.hits}/${s.n}`);
    }
  process.exit(0);
}

function kingProb(preds, kings) {
  // Ties: the chance that any of the tied players finishes first.
  return kings.reduce((s, pid) => s + (preds.find((p) => p.pid === pid)?.win ?? 0), 0);
}

function score(m, filter, sims) {
  let ll = 0, n = 0, hits = 0;
  for (const { day, games, candidates, hist } of replay(filter)) {
    const preds = M.predictDay(day.d, games, candidates, hist, prior, m, sims);
    const p = Math.max(kingProb(preds, day.kings), 1e-4);
    ll -= Math.log(p);
    n++;
    if (day.kings.includes(preds[0].pid)) hits++;
  }
  return { logLoss: ll / n, n, hits };
}

// ---- Full backtest ----

const out = [];
for (const { day, games, candidates, hist } of replay(() => true)) {
  const preds = M.predictDay(day.d, games, candidates, hist, prior, M.MODEL);
  // Baseline: highest PRA per game so far (3+ games this season, else last season).
  const avg = (pid) => {
    const g = hist[pid];
    if (g?.length >= 3) return g.reduce((s, r) => s + r.pra, 0) / g.length;
    const p = prior[pid];
    return p?.gp ? p.pra / p.gp : 0;
  };
  const byAvg = candidates.map((c) => ({ pid: c.pid, avg: avg(c.pid) })).sort((a, b) => b.avg - a.avg);
  const byMean = [...preds].sort((a, b) => b.mean - a.mean);
  const rankOf = (list, pids) => Math.min(...pids.map((pid) => list.findIndex((p) => p.pid === pid) + 1 || 999));
  // Value (promo nights): estimated pick shares over the whole field, then the three strategies.
  const promo = M.promoInfo(promos, day.d, gameDays);
  let value = null;
  if (promo) {
    M.addValue(preds, (pid) => M.shareFeatures(hist[pid], prior[pid]), promo, null);
    const picks = M.valuePicks(preds);
    const shareOf = (pid) => preds.find((p) => p.pid === pid)?.share;
    value = {
      picks,
      returns: Object.fromEntries(Object.entries(picks).map(([k, pid]) => [k, M.pickReturn(pid, promo)])),
      entrants: M.impliedEntrants(promo, shareOf),
      fitted: fittedOn.has(day.d) || undefined, // the share model was fitted on this night
    };
  }
  out.push({
    d: day.d,
    games: games.length,
    players: candidates.length,
    holdout: !inFit(day.d),
    kings: day.kings,
    kingPra: day.top[0].pra,
    pKing: kingProb(preds, day.kings),
    rank: rankOf(preds, day.kings),
    rankAvg: rankOf(byAvg, day.kings),
    rankMean: rankOf(byMean, day.kings),
    pick: preds[0].pid,
    avgPick: byAvg[0].pid,
    top: preds.slice(0, 10).map((p) => ({ pid: p.pid, tm: p.tm, opp: p.opp, home: p.home, mean: +p.mean.toFixed(1), win: +p.win.toFixed(4), top3: +p.top3.toFixed(4), pra: praOf(day.d, p.pid), ...(promo ? { share: +p.share.toFixed(4), value: +p.value.toFixed(3) } : {}) })),
    value,
    preds: preds.filter((p) => p.win > 0).map((p) => [p.pid, +p.win.toFixed(4)]),
  });
}

function summary(list) {
  const n = list.length;
  const hit = (k) => list.filter((x) => x[k] === 1).length;
  const top = (k, t) => list.filter((x) => x[k] <= t).length;
  return {
    days: n,
    logLoss: list.reduce((s, x) => s - Math.log(Math.max(x.pKing, 1e-4)), 0) / n,
    avgPKing: list.reduce((s, x) => s + x.pKing, 0) / n,
    model: { first: hit("rank"), top3: top("rank", 3), top5: top("rank", 5) },
    avg: { first: hit("rankAvg"), top3: top("rankAvg", 3), top5: top("rankAvg", 5) },
    mean: { first: hit("rankMean"), top3: top("rankMean", 3), top5: top("rankMean", 5) },
    // A no-skill model that spread its chances evenly over the day's players would score this.
    uniformLogLoss: list.reduce((s, x) => s + Math.log(x.players), 0) / n,
  };
}

// Calibration: every player-day's predicted win chance vs whether they won.
const bins = [0, 0.02, 0.05, 0.1, 0.2, 0.35, 1];
const calib = bins.slice(0, -1).map((lo, i) => ({ lo, hi: bins[i + 1], n: 0, pred: 0, won: 0 }));
for (const x of out) {
  for (const [pid, p] of x.preds) {
    const b = calib.find((c) => p >= c.lo && p < c.hi) ?? calib.at(-1);
    b.n++;
    b.pred += p;
    b.won += x.kings.includes(pid) ? 1 / x.kings.length : 0;
  }
}

// Value record: bonus bets per token for each strategy, on promo nights with known payouts.
function valueRecord(list) {
  const nights = list.filter((x) => x.value && Object.values(x.value.returns).every((r) => r != null));
  const rec = {};
  for (const k of ["favorite", "value", "public"]) {
    rec[k] = { nights: nights.length, wins: nights.filter((x) => x.value.returns[k] > 0).length, total: nights.reduce((s, x) => s + x.value.returns[k], 0) };
  }
  return rec;
}
const entrantsList = out.map((x) => x.value?.entrants).filter((t) => t);

const result = {
  season,
  label: cur.label,
  model: M.MODEL,
  generated: new Date().toISOString(),
  holdoutFrom: HOLDOUT_FROM,
  summary: { fit: summary(out.filter((x) => !x.holdout)), holdout: summary(out.filter((x) => x.holdout)), all: summary(out) },
  calibration: calib.map((c) => ({ lo: c.lo, hi: c.hi, n: c.n, pred: c.n ? c.pred / c.n : null, actual: c.n ? c.won / c.n : null })),
  days: out.map(({ preds, ...x }) => x),
  valueRecord: valueRecord(out),
  // Entrants implied by winners' payouts (see impliedEntrants); predict.mjs uses the median
  // until this season has enough nights of its own.
  entrants: { median: M.median(entrantsList), nights: entrantsList.length },
};
result.names = M.nameMap(cur, [...new Set(out.flatMap((x) => [...x.kings, x.avgPick, ...x.top.map((t) => t.pid), ...Object.values(x.value?.picks ?? {})]))].filter(Boolean));
await writeFile(path.join(DATA_DIR, `backtest-${season}.json`), JSON.stringify(result));
const s = result.summary;
for (const k of ["fit", "holdout"]) {
  const x = s[k];
  console.log(`${k}: ${x.days} days, log loss ${x.logLoss.toFixed(3)} (no-skill ≈ ${x.uniformLogLoss.toFixed(2)}), King's avg chance ${(x.avgPKing * 100).toFixed(1)}%`);
  console.log(`   top pick won: model ${x.model.first}, best PRA avg ${x.avg.first}, highest projection ${x.mean.first} | King in model top 3: ${x.model.top3}, top 5: ${x.model.top5}`);
}
console.log("calibration:", result.calibration.map((c) => `${(c.lo * 100).toFixed(0)}–${(c.hi * 100).toFixed(0)}%: n=${c.n} pred ${c.pred == null ? "–" : (c.pred * 100).toFixed(1)} actual ${c.actual == null ? "–" : (c.actual * 100).toFixed(1)}`).join(" | "));
const vr = result.valueRecord;
console.log(`value record (${vr.favorite.nights} promo nights with known payouts): ${Object.entries(vr).map(([k, r]) => `${k} ${r.wins} wins $${Math.round(r.total).toLocaleString()}`).join(" | ")} · entrants median ${Math.round(result.entrants.median).toLocaleString()} (${result.entrants.nights} nights)`);
