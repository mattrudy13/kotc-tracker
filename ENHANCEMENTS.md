# Enhancements

Ideas, roughly by value. Nothing here is scheduled.

Done: v0.3 (model v2) teammates out and opponent defense. Back-to-backs were tested and had no effect on
2025-26 PRA (slope −0.03 fit, 0.00 holdout); defense split by position (G/F/C) did slightly worse than overall.
v0.5 refit pick share on 10 nights of payout lists and added the rookie lean; recent form didn't help.

1. **Pick share: more of the public's habits.** Every new Reddit list helps (paste each Wednesday's). Ideas to
   test on held-out nights, as v3 was:
   - Is the public slow on late injury news? Compare fill-ins' actual vs. estimated share on the lists; if
     they're underpicked, fill-ins are real value.
   - Hype beyond rookies: national-TV games, last game's PRA (hot hand), big markets. Durant was underpicked
     ~3.5× on three nights; Randle overpicked 4× on 3/17.
   - Use the two "most-bet" lists (12/30, 1/6) through a censored likelihood: everyone off the list drew fewer
     picks than #20.
2. **Odds.** PRA prop lines from The Odds API (see te-tracker's `fetch-odds.mjs`), as a model input, to compare
   the model with the market, and as the likely best predictor of pick share.
3. **Three Kings.** Grade Three Kings nights on the top 3 (the model already outputs `top3`), and fit their pick
   share on `top3` chances (3/3/26's list is stored but left out of the fit).
4. **Questionable players.** Fit the 70% play chance once a season of injury snapshots has built up in git
   history.
5. **Late runs.** If GitHub keeps starting runs late on Wednesday afternoons, add a 22:00 UTC cron on
   Wednesdays only.
6. **Teammates out, early season.** Regulars come only from this season's games, so a team's first game gets no
   bump and its second compares against a fixed 15% baseline. Last season's roster could fill that gap.
