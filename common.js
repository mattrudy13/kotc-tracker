// Shared DOM code for every page: data loading, formatting, URL state and markup helpers.
// Plain globals, no build step. Model and data logic lives in model.js.

const KOTC = { cache: {} };

async function getData(file, { optional = false } = {}) {
  if (file in KOTC.cache) return KOTC.cache[file];
  const res = await fetch(`data/${file}`, { cache: "no-cache" });
  if (!res.ok) {
    if (optional) return (KOTC.cache[file] = null);
    throw new Error(`Couldn't load ${file} (HTTP ${res.status})`);
  }
  return (KOTC.cache[file] = await res.json());
}
const getSeasons = () => getData("seasons.json");

// ---- Formatting ----

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const fmt = {
  int: (n) => (n == null || !Number.isFinite(n) ? "–" : Math.round(n).toLocaleString()),
  d1: (n) => (n == null || !Number.isFinite(n) ? "–" : n.toFixed(1)),
  pct: (n) => (n == null || !Number.isFinite(n) ? "–" : n > 0 && n < 0.001 ? "<0.1%" : `${(n * 100).toFixed(1)}%`),
  pct0: (n) => (n == null || !Number.isFinite(n) ? "–" : `${Math.round(n * 100)}%`),
  money: (n) => (n == null ? "–" : n >= 1e6 ? `$${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M` : `$${Math.round(n).toLocaleString()}`),
};
// Dates are YYYY-MM-DD Eastern; render them without a time-zone shift.
function dateText(d, opts = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });
}
function timeText(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
}
function stampText(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
}
const easternToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const seasonLabel = (s) => `${s}-${String(s + 1).slice(2)}`;

// ---- URL state ----

function getParams() {
  return Object.fromEntries(new URLSearchParams(location.search));
}
function setParams(obj) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== "" && v != null && v !== false) q.set(k, v === true ? "1" : v);
  const s = q.toString();
  history.replaceState(null, "", s ? `?${s}` : location.pathname);
}

// ---- Markup helpers ----

const headshotUrl = (pid) => `https://a.espncdn.com/i/headshots/nba/players/full/${encodeURIComponent(pid)}.png`;
function headshot(pid, size = 32) {
  return `<img class="hs" src="${headshotUrl(pid)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hs hs-x'}))">`;
}
function teamChip(teams, abbr) {
  const t = teams?.[abbr];
  return `<span class="team" style="--team:${esc(t?.color ?? "#888")}">${esc(abbr ?? "–")}</span>`;
}
function playerName(names, pid) {
  return esc(names?.[pid]?.n ?? `Player ${pid}`);
}
// Player cell: headshot, name, and a second line (team / matchup) as visible text.
function whoCell(names, pid, line2 = "") {
  return `<div class="who">${headshot(pid)}<div><span class="pn">${playerName(names, pid)}</span>${line2 ? `<small>${line2}</small>` : ""}</div></div>`;
}
const vsText = (home, opp) => `${home ? "vs" : "@"} ${esc(opp)}`;
// Small injury badge (Q amber, O red). Empty when healthy.
function injuryTag(status) {
  if (!status) return "";
  const short = /^out/i.test(status) ? "O" : /^doubt/i.test(status) ? "D" : /^prob/i.test(status) ? "P" : "Q";
  return ` <span class="inj${short === "O" || short === "D" ? "" : " q"}" aria-label="${esc(status)}">${short}</span>`;
}
const crown = `<span class="crown" aria-hidden="true">♛</span>`;

// Sortable table: columns are { key, label, fmt, cls, sort, asc, nosort }. Sort state lives on `state`.
function renderTable(el, rows, cols, state, onSort, empty = "Nothing to show yet.") {
  const dir = state.dir === "asc" ? 1 : -1;
  const col = cols.find((c) => c.key === state.sort) ?? cols[0];
  const val = col.sort ?? ((r) => r[col.key]);
  if (!state.nosort) {
    rows = [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === "string" ? x.localeCompare(y) * dir : (x - y) * dir;
    });
  }
  el.innerHTML = `<table class="grid"><thead><tr>${cols
    .map(
      (c) =>
        `<th class="${c.cls ?? ""}${c.key === col.key && !state.nosort ? " sorted " + state.dir : ""}">${
          c.nosort || state.nosort ? c.label : `<button data-sort="${c.key}">${c.label}</button>`
        }</th>`
    )
    .join("")}</tr></thead><tbody>${
    rows.length
      ? rows.map((r, i) => `<tr${r._cls ? ` class="${r._cls}"` : ""}>${cols.map((c) => `<td class="${c.cls ?? ""}">${c.fmt(r, i)}</td>`).join("")}</tr>`).join("")
      : `<tr><td class="empty" colspan="${cols.length}">${empty}</td></tr>`
  }</tbody></table>`;
  el.querySelectorAll("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.sort;
      if (state.sort === k) state.dir = state.dir === "asc" ? "desc" : "asc";
      else {
        state.sort = k;
        state.dir = cols.find((c) => c.key === k)?.asc ? "asc" : "desc";
      }
      onSort();
    })
  );
}

// Segmented buttons: <div class="seg" id="x"><button data-v="a">…</button></div>.
function initSeg(id, value, onChange) {
  const el = document.getElementById(id);
  const set = (v) => el.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v));
  set(value);
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    set(b.dataset.v);
    onChange(b.dataset.v);
  });
}

function showError(err) {
  const el = document.getElementById("status");
  if (el) {
    el.hidden = false;
    el.textContent = err.message || String(err);
  }
  console.error(err);
}

// ---- Theme toggle (follows the system until the viewer picks one) ----

const THEME_KEY = "kotc:theme";
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try {
  applyTheme(localStorage.getItem(THEME_KEY));
} catch {}
function currentTheme() {
  return document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
document.addEventListener("DOMContentLoaded", () => {
  const b = document.getElementById("theme");
  if (!b) return;
  const label = () => {
    const dark = currentTheme() === "dark";
    b.textContent = dark ? "☀" : "☾";
    b.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  };
  label();
  b.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    label();
  });
});
