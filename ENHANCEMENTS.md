# Enhancements

Ideas, roughly by value. Nothing here is scheduled.

1. **Teammates out.** When a star sits, the others' usage and PRA go up. The model ignores this today, and it
   hurts most on the nights it matters (a lot of 2025-26's long-shot Kings were filling in for a missing star).
   Fit a bump from the `out` lists in the season files.
2. **Better pick-share data.** The share model rests on one full night (11/18/25). Each new full "what could've
   been" list improves it. Name value (rookie hype like Flagg's, LeBron) is the biggest miss.
3. **Odds.** PRA prop lines from The Odds API (see te-tracker's `fetch-odds.mjs`), as a model input, to compare
   the model with the market, and as the likely best predictor of pick share.
4. **Opponent defense and rest.** PRA allowed per minute by opponent, and back-to-backs. Keep each only if it
   improves the backtest (te-tracker's defense factor didn't).
5. **Three Kings grading.** Grade Three Kings nights on the top 3 (the model already outputs `top3`).
6. **Questionable players.** Fit the 70% play chance once a season of injury snapshots has built up in git
   history.
7. **Late runs.** If GitHub keeps starting runs late on Wednesday afternoons, add a 22:00 UTC cron on
   Wednesdays only.
