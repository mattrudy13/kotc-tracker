# kotc-tracker: project notes

DraftKings NBA "King of the Court" tracker (night's PRA leader wins a share of a bonus-bet pool).
GitHub Pages at https://mattrudy13.github.io/kotc-tracker/. Same conventions as `../te-tracker`: plain
HTML/CSS/JS, no build step, globals in `model.js` (data/model, no DOM) and `common.js` (DOM), Barlow
Condensed + Inter, dark top bar. Accent is royal purple, crowns are gold. README.md covers the pages and pipeline.

## Status (2026-10-21)

v0.1 built in one session. 2026-27's first promo night is Wed Oct 21 (11 games, $5M). The first prediction
(Doncic 29%) was made at 12:49 PM ET. Oct 28 is the first promo night with the full automated cycle.

## Rudy's decisions (don't relitigate)

- Leaderboards: PRA leader for **every** night, season averages (70% of team games, "show everyone" toggle),
  crown counts.
- History: real promo dates hand-checked against DK Network posts, in `data/promos-<season>.json`.
- Model: win chance per player by simulation, predicted and graded **every** game night. Promo nights are highlighted.
  Refresh about every 2 h; the graded prediction is the last one before the first tip-off.
- Three Kings nights: **only #1 gets a crown**. All three are still listed on History and the night's page.
- Regular season + NBA Cup only. No playoffs, play-in or All-Star.
- No betting odds yet (maybe later). Value angle added in v0.2 (see Value).
- Home page = next promo night.

## Data

- Seasons are named by **start year** (2026 = 2026-27; ESPN calls it 2027). `data/seasons.json` holds
  `current`, `seasons` (shown in pickers), `backtests` and `live`. Pages only fetch optional files listed
  there (that avoids 404 console errors). `2024.json` exists only as the prior for the 2025-26 backtest.
- `<season>.json`: `rows` are arrays (`cols`: d, gid, pid, tm, min, pts, reb, ast, start), one per player
  who played. `out` = DNPs with an injury reason (not coach's decision). `games{}` keyed by ESPN event id
  with `d` (Eastern date = ESPN scoreboard date), `tip`, `state`, `spread` (home side), `total`. The current
  season also has `rosters` and `players[].injury` (`status`: "Out" / "Day-To-Day", `fantasy`: OUT/GTD).
- `leaders-<season>.json`: `days[]` (top 10 per night, `kings` = everyone tied for #1, `final`),
  `averages`, `names` (`{pid: {n, t}}`), `teams`. Headshots come from ESPN's URL pattern (`headshotUrl`).
- `predictions-<season>.json`: `days[d]` = `{takenAt, firstTip, promo, slate, players[], out[], result?}`.
  `predict.mjs` never touches a night once `now >= firstTip` or any game has started. An unchanged
  prediction keeps its old `takenAt`, so the data commit is skipped.
- `promos-<season>.json`: `promos[]` = `{date, format: king|three, pool, winners: [{pid, name, payout}],
  source, note}`. `winners` = who DK paid. `payout` = bonus bet per winning token in dollars (null =
  unpublished). 2026 has a `default` (every Wednesday from 10-21, $5M, king) plus `skip`. `promoInfo()`
  merges them. **After each Wednesday, add that night's entry** (winners + payout from DK Network's
  "Tracking the leader(s)" post or @DKSports).
- `promoCrowns()`: a crown goes to who DK paid on "king" nights. That settles ties and stat corrections:
  on 3/17/26 DK paid Duren (50 PRA in DK's count) while ESPN's box score has Duren and LaMelo Ball tied at 49.
  On Three Kings nights only the #1 among those paid gets a crown.

## 2025-26 source notes

- DK Network URL pattern: `/YYYY/MM/DD/tracking-the-leader[s]-for-draftkings-king-of-the-court-tuesday-M-D-YY/`
  ("leader" through Feb, "leaders" from Mar). Curl works with a browser user agent. Payouts are in the next week's
  "Previous Winner" recap or DK Sports tweets quoted in the post.
- No promo found for 12/9 and 12/16 (NBA Cup knockout nights, 2 and 1 games), and 2/17 was the All-Star break.
  2/24 had no recap ($2M, Banchero from the box score, payout unknown). 3/3 and 12/23 were Three Kings
  ($1M per place).
- Some DK posts quote "what could've been" payouts for **every** player (e.g. 11/18/25, 12/2/25, 12/30/25).
  That's pick-share data (pool ÷ payout ≈ bettors on that player) for a future value angle.
- ESPN keeps postponed games as `post` 0–0 on the original date (status `STATUS_POSTPONED`). build-data
  skips them. The makeup game is its own event.

## Model (model.js `MODEL`)

- Minutes: exponentially weighted (half-life 6 games), last season's average worth 1 game. PRA/min: same
  weighting, last season's rate worth 100 minutes, which is itself shrunk to 0.78 by 150 minutes. Mean ×
  (total/230)^0.6. Blowout adjustment tested and left at 0 (worse at 0.006 and 0.012).
- Noise: sd = 5.6 + 0.12 × mean, fitted on projection residuals for 2025-26 Oct–Jan, plus a shared game
  factor (sd 12%). Day-to-day players play 70% of the time (a guess; no historical injury data to fit it).
- Backtest (`scripts/backtest.mjs`, fit Oct–Jan, holdout Feb–Apr 2025-26): the holdout top pick won 19/64
  vs 16/64 for highest PRA average and 18/64 for highest projection. The King's average chance was 16%.
  Calibration is close (the 35%+ bucket runs a bit hot: 43% predicted, 37% actual). Its lookahead: the
  candidates are the players who actually played.
- Any model change changes predictions. Bump `MODEL.version`, rerun `backtest.mjs`, and say so on the Model page.

## Value (v0.2, 2026-10-21)

- The pool is split among everyone on the King, so a pick's value = chance ÷ estimated pick share.
  `MODEL.share` (model.js): share ∝ win^0.726 × exp(0.032·season PRA avg + 0.010·last season's avg),
  a softmax over the **whole field** (`pickShares`, `addValue`). Fitted by `scripts/fit-share.mjs` on
  `data/pickshare-<season>.json` (nights where DK listed every player's would-be payout; only 11/18/25 so far).
  Finding: the public picks almost in proportion to win chance (prop lines carry the same info). Averages alone
  fit worse (−3.96 vs −2.57 log-lik/pick), so value edges are small (tonight's top ≈1.15×).
- Rudy's choices: win + averages share model; a "Best value" card plus Pick % / Value columns (`.hide-sm` on
  phones); the value ratio is the main number, ≈$ secondary; the list needs a 2%+ chance (`MODEL.valueMinWin`);
  the record is on the Model page; the parser is run by hand.
- Entrants (for the ≈$ figures): pool ÷ (payout × est. share of the winners), only when that share is ≥ 5%
  (`impliedEntrants`). The 2025-26 median is 113k over 11 nights (101k–135k on most). `predict.mjs` uses this
  season's own nights once there are 3 (graded into `result.entrants`), else last season's backtest median.
  The $5M Wednesday pool may draw more entrants, so the ≈$ figures may run high until then.
- Record: `valuePicks()` (model favorite / best value / public favorite) and `pickReturn()` (DK's actual payout
  or 0). The backtest is in `backtest-2025.json` `valueRecord`; live nights are in `predictions` `result.value`
  once `promos-2026.json` has payouts. Three Kings nights and nights with unknown payouts are left out.
  2025-26: favorite $300 (9/19), value $1,182 (3/19, of which $1,100 is Adebayo's 83-point night), public = favorite.
- **After each Wednesday**: check DK Network's tracking post for a full "what could've been" list and run
  `node scripts/parse-dk-post.mjs <url> --date YYYY-MM-DD --pool 5000000 [--write]`. Review the unmatched
  names, then rerun `fit-share.mjs`. If the coefficients move, update `MODEL.share`, bump its version and
  rerun `backtest.mjs`. Tweet lists cut off with "…" are partial (`--partial`) and aren't fitted.

## Before every commit that touches model.js, common.js or style.css

Run `node scripts/stamp-assets.mjs`. `check-assets.yml` fails the push otherwise.

## Dev notes

- Serve with `python3 -m http.server`. Test with Playwright from `../apartments/.venv/bin/python`: every page
  in light and dark mode at 1280 and 375 px, with no console errors and no page-level sideways scroll. Wide
  stat tables scroll inside `.table-wrap` on phones. The home model table fits at 375.
- Test predict/grade on a scratch copy of the repo with `NOW=<iso>`; the scripts write to `data/` next to themselves.
- Theme: follows the system, with a top-bar toggle (`data-theme` on `<html>`, saved in localStorage).
- **Tooltips only for definitions**, by Rudy's request. None are used: everything is visible text or a page note.
- Copy is pronoun-neutral ("the player").
- Commit prefixes: `feat:`, `fix:`, `docs:`, `data:` (the bot uses `data:`). No commits or pushes 8 AM–5 PM ET on
  weekdays unless Rudy asks.
