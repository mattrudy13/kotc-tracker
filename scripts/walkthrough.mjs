#!/usr/bin/env node
// Builds the data for the How it works page (how.html): one real promo night, rerun on the current
// model, with every number each round shows. Writes data/walkthrough-<date>.json.
//
//   node scripts/walkthrough.mjs                       # Tue Nov 10, 2026 (the page's example)
//   node scripts/walkthrough.mjs --date 2026-11-10 --ref 5d34d2d --focus 4566434
//
// --ref is the data commit the night's locked prediction was made from: its data/<season>.json holds
// that evening's rosters and injury report, so the rerun sees exactly what the model saw. The script
// checks itself by rerunning the saved model version first and comparing with the saved prediction.

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const M = require("../model.js");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const readJson = async (f) => JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8"));
const gitJson = (ref, f) => JSON.parse(execFileSync("git", ["show", `${ref}:data/${f}`], { cwd: ROOT, maxBuffer: 64 << 20 }).toString());

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const date = arg("date", "2026-11-10");
const ref = arg("ref", "5d34d2d");
const focus = arg("focus", "4566434"); // Franz Wagner: followed through rounds 1–3, revealed in round 7
const star = arg("star", "3032977"); // Giannis: the favorite, for comparison
const THRESHOLD = 50; // round 3's "winning night"; last season's King had 51+ in 3 nights of 4

const { current: season } = await readJson("seasons.json");
const data = gitJson(ref, `${season}.json`);
const chalk = gitJson(ref, "chalk.json");
const prevData = await readJson(`${season - 1}.json`);
const promos = await readJson(`promos-${season}.json`);
const store = await readJson(`predictions-${season}.json`);
const leaders = await readJson(`leaders-${season}.json`);
const backtest = await readJson(`backtest-${season - 1}.json`);
const saved = store.days[date];
if (!saved) throw new Error(`no saved prediction for ${date}`);

// ---- The night's inputs, as predict.mjs built them from the data at --ref ----
const games = Object.entries(data.games).filter(([, g]) => g.d === date).map(([gid, g]) => ({ gid, ...g }));
const playing = new Set(games.flatMap((g) => [g.home, g.away]));
const candidates = [];
for (const tm of playing) {
  for (const pid of data.rosters?.[tm] ?? []) {
    const pPlay = M.playChance(data.players[pid]?.injury);
    if (pPlay > 0) candidates.push({ pid, tm, pPlay });
  }
}
const rows = M.rowObjects(data);
const prior = M.priorTotals(M.rowObjects(prevData));
const hist = M.historyBefore(rows, date);
const ctx = () => M.contextBefore(rows, data.games, prior, (pid) => data.players[pid]?.pos, date);
const promo = M.promoInfo(promos, date, null);
const entrants = saved.entrants?.n;
const featsOf = (pid) => M.shareFeatures(hist[pid], prior[pid]);

function run(model, trace = null) {
  const preds = M.predictDay(date, games, candidates, hist, prior, model, model.sims, ctx(), trace);
  M.addValue(preds, featsOf, promo, entrants, model);
  return preds;
}

// Self-check: the saved model version must reproduce the saved prediction.
const savedModel = { ...M.MODEL, version: saved.modelVersion, skew: saved.modelVersion >= 3 ? M.MODEL.skew : 0 };
const check = run(savedModel);
let worst = 0;
for (const s of saved.players) {
  const p = check.find((x) => x.pid === s.pid);
  worst = Math.max(worst, Math.abs((p?.win ?? 0) - s.win), Math.abs((p?.mean ?? 0) - s.mean) / 100);
}
console.log(`self-check vs saved v${saved.modelVersion}: largest gap ${(worst * 100).toFixed(2)} points`);
if (worst > 0.002) throw new Error("rerun doesn't match the saved prediction; check --ref");

// ---- The rerun on the current model, with every simulated night traced ----
const trace = [];
const preds = run(M.MODEL, trace);
const byPid = Object.fromEntries(preds.map((p) => [p.pid, p]));
const savedBy = Object.fromEntries(saved.players.map((p) => [p.pid, p]));
const r1 = (x, d = 1) => +x.toFixed(d);

// Players the page names: everyone who won at least one simulated night, plus the saved list.
const field = preds.filter((p) => p.win > 0 || savedBy[p.pid]);
const contenders = field.map((p) => p.pid);
const idx = Object.fromEntries(contenders.map((pid, i) => [pid, i]));
// Winners as one character per night (index into `contenders`), plus the night's top PRA; ties
// (a split win) are listed apart.
const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
if (contenders.length > ALPHA.length) throw new Error("too many contenders to encode");
const ties = [];
let w = "", t = [];
trace.forEach((night, s) => {
  const ids = night.w.map((pid) => idx[pid] ?? -1);
  if (ids.some((i) => i < 0)) throw new Error(`a night's winner isn't in the field (night ${s})`);
  w += ALPHA[ids[0]];
  t.push(night.top);
  if (ids.length > 1) ties.push([s, ...ids]);
});

// Round 1: the focus player's projection.
const fh = hist[focus] ?? [];
const fp = prior[focus];
const proj = M.projectPlayer(fh, fp);
const game = games.find((g) => g.home === byPid[focus].tm || g.away === byPid[focus].tm);
const pace = game.total ? Math.pow(game.total / M.MODEL.totalAvg, M.MODEL.paceExp) : 1;
const f = byPid[focus];
const baseline = M.missBaseline(ctx(), focus);

// Round 7: the actual night.
const day = leaders.days.find((x) => x.d === date);
const paid = promo.winners?.[0];

const out = {
  date,
  ref,
  takenAt: saved.takenAt,
  generated: new Date().toISOString(),
  pool: promo.pool,
  games: games.length,
  slate: games.map((g) => ({ home: g.home, away: g.away, total: g.total, spread: g.spread })),
  entrants,
  model: { version: M.MODEL.version, savedVersion: saved.modelVersion, shareVersion: M.MODEL.share.version, sims: M.MODEL.sims, skew: M.MODEL.skew, sd0: M.MODEL.sd0, sd1: M.MODEL.sd1, gameSd: M.MODEL.gameSd, dtdPlay: M.MODEL.dtdPlay, teamK: M.MODEL.teamK, halfLife: M.MODEL.halfLife },
  focus,
  star,
  names: Object.fromEntries([...new Set([...contenders, ...(day?.top ?? []).map((x) => x.pid), f.bumpIf?.pid].filter(Boolean))].map((pid) => [pid, data.players[pid]?.name ?? store.names?.[pid]?.n ?? pid])),
  field: field.map((p) => ({
    pid: p.pid, tm: p.tm, opp: p.opp, mean: r1(p.mean), sd: r1(p.sd, 2), pPlay: p.pPlay,
    win: r1(p.win, 4), savedWin: savedBy[p.pid]?.win ?? null,
    share: r1(p.share, 5), value: r1(p.value, 3), chalk: M.isChalk(p, chalk) || undefined,
    rookie: featsOf(p.pid).rookie || undefined, season: r1(featsOf(p.pid).season),
  })),
  // Pick shares of everyone else (the long tail outside `field`), so the crowd adds up to 100%.
  restShare: r1(1 - field.reduce((s, p) => s + p.share, 0), 4),
  sim: { contenders, w, t: t.join(","), ties },
  projection: {
    games: fh.map((g, i) => ({ d: g.d, opp: g.opp, min: g.min, pra: g.pra, w: r1(Math.pow(0.5, i / M.MODEL.halfLife), 3) })),
    prior: fp ? { gp: fp.gp, min: r1(fp.min / fp.gp), rate: r1(fp.pra / fp.min, 3), pra: r1(fp.pra / fp.gp) } : null,
    min: r1(proj.min), rate: r1(proj.rate, 3),
    minPriorGames: M.MODEL.minPriorGames, ratePriorMin: M.MODEL.ratePriorMin,
  },
  context: {
    raw: r1(proj.min * proj.rate, 2), total: game.total, pace: r1(pace, 3),
    def: r1(f.def, 3), bump: r1(f.bump, 3), mean: r1(f.mean, 2),
    outShare: r1(baseline + (f.bump - 1) / M.MODEL.teamK, 3), baseline: r1(baseline, 3),
    bumpIf: f.bumpIf ? { pid: f.bumpIf.pid, pct: r1(f.bumpIf.pct, 3), pPlay: byPid[f.bumpIf.pid]?.pPlay ?? null } : null,
  },
  noise: {
    threshold: THRESHOLD,
    kingPra: (() => {
      const k = backtest.days.map((x) => x.kingPra).sort((a, b) => a - b);
      const q = (p) => k[Math.floor((k.length - 1) * p)];
      return { p25: q(0.25), median: q(0.5), p75: q(0.75), nights: k.length, label: backtest.label };
    })(),
  },
  picks: {
    rerun: M.topPicks(preds, promo, chalk).map((p) => p.pid),
    locked: saved.picks,
    valueMinWin: M.MODEL.valueMinWin,
    chalkCutoff: chalk.shareCutoff,
    chalkList: chalk.players.map((p) => p.pid),
  },
  result: {
    kings: day.kings,
    top: day.top.map((x) => ({ pid: x.pid, tm: x.tm, pra: x.pra, mean: byPid[x.pid] ? r1(byPid[x.pid].mean) : null, win: byPid[x.pid] ? r1(byPid[x.pid].win, 4) : null })),
    payout: paid?.payout ?? null,
    bettors: paid?.payout ? Math.round(promo.pool / paid.payout) : null,
    savedPicks: saved.result?.picks ?? [],
    savedRank: saved.result?.rank ?? null,
    rank: preds.findIndex((p) => p.pid === day.kings[0]) + 1,
  },
  checked: {
    label: backtest.label,
    holdoutFrom: backtest.holdoutFrom,
    holdoutDays: backtest.summary.holdout.days,
    fitDays: backtest.summary.fit.days,
    uniform: r1(backtest.summary.holdout.uniformLogLoss, 3),
    versions: [
      { label: "v1", note: "base", ll: r1(backtest.ablation.variants.v1.holdout.ll, 3) },
      { label: "v2", note: "+ context", ll: r1(backtest.ablation.variants.normal.holdout.ll, 3) },
      { label: "v3", note: "+ lean", ll: r1(backtest.ablation.variants.both.holdout.ll, 3) },
    ],
    firsts: { model: backtest.summary.holdout.model.first, avg: backtest.summary.holdout.avg.first, days: backtest.summary.holdout.days },
    calibration: backtest.calibration.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, pred: r1(b.pred, 4), actual: r1(b.actual, 4) })),
  },
};

const file = `walkthrough-${date}.json`;
await writeFile(path.join(DATA_DIR, file), JSON.stringify(out));
const name = (pid) => out.names[pid] ?? pid;
console.log(`wrote data/${file}: ${field.length} players, ${trace.length} nights, ${ties.length} split nights`);
console.log(`v3: ${preds.slice(0, 5).map((p) => `${name(p.pid)} ${(p.win * 100).toFixed(1)}%`).join(", ")}`);
console.log(`v3 picks: ${out.picks.rerun.map(name).join(", ")} · locked (v${saved.modelVersion}): ${out.picks.locked.map(name).join(", ")}`);
console.log(`winner ${name(day.kings[0])}: v3 rank ${out.result.rank}, ${(byPid[day.kings[0]].win * 100).toFixed(1)}% (saved ${(savedBy[day.kings[0]].win * 100).toFixed(1)}%)`);
