# Enhancements

Ideas, roughly by value. Nothing here is scheduled.

Done in v0.3 (model v2): teammates out and opponent defense. Back-to-backs were tested and had no effect on
2025-26 PRA (slope −0.03 fit, 0.00 holdout); defense split by position (G/F/C) did slightly worse than overall.

1. **Better pick-share data.** The share model rests on one full night (11/18/25). Each new full "what could've
   been" list improves it. Name value (rookie hype like Flagg's, LeBron) is the biggest miss.
2. **Odds.** PRA prop lines from The Odds API (see te-tracker's `fetch-odds.mjs`), as a model input, to compare
   the model with the market, and as the likely best predictor of pick share.
3. **Three Kings grading.** Grade Three Kings nights on the top 3 (the model already outputs `top3`).
4. **Questionable players.** Fit the 70% play chance once a season of injury snapshots has built up in git
   history.
5. **Late runs.** If GitHub keeps starting runs late on Wednesday afternoons, add a 22:00 UTC cron on
   Wednesdays only.
6. **Teammates out, early season.** Regulars come only from this season's games, so a team's first game gets no
   bump and its second compares against a fixed 15% baseline. Last season's roster could fill that gap.
