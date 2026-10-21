#!/usr/bin/env node
// Builds data/<season>.json from ESPN's public site API: one row per player per completed
// regular-season game (points, rebounds, assists, minutes), the schedule, and for the current
// season the rosters and injury report. Seasons are named by their start year (2025 = 2025-26).
//
//   node scripts/build-data.mjs            # current season (data/seasons.json)
//   node scripts/build-data.mjs 2025       # a given season
//   node scripts/build-data.mjs --reprocess
//
// Already-processed games are reused, so reruns only fetch new games. This is the only script
// that talks to ESPN.

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { dailyLeaders, seasonAverages, nameMap } = require("../model.js");

const API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const COLS = ["d", "gid", "pid", "tm", "min", "pts", "reb", "ast", "start"];

const args = process.argv.slice(2);
const reprocess = args.includes("--reprocess");
const seasonsFile = path.join(DATA_DIR, "seasons.json");
const seasons = await readJson(seasonsFile, { current: 2026 });
const season = Number(args.find((a) => /^\d{4}$/.test(a)) ?? seasons.current);
const isCurrent = season === seasons.current;

async function getJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "kotc-tracker (github.com/mattrudy13/kotc-tracker)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

// ESPN's scoreboard `dates=YYYYMMDD` groups games by US Eastern date, which is also what a
// "day" means for the promo. Keep dates as YYYY-MM-DD strings throughout.
const ymd = (d) => d.toISOString().slice(0, 10);
const easternToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
function addDays(s, n) {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

// The All-Star events are filed as regular season; skip them. The NBA Cup final ("CC") stays.
const isCountedGame = (e) => e.season?.type === 2 && e.competitions?.[0]?.type?.abbreviation !== "ALLSTAR";

const file = path.join(DATA_DIR, `${season}.json`);
const old = reprocess ? {} : await readJson(file, {});
const data = {
  season,
  label: `${season}-${String(season + 1).slice(2)}`,
  updated: new Date().toISOString(),
  teams: old.teams ?? {},
  players: old.players ?? {},
  games: old.games ?? {},
  cols: COLS,
  rows: old.rows ?? [],
  out: old.out ?? [],
  processedEvents: old.processedEvents ?? [],
  scannedThrough: old.scannedThrough ?? null,
};
const processed = new Set(data.processedEvents);

// ---- Schedule: one scoreboard call per day ----

const today = easternToday();
const seasonStart = `${season}-10-01`;
const seasonEnd = `${season + 1}-04-20`;
// Rescan a few days back so games that were in progress last run get picked up, and a week
// ahead so the next promo day's slate is known.
let from = data.scannedThrough && !reprocess ? addDays(data.scannedThrough, -3) : seasonStart;
if (from < seasonStart) from = seasonStart;
let to = isCurrent ? addDays(today, 8) : seasonEnd;
if (to > seasonEnd) to = seasonEnd;
const days = [];
for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

const boards = await mapLimit(days, 6, async (d) => ({ d, b: await getJson(`${API}/scoreboard?dates=${d.replace(/-/g, "")}`) }));
for (const { d, b } of boards) {
  for (const e of b.events ?? []) {
    if (!isCountedGame(e)) continue;
    // Postponed games stay on their original date as "post" with 0–0; the makeup is its own event.
    if (/POSTPONED|CANCELED/.test(e.status.type.name)) continue;
    const c = e.competitions[0];
    const side = (ha) => c.competitors.find((x) => x.homeAway === ha);
    const home = side("home"), away = side("away");
    for (const t of [home, away]) {
      const tm = t.team;
      data.teams[tm.abbreviation] = { id: tm.id, name: tm.displayName, short: tm.shortDisplayName ?? tm.name, color: tm.color ? `#${tm.color}` : "#888", logo: tm.logo };
    }
    const prev = data.games[e.id] ?? {};
    const odds = c.odds?.[0];
    data.games[e.id] = {
      d,
      tip: e.date,
      home: home.team.abbreviation,
      away: away.team.abbreviation,
      hs: home.score != null ? Number(home.score) : null,
      as: away.score != null ? Number(away.score) : null,
      state: e.status.type.state, // pre / in / post
      detail: e.status.type.shortDetail,
      // ESPN drops odds once a game ends, so keep the last pregame spread we saw.
      spread: odds?.spread ?? prev.spread ?? null, // home team's side: −5 = home favored by 5
      total: odds?.overUnder ?? prev.total ?? null,
      note: c.notes?.[0]?.headline ?? null,
    };
  }
}
// A game that moved off a scanned date (postponed) shouldn't linger on the old one.
const scanned = new Set(days);
const seen = new Set(boards.flatMap(({ b }) => (b.events ?? []).map((e) => e.id)));
for (const [gid, g] of Object.entries(data.games)) {
  if (scanned.has(g.d) && !seen.has(gid) && !processed.has(gid)) delete data.games[gid];
}
data.scannedThrough = days.length ? [...days].reverse().find((d) => d <= today) ?? from : data.scannedThrough;

// ---- Box scores for finished games ----

const todo = Object.entries(data.games).filter(([gid, g]) => g.state === "post" && !processed.has(gid));
console.log(`${data.label}: ${Object.keys(data.games).length} games on the schedule, ${todo.length} to process`);

const n = (s) => {
  const v = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
};
let failed = 0;
await mapLimit(todo, 6, async ([gid, g]) => {
  let sum;
  try {
    sum = await getJson(`${API}/summary?event=${gid}`);
  } catch (err) {
    // One bad game shouldn't kill the build: skip it, the next run retries.
    console.warn(`skip ${gid}: ${err.message}`);
    failed++;
    return;
  }
  const rows = [], outs = [];
  for (const team of sum.boxscore?.players ?? []) {
    const tm = team.team.abbreviation;
    const st = team.statistics?.[0];
    if (!st) continue;
    const k = Object.fromEntries(st.keys.map((key, i) => [key, i]));
    for (const a of st.athletes ?? []) {
      const ath = a.athlete;
      const p = data.players[ath.id] ?? {};
      data.players[ath.id] = {
        name: ath.displayName,
        short: ath.shortName ?? ath.displayName,
        pos: ath.position?.abbreviation ?? p.pos ?? "",
        headshot: ath.headshot?.href ?? p.headshot ?? null,
        team: p.lastDate && p.lastDate > g.d ? p.team : tm,
        lastDate: p.lastDate && p.lastDate > g.d ? p.lastDate : g.d,
        injury: p.injury ?? null,
      };
      if (a.didNotPlay || !a.stats?.length) {
        // DNPs with an injury/illness reason are what the pregame report would have shown;
        // the backtest uses them as "known out". Coach's decisions aren't knowable in advance.
        const reason = (a.reason ?? "").trim();
        if (reason && !/coach/i.test(reason)) outs.push([g.d, gid, ath.id, tm, reason]);
        continue;
      }
      const min = n(a.stats[k.minutes]);
      if (min <= 0) continue;
      rows.push([g.d, gid, ath.id, tm, min, n(a.stats[k.points]), n(a.stats[k.rebounds]), n(a.stats[k.assists]), a.starter ? 1 : 0]);
    }
  }
  if (!rows.length) {
    console.warn(`skip ${gid}: no box score yet`);
    failed++;
    return;
  }
  // Pregame spread from the summary when the scoreboard no longer has it.
  const pc = sum.pickcenter?.[0];
  if (g.spread == null && pc?.spread != null) g.spread = pc.spread;
  if (g.total == null && pc?.overUnder != null) g.total = pc.overUnder;
  data.rows = data.rows.filter((r) => r[1] !== gid).concat(rows);
  data.out = data.out.filter((r) => r[1] !== gid).concat(outs);
  processed.add(gid);
});
data.processedEvents = [...processed].sort();
data.rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : b[5] + b[6] + b[7] - (a[5] + a[6] + a[7])));
data.out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

// ---- Current season: rosters and the injury report ----

if (isCurrent) {
  const teams = Object.entries(data.teams);
  const rosters = {};
  await mapLimit(teams, 6, async ([abbr, t]) => {
    try {
      const r = await getJson(`${API}/teams/${t.id}/roster`);
      rosters[abbr] = [];
      for (const a of r.athletes ?? []) {
        rosters[abbr].push(a.id);
        const p = data.players[a.id] ?? {};
        data.players[a.id] = {
          name: a.displayName,
          short: a.shortName ?? a.displayName,
          pos: a.position?.abbreviation ?? p.pos ?? "",
          headshot: a.headshot?.href ?? p.headshot ?? null,
          team: abbr,
          lastDate: p.lastDate ?? null,
          injury: null,
        };
      }
    } catch (err) {
      console.warn(`roster ${abbr}: ${err.message}`);
      rosters[abbr] = data.rosters?.[abbr] ?? [];
    }
  });
  data.rosters = rosters;
  try {
    const inj = await getJson(`${API}/injuries`);
    for (const t of inj.injuries ?? []) {
      for (const i of t.injuries ?? []) {
        const id = i.athlete?.links?.[0]?.href?.match(/\/id\/(\d+)/)?.[1];
        if (!id || !data.players[id]) continue;
        data.players[id].injury = {
          status: i.status, // "Out" or "Day-To-Day"
          fantasy: i.details?.fantasyStatus?.abbreviation ?? null, // OUT, GTD, ...
          detail: [i.details?.side, i.details?.type].filter(Boolean).join(" ") || null,
          date: i.date,
          ret: i.details?.returnDate ?? null,
        };
      }
    }
  } catch (err) {
    console.warn(`injuries: ${err.message}`);
  }
}

await writeFile(file, JSON.stringify(data));

// Small precomputed file so the season page doesn't need the full box-score file.
const leaders = {
  season,
  label: data.label,
  updated: data.updated,
  days: dailyLeaders(data, 10),
  averages: seasonAverages(data),
  teams: data.teams,
  names: nameMap(data),
};
await writeFile(path.join(DATA_DIR, `leaders-${season}.json`), JSON.stringify(leaders));
if (!(await readJson(seasonsFile, null))) await writeFile(seasonsFile, JSON.stringify({ current: 2026, seasons: [2025, 2026] }, null, 2) + "\n");

console.log(`${data.label}: ${data.rows.length} player games, ${processed.size} games processed${failed ? `, ${failed} skipped (retried next run)` : ""}`);
