# King of the Court Tracker

A tracker for DraftKings Sportsbook's NBA **King of the Court** promo. Bettors who used their token on
the night's points + rebounds + assists (PRA) leader split the bonus-bet pool. The promo ran on Tuesdays
in 2025-26 ($1–3M pools) and on Wednesdays in 2026-27 ($5M).

Site: https://mattrudy13.github.io/kotc-tracker/

## At a glance

- **What it does:** simulates each NBA night 10,000 times to estimate every player's chance of leading
  the slate in PRA, estimates how many bettors will pick each player, and ranks players by value: win
  chance divided by pick share, since a popular winner's prize is split many ways.
- **How it was tested:** fitted on October–January 2025-26 and tested on February–April (64 nights). On
  those nights the model's top pick won 18 times, against 16 for the plain "highest PRA average" pick: a
  real but small edge. A model factor stays only if it improves the holdout score (log loss). The
  pick-share model is fitted on DraftKings' published payout lists.
- **Live record:** the first 2026-27 promo night was Oct 21, 2026; graded results build up from there on
  the Model page.
- **Built with:** JavaScript (Node), GitHub Actions on a schedule, GitHub Pages and ESPN's public API.

## Pages

- **Tonight** (`index.html`): the next promo night: the top 3 value picks (chalk left out), slate, prize
  pool, the model's win chance and estimated pick share for each player (with "+N% teammates out" tags),
  the players ruled out, a Best value list, a Most picked card, and a live PRA leaderboard. During games the
  page polls ESPN straight from the browser every minute.
- **Season** (`season.html`): the PRA leader for every night, season PRA averages (70% of team games
  to qualify), and crown counts.
- **History** (`history.html`): every 2025-26 promo night: winners, PRA, pool, payout per winning bet,
  the model's backtest chance, and a link to the source post.
- **Model** (`model.html`): this season's locked predictions graded, the 2025-26 backtest against two
  baselines, what each model factor adds, the value-pick record by strategy, a calibration chart, and how
  the model works.
- **Night** (`day.html?d=YYYY-MM-DD`): one night's top 10, the suggested picks and the model's list.

## Best value

The prize is split among everyone who picked the King, so a popular favorite pays little. The Tonight page
estimates each player's share of picks and shows **value = win chance ÷ pick share** (1.00× = fair),
plus a rough dollar value per token. The share model is fitted on DK's "what could've been" payout lists
(`data/pickshare-<season>.json`; partial lists through the listed players' shares of one another), with the
post texts kept in `data/posts/`. Most lists come from u/DraftKings' posts on r/DKAssist, which have to be
pasted in (Reddit blocks scripts). The public follows win chances loosely, leans toward big season averages,
and piles onto rookies (about 3.4× the picks of a comparable veteran). Last season's average counts as 10 games
of the current one, so early-season averages don't swing on one game.

```sh
node scripts/parse-dk-post.mjs <dk-network-url> --date YYYY-MM-DD --pool 5000000 --write
pbpaste | node scripts/parse-dk-post.mjs --file - --date YYYY-MM-DD --source <url> --partial --write  # pasted text
node scripts/fit-share.mjs        # compares variants on held-out nights, prints MODEL.share coefficients
```

The Tonight page leads with the top 3 value picks, leaving out "chalk": anyone expected to draw 10%+ of the
picks, plus the hand-kept list in `data/chalk.json`. A "Most picked" card shows who the crowd is on and what
they'd pay. The Model page tracks each way of picking (favorite, best value, chalk left out, filling in for a
missing star, public favorite) with DK's actual payouts.

## Data and automation

All data comes from ESPN's public site API (no key). `.github/workflows/update-data.yml` runs every
2 hours from October to April:

1. `scripts/build-data.mjs`: box scores, schedule, rosters and injuries → `data/<season>.json`, plus
   `data/leaders-<season>.json` for the pages. Seasons are named by start year (2026 = 2026-27).
2. `scripts/predict.mjs`: the model's predictions for today and the next promo night →
   `data/predictions-<season>.json`. A night's prediction locks at its first tip-off.
3. `scripts/grade.mjs`: grades locked predictions once the night's games are final.

Edited by hand:

- `data/promos-<season>.json`: the promo dates, format, pool, who DK paid, and the payout per winning bet.
- `data/chalk.json`: the players always left out of the suggested picks.
- `data/posts/<night>.txt`: pasted "what could've been" posts, parsed into `data/pickshare-<season>.json`.

## The model

Projected PRA = recent minutes × PRA per minute (both weighted toward recent games and pulled toward
last season), scaled by the game's betting total, then adjusted for teammates who are out (relative to the
player's recent games) and the opponent's PRA allowed (model v2). Each night is then simulated 10,000 times;
a questionable teammate's bump only applies in the simulations where they sit. The constants were fit on
October–January 2025-26 and tested on February–April. Rerun the fit and the backtest with:

```sh
node scripts/backtest.mjs --fit        # v2 context constants (teammates, defense), prints the best
node scripts/backtest.mjs --fit-base   # v1 projection constants
node scripts/backtest.mjs              # writes data/backtest-2025.json, incl. the ablation
```

## Run locally

```sh
node scripts/build-data.mjs && node scripts/predict.mjs && node scripts/grade.mjs
python3 -m http.server   # http://localhost:8000
```

Not affiliated with DraftKings.
