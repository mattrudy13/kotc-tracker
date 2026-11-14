# Enhancements

Ideas, roughly by value. Nothing here is scheduled.

Done: v0.3 (model v2) teammates out and opponent defense. Back-to-backs were tested and had no effect on
2025-26 PRA (slope −0.03 fit, 0.00 holdout); defense split by position (G/F/C) did slightly worse than overall.
v0.5 refit pick share on 10 nights of payout lists and added the rookie lean; recent form didn't help.
v0.6 redesigned the site ("Fight card": poster masthead, main event + undercard picks, shorter Tonight).
The pick record (2026-11-01) tracks Tonight's three picks on the Model page, by slot and night by night.
Late runs: solved 2026-11-02 by hub's cron Worker (on-time runs 10:20 AM–6:50 PM ET).
v3 (2026-11-11): each player's draw leans toward big nights (skew-normal), which fixed long shots winning more
than predicted.

1. **Pick share: more of the public's habits.** `fit-share.mjs` reads one season (2025 by default), so this
   season's lists (`pickshare-2026.json`, from 10/27/26) aren't in the fit yet: fit both seasons together
   once there are a few. Every new list helps (paste each Wednesday's from @DK_Assist on X; they're shorter than the old Reddit lists). Ideas to
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
5. **Skewed noise: done as model v3 (2026-11-11).** Left to try: let the skew vary with projected PRA once
   2026-27's holdout exists (skew only for players under 32 did as well as a flat skew on 2025-26, no better).
6. **Teammates out, early season.** Regulars come only from this season's games, so a team's first game gets no
   bump and its second compares against a fixed 15% baseline. Last season's roster could fill that gap.
7. **Pick share on second-tier winners.** On 11/10/26 Franz Wagner was given 3.0% of picks (≈$297 if King); DK
   paid 6,319 bettors $159, about 5.5% if entrants were near the usual ~111k. One night, so watch it, don't
   refit: as lists come in, compare estimated vs. actual share for 25–35 PRA non-stars (part of #1).
8. **Fetch the winner and payout from DK Network.** The tracking post has both the morning after (curl with a
   browser user agent works; 11/10/26's had "All 6,319 Wagner bettors have received $159"). A small script
   could print a ready `promos` entry (winner pid matched against the box score, payout, source URL) for Rudy
   to check and paste, leaving only the X list as a manual step. Flag it when the post's numbers disagree
   (11/10: tweet $159, article $158, pool ÷ bettors $158.25).
9. **Ruled-out list a week ahead.** Between promo nights, Tonight shows next week's slate with today's injury
   report: about 45 names on 11/11 for 11/18, most stale by then. Hide the list (or show only long-term
   absences) until the day of the promo. Needs Rudy's call on which.
10. **Page-check script.** The check from the dev notes (every page, light and dark, 1280 and 375 px, console
    errors, sideways scroll, "undefined"/"NaN" text) is rewritten by hand each time. Keep it as
    `scripts/check-pages.py`, run from `../apartments/.venv`, and add the "Show all" toggle and phone-nav checks.
11. **Model page wording on run timing.** It still says a night can miss its lock because GitHub starts runs
    late. Since 2026-11-02 the hub Worker starts on-time runs through 6:50 PM ET; say that, and that a late
    tip-off after a missed Worker run is the remaining gap.
12. **Entrants from this season.** `predict.mjs` switches to this season's own entrant counts after 3 nights,
    but a night only counts when the winner's estimated share is 5%+ (1 of 3 so far: 10/27). If long-shot
    winners keep coming, the ≈$ figures stay on last season's median all year; the "What Could've Been"
    lists could give an entrant estimate on every night instead (sum of pool ÷ payout over the listed players
    is a floor).
