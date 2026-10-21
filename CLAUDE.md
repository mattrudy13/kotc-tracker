# kotc-tracker: project notes

DraftKings NBA "King of the Court" tracker (night's PRA leader wins a share of a bonus-bet pool).
GitHub Pages at https://mattrudy13.github.io/kotc-tracker/. Same conventions as `../te-tracker`: plain
HTML/CSS/JS, no build step, globals in `model.js` (data/model, no DOM) and `common.js` (DOM), Barlow
Condensed + Inter, dark top bar. Accent is royal purple, crowns are gold. README.md covers the pages and pipeline.

## Status (2026-10-21)

All built and pushed on 2026-10-21, the first promo night of 2026-27 (Wed, 11 games, $5M):
- v0.1: site, history, model v1. v0.2: best value (pick share). v0.3: model v2 (teammates out + opponent
  defense). v0.4: value-first picks, chalk, Most picked. v0.5: 12 more payout lists from u/DraftKings' Reddit
  posts, DK's exact 2025-26 payouts, pick share v3 (rookie lean).
- Oct 21's prediction was remade on model v2 / share v2 at 6:30 PM (Rudy's call: v1 had no record yet) and
  locked at the 7:00 PM tip, before share v3 went live. Oct 28 is the first night on share v3 and the first
  promo night with the full automated cycle.

## Rudy's decisions (don't relitigate)

- Leaderboards: PRA leader for **every** night, season averages (70% of team games, "show everyone" toggle),
  crown counts.
- History: real promo dates hand-checked against DK Network posts, in `data/promos-<season>.json`.
- Model: win chance per player by simulation, predicted and graded **every** game night. Promo nights are highlighted.
  Refresh about every 2 h; the graded prediction is the last one before the first tip-off.
- Three Kings nights: **only #1 gets a crown**. All three are still listed on History and the night's page.
- Regular season + NBA Cup only. No playoffs, play-in or All-Star.
- No betting odds yet (maybe later). Value angle added in v0.2 (see Value).
- Home page = next promo night, led by the top 3 value picks with chalk left out (v0.4, see Value).
- Chalk = est. pick share ≥ 10% **plus** a hand-kept list (`data/chalk.json`). Teammates out is flagged
  ("filling in") and tracked, not inflated beyond the fitted bump.
- "Bad value" = a Most picked card (top 5 by share, red under 0.80×), not a strict overpriced list.
- Model factors stay only if they lower **holdout log loss** (v0.3). Share-model changes go live only after
  Rudy sees the held-out comparison (approved for v3).

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
  prediction keeps its old `takenAt`, so the data commit is skipped. Players carry `mean`, `win`, `top3`,
  `pPlay`, `inj`, the v2 context (`bump`, `outPct`, `bumpIf`, `def`) and, on promo nights, `share`, `value`,
  `estPayout`, `ev`, `chalk`. Promo nights also save `picks` (top 3 pids), `entrants`, `pool`, `format`,
  `shareVersion`, `longShots`. `result.value` = `{picks, returns}` for favorite / value / noChalk / fillIn / public.
- `promos-<season>.json`: `promos[]` = `{date, format: king|three, pool, winners: [{pid, name, payout}],
  source, note}`. `winners` = who DK paid. `payout` = bonus bet per winning token in dollars (null =
  unpublished). 2026 has a `default` (every Wednesday from 10-21, $5M, king) plus `skip`. `promoInfo()`
  merges them. **After each Wednesday, add that night's entry** (winners + payout from u/DraftKings' r/DKAssist
  post, DK Network's "Tracking the leader(s)" post or @DKSports). The Reddit posts give exact payouts and
  bettor counts; 2025-26's were corrected from them (see notes per night).
- `pickshare-<season>.json`: `nights[]` = `{date, pool, source, partial?, list?: topPra|mostBet, payouts:
  [{pid, name, payout, pra?, winner?}]}`. Bettors on a player = pool ÷ payout (Three Kings: pool ÷ 3 per place).
  `list` says how DK chose a partial list's players: by the night's PRA or by most picks. `winner: true` rows
  come from the promos file (the posts list everyone but the winner). Written only by `parse-dk-post.mjs`.
- `data/posts/<night>.txt`: the pasted post texts behind each list (Reddit can't be fetched by scripts).
- `chalk.json`: `{shareCutoff, players: [{pid, name}]}`, edited by hand.
- `promoCrowns()`: a crown goes to who DK paid on "king" nights. That settles ties and stat corrections:
  on 3/17/26 DK paid Duren (50 PRA in DK's count) while ESPN's box score has Duren and LaMelo Ball tied at 49.
  On Three Kings nights only the #1 among those paid gets a crown.

## 2025-26 source notes

- DK Network URL pattern: `/YYYY/MM/DD/tracking-the-leader[s]-for-draftkings-king-of-the-court-tuesday-M-D-YY/`
  ("leader" through Feb, "leaders" from Mar). Curl works with a browser user agent. Payouts are in the next week's
  "Previous Winner" recap or DK Sports tweets quoted in the post.
- No promo found for 12/9 and 12/16 (NBA Cup knockout nights, 2 and 1 games), and 2/17 was the All-Star break.
  2/24 had no DK Network recap ($2M, Banchero; payout $811 from the Reddit post). 3/3 and 12/23 were Three
  Kings ($1M per place); 3/3's payouts came from the Reddit post, 12/23's Murray payout is still unknown.
- "What could've been" lists: DK Network had one full list (11/18/25: everyone anyone picked, 82 of 131 who
  played). u/DraftKings' r/DKAssist posts ("What Could've Been (Top PRAs) M/D/YY", posted the morning after)
  have partial lists for most nights: usually the top ~20 by PRA, sometimes the "top 20 most-bet players"
  (12/30, 1/6). Players nobody picked can't be listed (no payout), so low-name scorers drop off top-PRA lists.
  Unexplained: SGA (45 PRA) is missing from the 12/2/25 list.
- ESPN keeps postponed games as `post` 0–0 on the original date (status `STATUS_POSTPONED`). build-data
  skips them. The makeup game is its own event.

## Model (model.js `MODEL`)

- Minutes: exponentially weighted (half-life 6 games), last season's average worth 1 game. PRA/min: same
  weighting, last season's rate worth 100 minutes, which is itself shrunk to 0.78 by 150 minutes. Mean ×
  (total/230)^0.6. Blowout adjustment tested and left at 0 (worse at 0.006 and 0.012).
- Noise: sd = 5.6 + 0.12 × mean, fitted on projection residuals for 2025-26 Oct–Jan, plus a shared game
  factor (sd 12%). Day-to-day players play 70% of the time (a guess; no historical injury data to fit it).
- **v2 (2026-10-21): team context** (`newContext`/`addDay`/`contextAdjust`; the backtest feeds it day by day,
  predict.mjs and fit-share build it with `contextBefore`). Regulars = players whose last game was for the
  team, within its last 5 games, projected 10+ min. Missing share = their projected PRA that isn't playing.
  - Teammates out: mean × (1 + 0.4 × (tonight's share − the player's weighted share in their own history
    games, with a 15% baseline worth 1 game)). Relative, so long absences aren't double-counted. Healthy teams
    get a small cut (≈0.94 early on): 2025-26 players on fully healthy teams scored ~5% under projection.
  - Questionable regulars: `simulateSlate` draws sit/play once per sim; teammates get `k × share` only when
    they sit. Saved per player: `bump` (multiplier), `outPct` (rise vs. everyone available, for the page tag),
    `bumpIf` ({pid, pct} for the biggest questionable teammate). Tag shows at ≥3%.
  - Defense: opponent's PRA allowed ÷ the plain projections of players who faced it, shrunk by 12,000
    projected PRA (≈±2% in Dec, ±5% by Apr). By position (G/F/C) did slightly worse; `defByPos` is false.
  - Fit (`backtest.mjs --fit`, v1 projection constants held fixed, RMSE on 28+ projections Oct–Jan): teamK 0.4,
    defShrink 6000–12000 tied. Keep rule (Rudy): **a factor stays only if it lowers holdout log loss**.
    Ablation, holdout log loss (top-pick wins): v1 2.703 (19/64), teammates 2.649 (17), defense 2.667 (19),
    defense by position 2.672 (19), both 2.617 (18). Fit window 2.400 → 2.387. Both kept.
  - Back-to-backs: no effect (slope −0.03 fit, 0.00 holdout), not built.
  - Gap: the backtest's "missing" is who didn't play; live it's the injury report (late scratches unknown).
- Backtest (`scripts/backtest.mjs`, fit Oct–Jan, holdout Feb–Apr 2025-26), v2: the holdout top pick won 18/64
  vs 16/64 for highest PRA average and 18/64 for highest projection; fit window 35/101. The King's average
  chance was 16.5%. Calibration is close (35%+ bucket: 43.6% predicted, 43.2% actual). Its lookahead: the
  candidates are the players who actually played.
- Any model change changes predictions. Bump `MODEL.version`, rerun `backtest.mjs`, and say so on the Model page.

## Value (v0.2–v0.5, 2026-10-21)

- The pool is split among everyone on the King, so a pick's value = chance ÷ estimated pick share.
  `MODEL.share` v3 (2026-10-21, model v2): share ∝ win^0.67 × exp(0.061·season PRA avg − 0.002·last season's
  avg + 1.221·rookie), a softmax over the **whole field** (`pickShares`, `shareX`, `SHARE_KEYS`, `addValue`).
  Fitted by `scripts/fit-share.mjs` (Newton, leave-one-night-out comparison) on `data/pickshare-2025.json`:
  11/18/25 full (DK Network) + 9 partial top-PRA lists from u/DraftKings' r/DKAssist posts (text in
  `data/posts/<night>.txt`; Rudy pastes them, Reddit blocks scripts). Partial lists are fitted on the listed
  players' shares of one another (conditional likelihood), fair because DK chose them by PRA. Left out: the
  two "most-bet" lists (12/30, 1/6: chosen by picks; `--with-mostbet` to include) and 3/3 (Three Kings).
  Held out per pick: live v2 −2.087, refit base −2.093, +rookie −2.065 (kept), +form −2.099 (dropped).
  Rookies draw ~3.4× the picks of a comparable veteran (Flagg, Queen, Fears); Durant is underpicked ~3.5×.
  v2 had called Flagg a value pick 3 nights; v3 drops him. Value spread among 2%+ players widened from
  0.90–4.43× to 0.41–5.34×, so Most picked can now show red overpicks. 2025-26 record unchanged by v3.
- Rudy's choices: share model on win chance + averages (+ rookie since v3); a "Best value" card plus Pick % /
  Value columns (`.hide-sm` on phones); the value ratio is the main number, ≈$ secondary; the list needs a 2%+
  chance (`MODEL.valueMinWin`); the record is on the Model page; the parser is run by hand.
- Entrants (for the ≈$ figures): pool ÷ (payout × est. share of the winners), only when that share is ≥ 5%
  (`impliedEntrants`). The 2025-26 median is ~119k over 12 nights (with share v3). `predict.mjs` uses this
  season's own nights once there are 3 (graded into `result.entrants`), else last season's backtest median.
  The $5M Wednesday pool may draw more entrants, so the ≈$ figures may run high until then.
- Record: `valuePicks()` (model favorite / best value / best value with chalk left out / best value among
  fill-ins / public favorite) and `pickReturn()` (DK's actual payout, 0, or null when the strategy had no
  pick). The backtest is in `backtest-2025.json` `valueRecord`; live nights are in `predictions`
  `result.value` once `promos-2026.json` has payouts. Three Kings nights and nights with unknown payouts are left out.
  2025-26 (model v2, share v3, DK's exact payouts from the Reddit posts): favorite $238 (8/20), value $2,025
  (3/20: Adebayo $1,100 on 3/10, Embiid $817 on 12/30, Edwards $108), public = favorite.
- **Picks and chalk (v0.4, 2026-10-21)**: Tonight leads with "Tonight's picks" (`topPicks`: top 3 by value,
  2%+ chance, chalk left out), then the hero/model table, Best value (chalk tagged) and "Most picked" (top 5 by
  share). Chalk (`isChalk`) = est. share ≥ `data/chalk.json` `shareCutoff` (0.10) or on its hand-kept list
  (Luka, Giannis, Wemby, LeBron; Rudy's choice: both). "Filling in" (`isFillIn`) = `outPct` or `bumpIf.pct`
  ≥ `MODEL.fillInMin` (0.05). `predict.mjs` saves `picks` (pids) and `chalk` per player; grade/backtest
  record `noChalk` and `fillIn` (null pick = sits the night out). 2025-26: noChalk = value ($2,025, 3/20; the
  value pick was never chalk), fillIn $1,917 (2/19: Embiid 12/30, Adebayo 3/10).
  - Said plainly to Rudy and on the page: crowded ≠ overpriced. Established stars are picked roughly in line with
    their chances (share v3, 10/21/26 slate: 2%+ players 1.03–1.20×, Luka 1.08×), so leaving chalk out mostly buys
    bigger payouts; rookies are the real overpicks (~3.4×) and show red on Most picked.
    Rudy wanted more weight on teammates out; we flag/track it instead of inflating the fitted bump (would
    break the win %). The 11/18/25 fit suggested the public already prices injuries (not retested on the
    partial lists yet; see ENHANCEMENTS).
- **After each Wednesday** (the post is up Thursday morning; its date is the night + 1):
  1. Rudy pastes u/DraftKings' r/DKAssist "What Could've Been" post (Reddit blocks curl, WebFetch and the
     Chrome extension) into `data/posts/<night>.txt`. DK Network's tracking post is the fallback
     (`parse-dk-post.mjs <url> …`).
  2. Add the night's winners and exact payout to `promos-<season>.json`.
  3. `node scripts/parse-dk-post.mjs --file data/posts/<night>.txt --date <night> --partial --source "<title>"`.
     Check its report: unmatched names (last-name fallback handles Rob/Robert), listed players who didn't
     play that date, PRA mismatches, list type (topPra/mostBet, guessed from the wording; `--list` overrides)
     and top-PRA players left off. Then rerun with `--write`. `--pool` defaults to the promos file (÷3 on
     Three Kings nights). Leave out `--partial` only for a list of everyone anyone picked.
  4. `node scripts/fit-share.mjs`: if the held-out comparison or coefficients change meaningfully, show Rudy
     before updating `MODEL.share` (bump its version, rerun `backtest.mjs`, update the page notes).
- Parser history: the Unicode name fix (2026-10-21) found Jusuf Nurkić missing from 11/18/25 (about 34 bettors).

## Before every commit that touches model.js, common.js or style.css

Run `node scripts/stamp-assets.mjs`. `check-assets.yml` fails the push otherwise.

## Dev notes

- Serve with `python3 -m http.server`. Test with Playwright from `../apartments/.venv/bin/python`: every page
  in light and dark mode at 1280 and 375 px, with no console errors and no page-level sideways scroll. Wide
  stat tables scroll inside `.table-wrap` on phones. The home model table fits at 375.
- Test predict/grade on a scratch copy of the repo with `NOW=<iso>`; the scripts write to `data/` next to themselves.
- Playwright's Chromium here can't reach ESPN from the page ("Failed to fetch", reported as CORS; curl with the
  same headers works). Check the live leaderboard in real Chrome instead (it worked on 10/21/26).
- Theme: follows the system, with a top-bar toggle (`data-theme` on `<html>`, saved in localStorage).
- **Tooltips only for definitions**, by Rudy's request. None are used: everything is visible text or a page note.
- Copy is pronoun-neutral ("the player").
- Commit prefixes: `feat:`, `fix:`, `docs:`, `data:` (the bot uses `data:`). No commits or pushes 8 AM–5 PM ET on
  weekdays unless Rudy asks.
