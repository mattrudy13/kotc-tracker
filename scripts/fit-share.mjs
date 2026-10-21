#!/usr/bin/env node
// Fits the public pick-share model (MODEL.share in model.js) on DK's "what could've been" payout
// lists (data/pickshare-<season>.json), then checks it against last season's winners' payouts.
// Prints the coefficients; copy them into model.js by hand.
//
//   node scripts/fit-share.mjs [season]               # default 2025 (prior = season − 1)
//   node scripts/fit-share.mjs --with-mostbet         # also fit on "top 20 most-bet" lists
//
// Bettors on a player = pool ÷ payout. A full list (everyone anyone picked) is fitted over the whole
// field. A partial list only says how the listed players split their picks among themselves, so it's
// fitted on those shares alone (a conditional likelihood). That's fair when DK chose the players by the
// game's result ("top PRA" lists), not by the picks; "most-bet" lists are chosen by the picks, so they're
// left out unless --with-mostbet. Three Kings nights are left out (picks there chase top-3 chances).
//
// Variants add inputs to the base model (win chance, season PRA average, last season's average) and are
// compared on nights left out of the fit (leave one night out), so a variant can't win by memorizing.
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

const args = process.argv.slice(2);
const season = Number(args.find((a) => /^\d{4}$/.test(a)) ?? 2025);
const withMostBet = args.includes("--with-mostbet");
const cur = await load(`${season}.json`);
const prior = M.priorTotals(M.rowObjects(await load(`${season - 1}.json`)));
const rows = M.rowObjects(cur);
const pickshare = await load(`pickshare-${season}.json`);
const promos = (await load(`promos-${season}.json`)).promos;
const posOf = (pid) => cur.players[pid]?.pos;

// The field for one night: every player who played, with the model's win chance and the public features.
function night(d) {
  const games = [...new Set(rows.filter((r) => r.d === d).map((r) => r.gid))].map((gid) => ({ gid, ...cur.games[gid] }));
  const cands = rows.filter((r) => r.d === d).map((r) => ({ pid: r.pid, tm: r.tm, pPlay: 1 }));
  const hist = M.historyBefore(rows, d);
  const ctx = M.contextBefore(rows, cur.games, prior, posOf, d);
  return M.predictDay(d, games, cands, hist, prior, M.MODEL, M.MODEL.sims, ctx).map((p) => ({ ...p, ...M.shareFeatures(hist[p.pid], prior[p.pid]) }));
}

const skipped = [];
const nights = pickshare.nights
  .filter((n) => {
    const format = promos.find((p) => p.date === n.date)?.format;
    const why = format === "three" ? "Three Kings" : n.partial && n.list === "mostBet" && !withMostBet ? "most-bet list" : null;
    if (why) skipped.push(`${n.date} (${why})`);
    return !why;
  })
  .map((n) => {
    const field = night(n.date);
    const at = Object.fromEntries(field.map((p, i) => [p.pid, i]));
    const listed = n.payouts.filter((p) => at[p.pid] != null).map((p) => ({ i: at[p.pid], count: n.pool / p.payout }));
    const X = field.map(M.shareX);
    // Full list: everyone in the field counts (unlisted = nobody picked them). Partial: listed only.
    const set = n.partial ? listed.map((l) => l.i) : field.map((_, i) => i);
    return { date: n.date, partial: !!n.partial, field, X, set, listed, total: listed.reduce((s, l) => s + l.count, 0) };
  });
if (!nights.length) throw new Error("no payout lists to fit on");

const K = M.SHARE_KEYS.length;
const dot = (b, x) => x.reduce((s, v, i) => s + b[i] * v, 0);

// Log-likelihood of one night's picks (summed over picks), its gradient and Hessian, under coefficients b.
function nightStats(n, b) {
  const z = n.set.map((i) => dot(b, n.X[i]));
  const mx = Math.max(...z);
  const w = z.map((v) => Math.exp(v - mx));
  const W = w.reduce((s, v) => s + v, 0);
  const pr = w.map((v) => v / W);
  const pos = Object.fromEntries(n.set.map((i, j) => [i, j]));
  const mean = Array(K).fill(0);
  n.set.forEach((i, j) => n.X[i].forEach((v, k) => (mean[k] += pr[j] * v)));
  let ll = 0;
  const g = Array(K).fill(0);
  for (const l of n.listed) {
    const j = pos[l.i];
    if (j == null) continue;
    ll += l.count * Math.log(pr[j]);
    n.X[l.i].forEach((v, k) => (g[k] += l.count * (v - mean[k])));
  }
  const H = Array.from({ length: K }, () => Array(K).fill(0));
  n.set.forEach((i, j) => {
    const d = n.X[i].map((v, k) => v - mean[k]);
    for (let a = 0; a < K; a++) for (let c = 0; c < K; c++) H[a][c] -= n.total * pr[j] * d[a] * d[c];
  });
  return { ll, g, H };
}

function solve(A, y) {
  const n = y.length, a = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !a[c][c]) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((r, i) => (r[i] ? r[n] / r[i] : 0));
}

// Newton's method on the (concave) log-likelihood, over the coefficients in `keys` (others fixed at 0).
function fit(list, keys) {
  const idx = keys.map((k) => M.SHARE_KEYS.indexOf(k));
  let b = Array(K).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = Array(K).fill(0), H = Array.from({ length: K }, () => Array(K).fill(0));
    let ll = 0;
    for (const n of list) {
      const s = nightStats(n, b);
      ll += s.ll;
      for (let a = 0; a < K; a++) {
        g[a] += s.g[a];
        for (let c = 0; c < K; c++) H[a][c] += s.H[a][c];
      }
    }
    const step = solve(idx.map((a) => idx.map((c) => -H[a][c])), idx.map((a) => g[a]));
    // Halve the step until the likelihood goes up (keeps Newton stable).
    let t = 1, next;
    for (; t > 1e-4; t /= 2) {
      next = [...b];
      idx.forEach((a, j) => (next[a] += t * step[j]));
      if (list.reduce((s, n) => s + nightStats(n, next).ll, 0) >= ll) break;
    }
    const moved = idx.reduce((s, a) => s + Math.abs(next[a] - b[a]), 0);
    b = next;
    if (moved < 1e-7) break;
  }
  return Object.fromEntries(M.SHARE_KEYS.map((k, i) => [k, b[i]]));
}

const perPick = (list, s) => list.reduce((a, n) => a + nightStats(n, M.SHARE_KEYS.map((k) => s[k] ?? 0)).ll, 0) / list.reduce((a, n) => a + n.total, 0);
// Leave one night out: fit on the others, score the night left out. Summed over nights, per pick.
function holdout(keys) {
  let ll = 0, picks = 0;
  for (const n of nights) {
    const s = fit(nights.filter((x) => x !== n), keys);
    ll += nightStats(n, M.SHARE_KEYS.map((k) => s[k] ?? 0)).ll;
    picks += n.total;
  }
  return ll / picks;
}

console.log(`Fitting on ${nights.length} nights (${nights.filter((n) => !n.partial).length} full, ${nights.filter((n) => n.partial).length} partial), ${Math.round(nights.reduce((s, n) => s + n.total, 0)).toLocaleString()} picks`);
if (skipped.length) console.log(`Left out: ${skipped.join(", ")}`);
const base = ["bWin", "bSeason", "bPrior"];
const variants = {
  "win only": ["bWin"],
  "base (win + averages)": base,
  "base + form": [...base, "bForm"],
  "base + rookie": [...base, "bRookie"],
  "base + form + rookie": [...base, "bForm", "bRookie"],
};
const live = M.MODEL.share;
console.log(`\nLog-likelihood per pick (higher is better). "Held out" = each night scored by a fit on the other nights.`);
console.log(`  ${"live MODEL.share (fit on 11/18/25 only)".padEnd(40)} all nights ${perPick(nights, live).toFixed(4)}`);
const fits = {};
for (const [name, keys] of Object.entries(variants)) {
  const s = (fits[name] = fit(nights, keys));
  console.log(`  ${name.padEnd(40)} all nights ${perPick(nights, s).toFixed(4)}  held out ${holdout(keys).toFixed(4)}  ${keys.map((k) => `${k}=${s[k].toFixed(3)}`).join(" ")}`);
}

// Per night: how the best variant and the live model do, held out.
const bestName = Object.keys(variants).reduce((a, b) => (holdout(variants[b]) > holdout(variants[a]) ? b : a));
const best = fits[bestName];
console.log(`\nBest held-out variant: ${bestName}`);
console.log("Per night, held out (log-lik per pick): live vs best");
for (const n of nights) {
  const s = fit(nights.filter((x) => x !== n), variants[bestName]);
  const v = (c) => nightStats(n, M.SHARE_KEYS.map((k) => c[k] ?? 0)).ll / n.total;
  console.log(`  ${n.date}${n.partial ? " (partial)" : " (full)   "}  live ${v(live).toFixed(3)}  best ${v(s).toFixed(3)}`);
}

// Biggest misses under the best fit: listed players picked far more (or less) than estimated.
const misses = [];
for (const n of nights) {
  const z = n.set.map((i) => Math.exp(dot(M.SHARE_KEYS.map((k) => best[k] ?? 0), n.X[i])));
  const Z = z.reduce((a, b) => a + b, 0);
  const pos = Object.fromEntries(n.set.map((i, j) => [i, j]));
  for (const l of n.listed) if (l.count >= 1000) misses.push({ d: n.date, pid: n.field[l.i].pid, act: l.count / n.total, est: z[pos[l.i]] / Z });
}
misses.sort((a, b) => Math.abs(Math.log(b.act / b.est)) - Math.abs(Math.log(a.act / a.est)));
console.log("\nBiggest misses with the best fit (1,000+ bettors; actual ÷ estimated share among the listed):");
for (const x of misses.slice(0, 12)) console.log(`  ${x.d} ${(cur.players[x.pid]?.name ?? x.pid).padEnd(24)} actual ${(x.act * 100).toFixed(1).padStart(5)}%  est ${(x.est * 100).toFixed(1).padStart(5)}%  ×${(x.act / x.est).toFixed(2)}`);

// Winners' payouts: entrants implied by each night's winner, with the best share model.
console.log("\nEntrants implied by winners' payouts (only when the winners' est share ≥ 5%):");
const model = { ...M.MODEL, share: { ...M.MODEL.share, ...Object.fromEntries(M.SHARE_KEYS.map((k) => [k, best[k] ?? 0])) } };
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
console.log(`\nPaste into MODEL.share: ${M.SHARE_KEYS.map((k) => `${k}: ${(best[k] ?? 0).toFixed(3)}`).join(", ")}`);
