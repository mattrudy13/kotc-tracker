#!/usr/bin/env node
// Writes the model's predictions for today's slate and the next promo day into
// data/predictions-<season>.json. A day's prediction is rewritten on every run until its first
// game tips off, then it's locked: that last pre-tip version is the one graded.
//
//   node scripts/predict.mjs
//   NOW=2026-10-21T20:00:00Z node scripts/predict.mjs   # pretend it's another time (testing)

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const M = require("../model.js");
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const readJson = async (f, fallback) => {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8"));
  } catch {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing data/${f}`);
  }
};

const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
const today = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const { current: season } = await readJson("seasons.json");
const data = await readJson(`${season}.json`);
const prevData = await readJson(`${season - 1}.json`);
const promos = await readJson(`promos-${season}.json`, null);
const file = `predictions-${season}.json`;
const store = await readJson(file, { season, days: {} });

const byDay = {};
for (const [gid, g] of Object.entries(data.games)) (byDay[g.d] ??= []).push({ gid, ...g });
const gameDays = Object.keys(byDay).sort();
const isPromo = (d) => M.promoInfo(promos, d, gameDays) != null;
const targets = new Set();
if (byDay[today]) targets.add(today);
const nextPromo = gameDays.find((d) => d >= today && isPromo(d));
if (nextPromo) targets.add(nextPromo);

const rows = M.rowObjects(data);
const prior = M.priorTotals(M.rowObjects(prevData));

// Entrants per promo night, for the dollar estimates: this season's own nights once there are 3,
// else last season's backtest median.
const ownEntrants = Object.values(store.days).map((x) => x.result?.entrants).filter((t) => t);
const lastBacktest = await readJson(`backtest-${season - 1}.json`, null);
const entrants = ownEntrants.length >= 3
  ? { n: Math.round(M.median(ownEntrants)), source: `${ownEntrants.length} nights this season` }
  : lastBacktest?.entrants?.median
    ? { n: Math.round(lastBacktest.entrants.median), source: `${lastBacktest.label} median (${lastBacktest.entrants.nights} nights)` }
    : null;

for (const d of [...targets].sort()) {
  const games = byDay[d];
  const firstTip = games.map((g) => g.tip).sort()[0];
  if (now >= new Date(firstTip) || games.some((g) => g.state !== "pre")) {
    console.log(`${d}: locked (first tip ${firstTip})`);
    continue;
  }
  const playing = new Set(games.flatMap((g) => [g.home, g.away]));
  const candidates = [];
  for (const tm of playing) {
    for (const pid of data.rosters?.[tm] ?? []) {
      const pPlay = M.playChance(data.players[pid]?.injury);
      if (pPlay > 0) candidates.push({ pid, tm, pPlay });
    }
  }
  const hist = M.historyBefore(rows, d);
  const ctx = M.contextBefore(rows, data.games, prior, (pid) => data.players[pid]?.pos, d);
  const preds = M.predictDay(d, games, candidates, hist, prior, M.MODEL, M.MODEL.sims, ctx);
  const promo = M.promoInfo(promos, d, gameDays);
  // Value is only meaningful on promo nights; shares are computed over the whole field.
  if (promo) M.addValue(preds, (pid) => M.shareFeatures(hist[pid], prior[pid]), promo, entrants?.n);
  const out = data.players;
  const prev = store.days[d];
  store.days[d] = {
    takenAt: now.toISOString(),
    firstTip,
    promo: isPromo(d),
    games: games.length,
    slate: games.map((g) => ({ gid: g.gid, home: g.home, away: g.away, tip: g.tip, spread: g.spread, total: g.total })),
    modelVersion: M.MODEL.version,
    ...(promo ? { shareVersion: M.MODEL.share.version, entrants, pool: promo.pool, format: promo.format } : {}),
    // Keep everyone with a real chance plus the next few, so the page can show a top 25.
    players: preds.slice(0, Math.max(25, preds.filter((p) => p.win >= 0.001).length)).map((p) => ({
      pid: p.pid, tm: p.tm, opp: p.opp, home: p.home,
      mean: +p.mean.toFixed(1), min: +p.min.toFixed(1), win: +p.win.toFixed(4), top3: +p.top3.toFixed(4),
      pPlay: p.pPlay, gp: p.gp, isNew: p.isNew || undefined,
      inj: out[p.pid]?.injury?.status ?? undefined,
      // Context (v2): teammates-out bump, the bump if a questionable teammate sits, opponent defense.
      bump: Math.abs(p.bump - 1) >= 0.005 ? +p.bump.toFixed(3) : undefined,
      outPct: p.outPct >= 0.005 ? +p.outPct.toFixed(3) : undefined,
      bumpIf: p.bumpIf && p.bumpIf.pct >= 0.005 ? { pid: p.bumpIf.pid, pct: +p.bumpIf.pct.toFixed(3) } : undefined,
      def: Math.abs(p.def - 1) >= 0.005 ? +p.def.toFixed(3) : undefined,
      ...(promo
        ? { share: +p.share.toFixed(5), value: +p.value.toFixed(3), estPayout: p.estPayout != null ? Math.round(p.estPayout) : null, ev: p.ev != null ? +p.ev.toFixed(2) : null }
        : {}),
    })),
    // How many players the best-value list leaves out as long shots (value above 1 but win < 2%).
    ...(promo ? { longShots: preds.filter((p) => p.win > 0 && p.win < M.MODEL.valueMinWin && p.value > 1).length } : {}),
    // Only rotation players (15+ projected minutes) are worth naming as ruled out.
    out: Object.entries(out)
      .filter(([pid, p]) => playing.has(p.team) && M.playChance(p.injury) === 0 && (prior[pid]?.gp || hist[pid]?.length) && M.projectPlayer(hist[pid], prior[pid]).min >= 15)
      .map(([pid, p]) => ({ pid, tm: p.team, detail: p.injury?.detail ?? null })),
  };
  // Nothing changed since the last run: keep its timestamp so the data commit is skipped.
  if (prev && JSON.stringify({ ...prev, takenAt: 0 }) === JSON.stringify({ ...store.days[d], takenAt: 0 })) store.days[d] = prev;
  const top = store.days[d].players.slice(0, 3).map((p) => `${out[p.pid]?.name} ${(p.win * 100).toFixed(1)}%`);
  console.log(`${d}: ${games.length} games, ${candidates.length} players · ${top.join(", ")}`);
}

// Names and teams for every player the page shows (graded days included).
const pids = new Set();
for (const day of Object.values(store.days)) {
  for (const p of day.players) {
    pids.add(p.pid);
    if (p.bumpIf) pids.add(p.bumpIf.pid);
  }
  for (const p of day.out ?? []) pids.add(p.pid);
  for (const pid of day.result?.kings ?? []) pids.add(pid);
}
store.names = M.nameMap(data, [...pids]);
store.teams = data.teams;
store.updated = now.toISOString();
await writeFile(path.join(DATA_DIR, file), JSON.stringify(store));
