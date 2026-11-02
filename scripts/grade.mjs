#!/usr/bin/env node
// Grades locked predictions once every game that day is final: who the King was (box-score PRA
// leader, ties included), the chance the model gave them and where it ranked them.
// Run after build-data.mjs.

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const M = require("../model.js");
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const readJson = async (f) => JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8"));

const { current: season } = await readJson("seasons.json");
const file = path.join(DATA_DIR, `predictions-${season}.json`);
let store;
try {
  store = JSON.parse(await readFile(file, "utf8"));
} catch {
  console.log("no predictions yet");
  process.exit(0);
}
const data = await readJson(`${season}.json`);
let promos = null;
try {
  promos = await readJson(`promos-${season}.json`);
} catch {}
let pickshare = null;
try {
  pickshare = await readJson(`pickshare-${season}.json`);
} catch {}
const gameDays = [...new Set(Object.values(data.games).map((g) => g.d))];
// Every player who played, ranked by PRA, so a pick's finish can be shown however far down it was.
const leaders = Object.fromEntries(M.dailyLeaders(data, Infinity).map((x) => [x.d, x]));
const chalk = await readJson("chalk.json");

// How each of the night's locked picks did. `ret` = bonus bets one token won (0 = lost; null = a
// winner whose payout isn't entered yet, or a Three Kings night, which the record leaves out).
// `would` = what a losing pick would have paid: DK's "what could've been" number when the night's list
// has the player, else the prediction's own estimate (`wouldEst`).
function pickResults(p, day, promo) {
  const paid = promo.winners ?? [];
  const listed = pickshare?.nights?.find((n) => n.date === day.d)?.payouts ?? [];
  return p.picks.map((pid) => {
    const row = day.top.find((r) => r.pid === pid);
    const pred = p.players.find((x) => x.pid === pid);
    const won = paid.length ? paid.some((w) => w.pid === pid) : day.kings.includes(pid);
    const out = { pid, tm: pred?.tm ?? row?.tm ?? null, pra: row?.pra ?? null, won };
    if (row) {
      out.finish = 1 + day.top.filter((r) => r.pra > row.pra).length;
      if (day.top.filter((r) => r.pra === row.pra).length > 1) out.tied = true;
    }
    out.ret = promo.format !== "king" ? null : won ? paid.find((w) => w.pid === pid)?.payout ?? null : 0;
    if (!won) {
      const dk = listed.find((x) => x.pid === pid)?.payout;
      if (dk != null) out.would = dk;
      else if (pred?.estPayout != null) Object.assign(out, { would: Math.round(pred.estPayout), wouldEst: true });
    }
    return out;
  });
}

let graded = 0;
for (const [d, p] of Object.entries(store.days)) {
  const day = leaders[d];
  if (!day?.final) continue;
  const idx = (pid) => p.players.findIndex((x) => x.pid === pid);
  const ranks = day.kings.map(idx).filter((i) => i >= 0);
  const result = {
    kings: day.kings,
    kingPra: day.top[0].pra,
    pKing: day.kings.reduce((s, pid) => s + (p.players[idx(pid)]?.win ?? 0), 0),
    rank: ranks.length ? Math.min(...ranks) + 1 : null, // null = outside the saved list
    pick: p.players[0]?.pid ?? null,
  };
  // Value record: what a token on each strategy's pick won, once the night's payouts are entered.
  const promo = M.promoInfo(promos, d, gameDays);
  if (promo && p.players.some((x) => x.share != null)) {
    const picks = M.valuePicks(p.players, chalk);
    const returns = Object.fromEntries(Object.entries(picks).map(([k, pid]) => [k, M.pickReturn(pid, promo)]));
    // A strategy with no pick that night (no one filling in) has a null return and sits it out.
    if (returns.favorite != null) result.value = { picks, returns };
    const t = M.impliedEntrants(promo, (pid) => p.players.find((x) => x.pid === pid)?.share);
    if (t) result.entrants = Math.round(t);
  }
  if (promo && p.picks?.length) result.picks = pickResults(p, day, promo);
  if (JSON.stringify(p.result) !== JSON.stringify(result)) {
    p.result = result;
    graded++;
  }
}
for (const pid of Object.values(store.days).flatMap((x) => x.result?.kings ?? [])) {
  if (!store.names?.[pid]) Object.assign((store.names ??= {}), M.nameMap(data, [pid]));
}
await writeFile(file, JSON.stringify(store));
console.log(`graded ${graded} day(s)`);
