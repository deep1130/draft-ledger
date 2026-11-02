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

The current and remaining weekly player projections come from Sleeper's public projection endpoint and are converted with the league's exact scoring settings (including TE-premium reception bonuses and simulated yardage/completion milestone bonuses). Current matchup/player scores come from Sleeper. ESPN's public scoreboard supplies live game progress (normalized across ESPN/Sleeper NFL team codes) and week-specific bye teams. Availability follows a season-long Markov injury process: current IR/Out/Doubtful/Questionable tags draw multi-week absence spells, and healthy players can suffer new position-specific injuries each simulated week that persist into later weeks. Past wins, losses, points for, and Max Points For start from Sleeper's official totals through `last_scored_leg` so mid-week scores are never double-counted.

## Projection model

The app blends six independent projection engines into a consensus ensemble: five player-level Monte Carlo models (750 full-season simulations each, 3,750 total) alongside a deterministic closed-form analytical engine:
1. **Player-level Gamma (Monte Carlo)**: Right-skewed compound-process player scoring calibrated by position (`SD = θ√μ`) with NFL team offensive stack correlation.
2. **Heavy-tail boom/bust (Monte Carlo)**: Shifted log-normal player outcomes with elevated upper-tail kurtosis and in-game early-exit risk.
3. **Empirical league bootstrap (Monte Carlo)**: Non-parametric resampling of multiplicative player game ratios (`actual / playerMean`) pooled from completed weeks of the league.
4. **Bayesian form & lineup efficiency (Monte Carlo)**: Stronger empirical-Bayes weight on each player's recency-weighted actual production versus Sleeper projections, plus manager starter capture efficiency.
5. **Injury attrition & bench stress (Monte Carlo)**: Elevated Markov injury hazard where multi-week absences force actual bench replacements into starting lineups.
6. **Analytical Gaussian convolution (Closed-form)**: Deterministic bivariate normal integration for head-to-head and median games with Poisson-Binomial characteristic convolution to calculate exact win distributions without random sampling noise.

All models share two calibration layers: player means blend Sleeper's projection with the player's own recency-weighted actual points (empirical-Bayes shrinkage, guarded against healthy players who lost their role), and each simulated season draws **persistent rest-of-season shocks** (player role/talent and NFL offense level) that carry across every remaining week. Without this, weekly noise averages out and close teams look far more separated than they really are; positional dispersion is also scaled to the league's scoring settings.

In each simulated week, Starter PF sums pre-kickoff starters while Max PF solves the exact ex-post optimal lineup (via transversal-matroid bipartite matching) across all active, bench, and taxi players—capturing the real Jensen's-inequality bench lift that separates deep benches from stripped-down rebuilders. Head-to-head matchups and Sleeper's extra weekly **league-median** matchup determine playoff qualification, with simulated season Starter PF breaking record ties. Non-playoff teams are ordered strictly by final regular-season Max PF, lowest first, for picks 1–6; playoff qualifiers are ordered by reverse regular-season seed for picks 7–12 (the last playoff seed receives pick 07, up to the #1 seed receiving pick 12). Displayed slots `01..N` are assigned 1-to-1 via lottery likelihood and expected draft pick so duplicate or missing pick slots cannot occur.

### Seeding Dynamics & Mathematical Consistency
Odds chips reflect the consensus average across all six engines sorted strictly in descending order of calculated probability (3,750 Monte Carlo seasons + analytical Gaussian convolution). Expected Pick (`xPick`) displays the probability-weighted average draft slot across all six engines (&Sigma; [probability &times; slot]), providing a single continuous metric for each franchise's overall draft capital expectancy. Pick 07 is awarded to the 6th playoff seed. In leagues with weekly median scoring, a team that mounts a strong winning run over remaining games can qualify for the postseason, resulting in Pick 07. Conversely, Pick 06 requires failing to qualify for the playoffs while outscoring all other lottery rosters in season Max PF. Because offensive point surges naturally produce matchup and median victories, high-scoring trajectories transition rosters into the postseason tier (Pick 07) significantly more often than stranding them at the top of the lottery tier (Pick 06).

These are estimates, not official league draft positions. Sleeper league settings and scoring data are the source of truth; public APIs may change or be temporarily unavailable.

## GitHub Pages

The included workflow builds and deploys on pushes to `main` and on manual workflow dispatch. The Vite base path is configured for the `draft-ledger` repository; if it is renamed, update `base` in `vite.config.ts` to match the new repository path.

For this repository name, the site URL is `https://deep1130.github.io/draft-ledger/` after the first successful workflow run.
