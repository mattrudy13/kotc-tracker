#!/usr/bin/env node
// Pulls a "what could've been" payout list (every player's bonus bet if they had won) out of a
// DK Network King of the Court post, or out of pasted text (e.g. a u/DraftKings post on r/DKAssist,
// which Reddit won't serve to scripts), for the pick-share model. Run by hand; review before committing.
//
//   node scripts/parse-dk-post.mjs <url> --date 2026-10-28 --pool 5000000          # print only
//   node scripts/parse-dk-post.mjs <url> --date 2026-10-28 --pool 5000000 --write  # add to data/pickshare-<season>.json
//   node scripts/parse-dk-post.mjs --file post.txt --date 2026-03-10 --source <reddit url> [--write]
//   pbpaste | node scripts/parse-dk-post.mjs --file - --date 2026-03-10            # text from stdin
//
// --pool defaults to the night's pool in data/promos-<season>.json. Lists that don't cover everyone who
// played are partial: they can't be used for fitting, since shares need the whole field. Pass --partial
// to store one anyway, marked as such (the script warns when a list looks partial).

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
const file = opt("file");
const date = opt("date");
if ((!url && !file) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
  console.error("usage: parse-dk-post.mjs (<url> | --file <path|->) --date YYYY-MM-DD [--pool <dollars>] [--source <url>] [--write] [--partial]");
  process.exit(1);
}
const [y, mo] = date.split("-").map(Number);
const season = mo >= 8 ? y : y - 1;
const readData = async (f) => JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8"));

// The night's pool: --pool, else the promos file (listed night or the season default).
let pool = Number(opt("pool"));
if (!pool) {
  try {
    const promos = await readData(`promos-${season}.json`);
    pool = promos.promos?.find((p) => p.date === date)?.pool ?? (promos.default && date >= promos.default.from ? promos.default.pool : 0);
  } catch {}
}
if (!pool) {
  console.error(`no pool for ${date} in promos-${season}.json; pass --pool <dollars>`);
  process.exit(1);
}

let raw;
if (file) raw = file === "-" ? await new Promise((ok) => { let b = ""; process.stdin.setEncoding("utf8").on("data", (c) => (b += c)).on("end", () => ok(b)); }) : await readFile(file, "utf8");
else {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (kotc-tracker)" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  raw = await res.text();
}
const source = opt("source") ?? url ?? `pasted text (${file === "-" ? "stdin" : path.basename(file)})`;
const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&[lr]squo;/g, "'").replace(/&[a-z]+;/g, " ");
// HTML from a URL; pasted text may carry Markdown (bold, table pipes) instead.
const text = decode(raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " "))
  .replace(/[*_`#>]+/g, " ")
  .replace(/\s+/g, " ");

// "Luka Doncic — $30" / "Trey Murphy III – $3,031 in Bonus Bets" / "Luka Doncic: $30" / "| Luka Doncic | $30 |"
const pairs = [...text.matchAll(/(\p{Lu}[\p{L}.'’-]+(?: \p{Lu}[\p{L}.'’-]+){1,3}) ?(?:[—–:|-] ?)+\$([\d,]+(?:\.\d+)?)/gu)].map((m) => ({
  name: m[1].replace(/’/g, "'"),
  payout: Number(m[2].replace(/,/g, "")),
}));
const seen = new Set();
const unique = pairs.filter((p) => !seen.has(p.name) && seen.add(p.name));
if (!unique.length) {
  console.error("no 'Name — $amount' list found in that post");
  process.exit(1);
}

const data = await readData(`${season}.json`);
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
// Posts sometimes drop "Jr." or "III", so match without the suffix too.
const bare = (s) => norm(String(s ?? "").replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, ""));
const byName = {}, byBare = {};
for (const [pid, p] of Object.entries(data.players)) {
  if (!p.name) continue;
  byName[norm(p.name)] = pid;
  byBare[bare(p.name)] = pid;
}
// Who played that night, to check the names and whether the list covers the whole field.
const ix = Object.fromEntries(data.cols.map((c, i) => [c, i]));
const played = new Set(data.rows.filter((r) => r[ix.d] === date).map((r) => r[ix.pid]));

const payouts = [], unmatched = [], absent = [];
for (const p of unique) {
  const pid = byName[norm(p.name)] ?? byBare[bare(p.name)];
  if (!pid) unmatched.push(p.name);
  else {
    payouts.push({ pid, name: p.name, payout: p.payout });
    if (played.size && !played.has(pid)) absent.push(p.name);
  }
}
const bettors = payouts.reduce((s, p) => s + pool / p.payout, 0);
console.log(`${date}: ${unique.length} players found, ${payouts.length} matched, ≈${Math.round(bettors).toLocaleString()} entrants on them ($${pool.toLocaleString()} pool)`);
for (const p of [...payouts].sort((a, b) => a.payout - b.payout).slice(0, 10)) console.log(`  ${p.name.padEnd(26)} $${p.payout.toLocaleString()}  ≈${Math.round(pool / p.payout).toLocaleString()} bettors`);
if (unmatched.length) console.log(`unmatched (add by hand with the ESPN id): ${unmatched.join(", ")}`);
if (absent.length) console.log(`listed but didn't play on ${date} (check the date): ${absent.join(", ")}`);
if (played.size && payouts.length < played.size && !args.includes("--partial")) {
  console.log(`looks partial: ${payouts.length} of the ${played.size} players who played. Pass --partial to store it as partial.`);
}

if (args.includes("--write")) {
  const file = path.join(DATA_DIR, `pickshare-${season}.json`);
  let store;
  try {
    store = JSON.parse(await readFile(file, "utf8"));
  } catch {
    store = { season, notes: "Every player's would-be payout on nights DK published the full list. Bettors on a player = pool ÷ payout.", nights: [] };
  }
  store.nights = store.nights.filter((n) => n.date !== date);
  store.nights.push({ date, pool, source, partial: args.includes("--partial") || undefined, payouts });
  store.nights.sort((a, b) => (a.date < b.date ? -1 : 1));
  await writeFile(file, JSON.stringify(store, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
