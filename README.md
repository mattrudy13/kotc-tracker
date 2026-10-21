# King of the Court Tracker

A tracker for DraftKings Sportsbook's NBA **King of the Court** promo. Bettors who used their token on
the night's points + rebounds + assists (PRA) leader split the bonus-bet pool. The promo ran on Tuesdays
in 2025-26 ($1–3M pools) and on Wednesdays in 2026-27 ($5M).

Site: https://mattrudy13.github.io/kotc-tracker/

## Pages

- **Tonight** (`index.html`): the next promo night: slate, prize pool, the model's win chance for each
  player, the players ruled out, and a live PRA leaderboard. During games the page polls ESPN straight
  from the browser every minute.
- **Season** (`season.html`): the PRA leader for every night, season PRA averages (70% of team games
  to qualify), and crown counts.
- **History** (`history.html`): every 2025-26 promo night: winners, PRA, pool, payout per winning bet,
  the model's backtest chance, and a link to the source post.
- **Model** (`model.html`): this season's locked predictions graded, the 2025-26 backtest against two
  baselines, a calibration chart, and how the model works.
- **Night** (`day.html?d=YYYY-MM-DD`): one night's top 10 and the model's list.

## Data and automation

All data comes from ESPN's public site API (no key). `.github/workflows/update-data.yml` runs every
2 hours from October to April:

1. `scripts/build-data.mjs`: box scores, schedule, rosters and injuries → `data/<season>.json`, plus
   `data/leaders-<season>.json` for the pages. Seasons are named by start year (2026 = 2026-27).
2. `scripts/predict.mjs`: the model's predictions for today and the next promo night →
   `data/predictions-<season>.json`. A night's prediction locks at its first tip-off.
3. `scripts/grade.mjs`: grades locked predictions once the night's games are final.

`data/promos-<season>.json` is edited by hand: the promo dates, format, pool, who DK paid, and the
payout per winning bet.

## The model

Projected PRA = recent minutes × PRA per minute (both weighted toward recent games and pulled toward
last season), scaled by the game's betting total. Each night is then simulated 10,000 times. The constants
were fit on October–January 2025-26 and tested on February–April. Rerun the fit and the backtest with:

```sh
node scripts/backtest.mjs --fit   # grid search, prints the best constants
node scripts/backtest.mjs         # writes data/backtest-2025.json
```

## Run locally

```sh
node scripts/build-data.mjs && node scripts/predict.mjs && node scripts/grade.mjs
python3 -m http.server   # http://localhost:8000
```

Not affiliated with DraftKings.
