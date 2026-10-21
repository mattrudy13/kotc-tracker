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
const leaders = Object.fromEntries(M.dailyLeaders(data, 3).map((x) => [x.d, x]));

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
