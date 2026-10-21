#!/usr/bin/env node
// Fits the public pick-share model (MODEL.share in model.js) on nights where DK published every
// player's would-be payout (data/pickshare-<season>.json), then checks it against last season's
// winners' payouts. Prints the coefficients; copy them into model.js by hand.
//
//   node scripts/fit-share.mjs [season]     # default 2025 (prior = season − 1)
//
// Win chances come from the same replay as the backtest: games before the night, and the players
// who actually played as the candidate list.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const M = require("../model.js");
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const load = async (f) => JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8"));

const season = Number(process.argv.slice(2).find((a) => /^\d{4}$/.test(a)) ?? 2025);
const cur = await load(`${season}.json`);
const prior = M.priorTotals(M.rowObjects(await load(`${season - 1}.json`)));
const rows = M.rowObjects(cur);
const pickshare = await load(`pickshare-${season}.json`);
const promos = (await load(`promos-${season}.json`)).promos;

// The field for one night: every player who played, with the model's win chance and the public features.
function night(d) {
  const games = [...new Set(rows.filter((r) => r.d === d).map((r) => r.gid))].map((gid) => ({ gid, ...cur.games[gid] }));
  const cands = rows.filter((r) => r.d === d).map((r) => ({ pid: r.pid, tm: r.tm, pPlay: 1 }));
  const hist = M.historyBefore(rows, d);
  const ctx = M.contextBefore(rows, cur.games, prior, (pid) => cur.players[pid]?.pos, d);
  return M.predictDay(d, games, cands, hist, prior, M.MODEL, M.MODEL.sims, ctx).map((p) => ({ ...p, ...M.shareFeatures(hist[p.pid], prior[p.pid]) }));
}

const nights = pickshare.nights.filter((n) => !n.partial).map((n) => {
  const field = night(n.date);
  const bettors = Object.fromEntries(n.payouts.map((p) => [p.pid, n.pool / p.payout]));
  return { ...n, field, counts: field.map((p) => bettors[p.pid] ?? 0), total: Object.values(bettors).reduce((a, b) => a + b, 0) };
});
if (!nights.length) throw new Error("no full pick-share nights to fit on");

// Log-likelihood per entrant of the observed picks under share parameters `s`.
function ll(s) {
  let sum = 0, n = 0;
  for (const x of nights) {
    const shares = M.pickShares(x.field, { ...M.MODEL, share: { ...M.MODEL.share, ...s } });
    x.field.forEach((p, i) => {
      if (x.counts[i]) sum += x.counts[i] * Math.log(shares[i]);
    });
    n += x.total;
  }
  return sum / n;
}
// Coordinate search: simple and plenty for three parameters.
function fit(keys) {
  let s = Object.fromEntries(keys.map((k) => [k, 0.1]));
  let step = 0.05;
  for (let it = 0; it < 5000 && step > 1e-5; it++) {
    let improved = false;
    for (const k of keys)
      for (const d of [step, -step]) {
        const c = { ...s, [k]: s[k] + d };
        if (ll(c) > ll(s)) {
          s = c;
          improved = true;
        }
      }
    if (!improved) step /= 2;
  }
  return s;
}

console.log(`Fitting on ${nights.map((n) => n.date).join(", ")} (${Math.round(nights.reduce((s, n) => s + n.total, 0)).toLocaleString()} picks)`);
const zero = { bWin: 0, bSeason: 0, bPrior: 0 };
const variants = {
  "win only": fit(["bWin"]),
  "averages only": { bWin: 0, ...fit(["bSeason", "bPrior"]) },
  "win + averages": fit(["bWin", "bSeason", "bPrior"]),
};
console.log(`  even split (no info)  log-lik/pick ${ll(zero).toFixed(4)}`);
for (const [k, s] of Object.entries(variants)) {
  console.log(`  ${k.padEnd(20)} log-lik/pick ${ll({ ...zero, ...s }).toFixed(4)}  ${Object.entries(s).map(([a, b]) => `${a}=${b.toFixed(3)}`).join(" ")}`);
}
const best = { ...zero, ...variants["win + averages"] };
const model = { ...M.MODEL, share: { ...M.MODEL.share, ...best } };

for (const x of nights) {
  const shares = M.pickShares(x.field, model);
  const list = x.field.map((p, i) => ({ p, est: shares[i], act: x.counts[i] / x.total })).sort((a, b) => b.act - a.act);
  console.log(`\n${x.date}: est vs actual pick share, top 12 (value = win ÷ est share)`);
  for (const r of list.slice(0, 12)) {
    console.log(`  ${cur.players[r.p.pid].name.padEnd(24)} est ${(r.est * 100).toFixed(1).padStart(5)}%  actual ${(r.act * 100).toFixed(1).padStart(5)}%  win ${(r.p.win * 100).toFixed(1).padStart(5)}%  value ${(r.p.win / r.est).toFixed(2)}`);
  }
}

// Winners' payouts: entrants implied by each night's winner, with this share model.
console.log("\nEntrants implied by winners' payouts (only when the winners' est share ≥ 5%):");
const implied = [];
for (const p of promos) {
  if (p.format !== "king" || !p.winners.some((w) => w.payout)) continue;
  const field = night(p.date);
  const shares = M.pickShares(field, model);
  const shareOf = (pid) => shares[field.findIndex((f) => f.pid === pid)];
  const t = M.impliedEntrants(p, shareOf, model);
  const s = p.winners.reduce((a, w) => a + (shareOf(w.pid) ?? 0), 0);
  console.log(`  ${p.date} ${p.winners.map((w) => w.name).join(" + ").padEnd(36)} est share ${(s * 100).toFixed(1).padStart(5)}%  ${t ? `→ ${Math.round(t).toLocaleString()} entrants` : "(skipped)"}`);
  if (t) implied.push(t);
}
console.log(`median ${Math.round(M.median(implied)).toLocaleString()} over ${implied.length} nights`);
console.log(`\nPaste into MODEL.share: bWin: ${best.bWin.toFixed(3)}, bSeason: ${best.bSeason.toFixed(3)}, bPrior: ${best.bPrior.toFixed(3)}`);
