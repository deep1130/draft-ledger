# Draft Ledger

A static dynasty fantasy football draft-order projector for Sleeper leagues. The configured league is `1329251955255574528` (Remember The Tight Ends); the league ID field can be changed to another public Sleeper league.

## Run locally

```sh
npm install
npm run dev
```

Create a production bundle with `npm run build`, then preview it with `npm run preview`.

## Live data and refresh behavior

The page loads league data once when it opens. It does not poll in the background. Press **Refresh** to request updated league, roster, traded-pick, current matchup, weekly projection, and NFL scoreboard data; the update time is shown next to the button.

Sleeper's NFL player directory is several megabytes and its documentation recommends downloading it sparingly. The app caches that player-name/injury directory in local storage for up to 24 hours; Refresh updates the smaller weekly feeds and league data while reusing the directory cache. The app is client-only and makes public read-only requests, so it needs no API token.

The current and remaining weekly player projections come from Sleeper's public projection endpoint and are converted with the league's exact scoring settings (including TE-premium reception bonuses and simulated yardage/completion milestone bonuses). Current matchup/player scores come from Sleeper. ESPN's public scoreboard supplies live game progress (normalized across ESPN/Sleeper NFL team codes) and week-specific bye teams. Availability is simulated stochastically (IR/Out/PUP/Sus: 0%; Doubtful: 20%; Questionable: 75%; Probable: 93% in the current week, with multi-week IR/Out persistence). Past wins, losses, points for, and Max Points For start from Sleeper's official totals through `last_scored_leg` so mid-week scores are never double-counted.

## Projection model

The app compares five player-level Monte Carlo models with 500 full-season simulations each (2,500 total):
1. **Player-level Gamma**: Right-skewed compound-process player scoring calibrated by position (`SD = θ√μ`) with NFL team offensive stack correlation.
2. **Heavy-tail boom/bust**: Shifted log-normal player outcomes with elevated upper-tail kurtosis and in-game early-exit risk.
3. **Empirical league bootstrap**: Non-parametric resampling of multiplicative player game ratios (`actual / playerMean`) pooled from completed weeks of the league.
4. **Bayesian form & lineup efficiency**: Empirical-Bayes shrinkage comparing recent scores to each roster's own projection baseline (avoiding double-counting roster strength against league average) plus manager starter capture efficiency.
5. **Injury attrition & bench stress**: Position-specific weekly injury attrition where missed future games force actual bench replacements into starting lineups.

In each simulated week, Starter PF sums pre-kickoff starters while Max PF solves the exact ex-post optimal lineup (via transversal-matroid bipartite matching) across all active, bench, and taxi players—capturing the real Jensen's-inequality bench lift that separates deep benches from stripped-down rebuilders. Head-to-head matchups and Sleeper's extra weekly **league-median** matchup determine playoff qualification, with simulated season Starter PF breaking record ties. Non-playoff teams are ordered strictly by final regular-season Max PF, lowest first, for lottery picks; simulated playoff bracket finishes (supporting 4-, 6-, and 8-team fixed or reseeded brackets) determine playoff picks. Displayed slots `01..N` are assigned 1-to-1 via lottery likelihood and expected draft pick so duplicate or missing pick slots cannot occur.

These are estimates, not official league draft positions. The six-team postseason mapping assumes the common format where seeds 1-2 receive first-round byes, seeds 3-6 play in round one, and third/fifth place are settled by the indicated games/loser points. Sleeper league settings and scoring data are the source of truth; public APIs may change or be temporarily unavailable.

## GitHub Pages

The included workflow builds and deploys on pushes to `main` and on manual workflow dispatch. The Vite base path is configured for the `draft-ledger` repository; if it is renamed, update `base` in `vite.config.ts` to match the new repository path.

For this repository name, the site URL is `https://deep1130.github.io/draft-ledger/` after the first successful workflow run.
