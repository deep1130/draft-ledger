# Draft Ledger

A static dynasty fantasy football draft-order projector for Sleeper leagues. Enter any public Sleeper league ID in the search field or append `?league=<id>` to the URL to view live draft pick projections and odds.

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

## How draft pick odds are calculated

Draft Ledger combines **thirteen independent simulation engines** into a consensus draft order: twelve player-level Monte Carlo models (500 full-season simulations each, 6,000 total) alongside an exact closed-form mathematical engine:

1. **Standard Game-Day Scoring (Monte Carlo)**: Realistic point curves for every position (QB, RB, WR, TE) tied to overall NFL team offensive scoring.
2. **Boom / Bust Weeks (Monte Carlo)**: Accounts for wild blowouts, garbage-time spikes, and games where game scripts bench key starters.
3. **Real NFL Game Logs (Monte Carlo)**: Samples directly from games players have actually played this season to ground projections in real NFL production.
4. **Hot Streaks & Lineup Smarts (Monte Carlo)**: Weights recent multi-week momentum and rewards managers who consistently start their highest scorers.
5. **Late-Season Wear & Tear (1.5x Injuries) (Monte Carlo)**: Stress-tests rosters with an above-average injury rate to see whose bench depth survives into winter.
6. **Injury Crisis & Chaos (2.0x Injuries) (Monte Carlo)**: Simulates a worst-case injury bug where multiple starters go down, testing true roster depth.
7. **Shootouts & Team Stacks (Monte Carlo)**: Simulates high-scoring 40-point shootouts where quarterbacks and their pass-catchers erupt together.
8. **Late-Season Rookie Surges (Monte Carlo)**: Accounts for rookies and young prospects earning bigger roles and snap counts down the stretch.
9. **Safe Chalk & Low Variance (Monte Carlo)**: A predictable, low-volatility scenario where star players reliably hit their projected baselines.
10. **Contender vs. Rebuilder Tactics (Monte Carlo)**: Reflects real dynasty behavior—contenders lean on veteran floors, while rebuilders test young talent.
11. **Monster Outlier Booms (Monte Carlo)**: Captures legendary 40+ point ceiling games alongside sudden in-game exits (hamstrings, early injuries).
12. **Backup QB Downgrades (Monte Carlo)**: When a starting quarterback misses time, their wide receivers and tight ends take a realistic efficiency hit.
13. **Pure Matchup Math (Closed-Form)**: Calculates exact mathematical win probabilities for every matchup and median game without simulation randomness.

### Roster Modeling & Anti-Tanking Max PF

- **Hindsight Lineups (Max PF):** In dynasty leagues, non-playoff draft order is decided by **Max Points For (Max PF)**, not your win-loss record. In each simulated week, the engine reviews every active, bench, and taxi player to calculate the highest legal lineup in 20/20 hindsight. Benching your stars to intentionally lose matchups will never lower your Max PF.
- **Bench Depth & Injury Survival:** Players face realistic weekly injury probabilities based on actual NFL data (running backs lead at ~4.6% per game, tight ends ~3.6%, wide receivers ~3.3%, and quarterbacks ~2.2%). When a starter is sidelined, the best bench player automatically steps up. Teams with hollow benches suffer severe scoring drops, while deep benches protect weekly floors and playoff seedings.
- **Season-Long Shocks:** Each simulated season draws persistent rest-of-season performance shocks for individual players and NFL offenses. This prevents weekly noise from falsely making close teams look artificially separated over the course of a 14-week season.

### Seeding Dynamics & Pick Assignment

- **Picks 01–06 (Lottery Tier):** Awarded to the non-playoff teams, ordered strictly by lowest regular-season Max PF. The lowest-scoring non-playoff team receives the #1 overall pick.
- **Picks 07–12 (Playoff Tier):** Awarded to playoff qualifiers, ordered in reverse of regular-season finish (the last playoff seed receives Pick 07; the #1 seed receives Pick 12).
- **The Playoff Bubble (Pick 06 vs. Pick 07):** A bubble team that goes on a late-season hot streak usually wins enough matchups (and weekly median games) to sneak into the playoffs, locking them into Pick 07. Landing Pick 06 requires leading all non-playoff teams in Max PF while still missing the postseason entirely—a rare needle to thread.
- **Expected Pick (`xPick`):** The probability-weighted average draft position ([Expected Value](https://en.wikipedia.org/wiki/Expected_value): $\sum [j \cdot P(\text{Pick} = j)]$). An xPick of `1.4` indicates a near-certain top-2 pick, while `6.8` indicates a team hovering right on the playoff bubble.

### College-Level Mathematical Foundations & Algorithm Specifications

For engineers, mathematicians, and fantasy players interested in the formal calculus, probability theory, and discrete optimization algorithms running behind the scenes, the core computational pipeline implements the following specifications (source code: [`src/projection.ts`](https://github.com/deep1130/draft-ledger/blob/main/src/projection.ts)):

1. **Continuous Scoring Densities & Milestone Integrals ([Gamma distribution](https://en.wikipedia.org/wiki/Gamma_distribution)):**
   $$f(x; k, \theta) = \frac{1}{\Gamma(k)\theta^k} x^{k-1} e^{-x/\theta}, \quad \mathbb{E}[X] = k\theta = \mu, \quad \mathrm{Var}(X) = \theta^2 \mu$$
   Positional dispersion scales with mean ($\sigma = \theta\sqrt{\mu}$), and yardage milestone bonuses evaluate upper tail definite integrals: $P(X \ge T) = \int_T^\infty f(x) \, dx = 1 - \frac{\gamma(k, T/\theta)}{\Gamma(k)}$.

2. **Hindsight Lineup Optimization ([Transversal Matroid](https://en.wikipedia.org/wiki/Transversal_matroid)):**
   $$\max_{I \in \mathcal{I}} \sum_{e \in I} w(e), \quad \text{where } \mathcal{I} = \{ I \subseteq V_{\text{players}} : I \text{ matchable in bipartite graph } G \}$$
   Max PF evaluates optimal lineups in 20/20 hindsight over a transversal matroid in $\mathcal{O}(|E| \log |E|)$ greedy time. Benching stars cannot depress a team's Max PF.

3. **Closed-Form Matchup Integrals ([Error function (erf)](https://en.wikipedia.org/wiki/Error_function) & [Normal CDF](https://en.wikipedia.org/wiki/Normal_distribution#Cumulative_distribution_function)):**
   $$P(S_A > S_B) = \int_0^\infty \frac{1}{\sigma_D \sqrt{2\pi}} e^{-\frac{(z - \mu_D)^2}{2\sigma_D^2}} dz = \frac{1}{2} \left[ 1 + \mathrm{erf}\left( \frac{\mu_D}{\sigma_D \sqrt{2}} \right) \right]$$
   where $\mu_D = \mu_A - \mu_B$ and $\sigma_D^2 = \sigma_A^2 + \sigma_B^2 - 2\mathrm{Cov}(S_A, S_B)$, calculating zero-noise win probabilities for both head-to-head and weekly median games.

4. **Exact Win Distributions ([Poisson Binomial Distribution](https://en.wikipedia.org/wiki/Poisson_binomial_distribution)):**
   $$G_W(z) = \prod_{i=1}^N \big((1 - p_i) + p_i z\big) = \sum_{k=0}^N P(W = k) z^k$$
   Evaluated via iterative $\mathcal{O}(N^2)$ polynomial convolution for exact playoff and median win distributions without simulation sampling variance.

5. **Injury Cascades as Stochastic Transitions ([Markov Chain](https://en.wikipedia.org/wiki/Markov_chain)):**
   $$\mathbf{s}_{t+1} = \mathbf{s}_t \mathbf{P}, \quad \mathbf{P} = \begin{pmatrix} 1 - \lambda_{\text{pos}} & \lambda_{\text{pos}} \\ \mu_{\text{rec}} & 1 - \mu_{\text{rec}} \end{pmatrix}$$
   Position-specific hazards ($\lambda_{\text{RB}} \approx 4.6\%$, $\lambda_{\text{TE}} \approx 3.6\%$, $\lambda_{\text{WR}} \approx 3.3\%$, $\lambda_{\text{QB}} \approx 2.2\%$) model multi-week injury and recovery spells across simulated seasons.

6. **Doubly-Stochastic Matrix Normalization ([Sinkhorn's Theorem](https://en.wikipedia.org/wiki/Sinkhorn%27s_theorem)):**
   $$\lim_{k \to \infty} \mathbf{D}_1^{(k)} \mathbf{M} \mathbf{D}_2^{(k)} = \mathbf{P}^*, \quad \sum_{j=1}^M P^*_{ij} = 1 \; (\forall i), \quad \sum_{i=1}^M P^*_{ij} = 1 \; (\forall j)$$
   Alternating diagonal scaling projects the 13-engine probability matrix onto the [Birkhoff polytope](https://en.wikipedia.org/wiki/Doubly_stochastic_matrix), guaranteeing all rows and columns sum to exactly 100%.

7. **Expected Pick Capital ([Expected Value](https://en.wikipedia.org/wiki/Expected_value)):**
   $$\mathbb{E}[\text{Pick}_i] = \sum_{j=1}^M j \cdot P(\text{Pick}_i = j)$$

8. **Projection Calibration ([Empirical Bayes](https://en.wikipedia.org/wiki/Empirical_Bayes_method) & [Monte Carlo](https://en.wikipedia.org/wiki/Monte_Carlo_method)):**
   $$\hat{\mu}_i = B_i \bar{x}_i + (1 - B_i) \mu_{0, i}, \quad B_i = \frac{\tau^2}{\tau^2 + \sigma_i^2 / n_i}$$
   Shrinkage pulls small samples toward baseline priors, followed by 6,000 full-season Monte Carlo simulation trials.

These are estimates, not official league draft positions. Sleeper league settings and scoring data are the source of truth; public APIs may change or be temporarily unavailable.

## GitHub Pages

The included workflow builds and deploys on pushes to `main` and on manual workflow dispatch. The Vite base path is configured for the `draft-ledger` repository; if it is renamed, update `base` in `vite.config.ts` to match the new repository path.

For this repository name, the site URL is `https://deep1130.github.io/draft-ledger/` after the first successful workflow run.
