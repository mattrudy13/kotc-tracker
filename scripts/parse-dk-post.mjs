#!/usr/bin/env node
// Pulls a "what could've been" payout list (every player's bonus bet if they had won) out of a
// DK Network King of the Court post, for the pick-share model. Run by hand; review before committing.
//
//   node scripts/parse-dk-post.mjs <url> --date 2026-10-28 --pool 5000000          # print only
//   node scripts/parse-dk-post.mjs <url> --date 2026-10-28 --pool 5000000 --write  # add to data/pickshare-<season>.json
//
// Lists cut off mid-way (tweets end in "…") are partial: they can't be used for fitting, since
// shares need the whole field. Pass --partial to store one anyway, marked as such.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : null;
};
const url = args.find((a) => /^https?:\/\//.test(a));
const date = opt("date");
const pool = Number(opt("pool"));
if (!url || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !pool) {
  console.error("usage: parse-dk-post.mjs <url> --date YYYY-MM-DD --pool <dollars> [--write] [--partial]");
  process.exit(1);
}

const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (kotc-tracker)" } });
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&[lr]squo;/g, "'").replace(/&[a-z]+;/g, " ");
const text = decode((await res.text()).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

// "Luka Doncic — $30" / "Trey Murphy III – $3,031 in Bonus Bets"
const pairs = [...text.matchAll(/([A-Z][A-Za-z.'’-]+(?: [A-Z][A-Za-z.'’-]+){1,3}) [—–-] \$([\d,]+)/g)].map((m) => ({
  name: m[1].replace(/’/g, "'"),
  payout: Number(m[2].replace(/,/g, "")),
}));
const seen = new Set();
const unique = pairs.filter((p) => !seen.has(p.name) && seen.add(p.name));
if (!unique.length) {
  console.error("no 'Name — $amount' list found in that post");
  process.exit(1);
}

const [y, mo] = date.split("-").map(Number);
const season = mo >= 8 ? y : y - 1;
const data = JSON.parse(await readFile(path.join(DATA_DIR, `${season}.json`), "utf8"));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
const byName = {};
for (const [pid, p] of Object.entries(data.players)) if (p.name) byName[norm(p.name)] = pid;

const payouts = [], unmatched = [];
for (const p of unique) {
  const pid = byName[norm(p.name)];
  if (pid) payouts.push({ pid, name: p.name, payout: p.payout });
  else unmatched.push(p.name);
}
const bettors = payouts.reduce((s, p) => s + pool / p.payout, 0);
console.log(`${date}: ${unique.length} players found, ${payouts.length} matched, ≈${Math.round(bettors).toLocaleString()} entrants on them`);
for (const p of payouts.slice(0, 10)) console.log(`  ${p.name.padEnd(26)} $${p.payout.toLocaleString()}  ≈${Math.round(pool / p.payout).toLocaleString()} bettors`);
if (unmatched.length) console.log(`unmatched (add by hand with the ESPN id): ${unmatched.join(", ")}`);

if (args.includes("--write")) {
  const file = path.join(DATA_DIR, `pickshare-${season}.json`);
  let store;
  try {
    store = JSON.parse(await readFile(file, "utf8"));
  } catch {
    store = { season, notes: "Every player's would-be payout on nights DK published the full list. Bettors on a player = pool ÷ payout.", nights: [] };
  }
  store.nights = store.nights.filter((n) => n.date !== date);
  store.nights.push({ date, pool, source: url, partial: args.includes("--partial") || undefined, payouts });
  store.nights.sort((a, b) => (a.date < b.date ? -1 : 1));
  await writeFile(file, JSON.stringify(store, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
