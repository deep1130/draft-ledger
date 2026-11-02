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

The current and remaining weekly player projections come from Sleeper's public projection endpoint and are converted with the league's scoring settings. Current matchup/player scores come from Sleeper. ESPN's public scoreboard supplies game progress and week-specific bye teams. Current-week injury statuses adjust this week's projections only (IR/out/suspended: 0%; doubtful: 25%; questionable: 65%; probable: 90%). Future weeks use their own Sleeper projections and do not carry today's injury designation forward. Past wins, losses, points for, and Max Points For start from Sleeper's season-to-date roster totals.

## Projection model

The app compares three scenario models with 600 full-season simulations each (1,800 total): lower-variance projections, balanced projections, and higher-variance projections with a capped recent-form adjustment. The displayed consensus is the average pick frequency across the three models. Each pick slot also shows the low-to-high probability range produced by those scenarios; this is a sensitivity range, not a confidence interval. Current-week player points and projections plus remaining regular-season player projections estimate final Max Points For. Future regular-season scores vary around Sleeper's weekly lineup projections, with variation calibrated from each team's completed matchup scores and historical Max PF; future Max PF is varied in each simulation too. Simulated matchup results determine playoff qualification. Record affects only playoff qualification; once the six non-playoff teams are known, picks 1-6 are ordered strictly by projected season Max Points For, lowest first. Record does not break ties or otherwise order those six picks. With six playoff teams, a simulated six-team bracket maps playoff finish to picks 7-12. The record column uses Sleeper's current wins-losses-ties fields. Pick-odds chips show the six most likely slots for each original franchise's pick. Traded first-round picks display the original franchise and current owner separately. Odds are scenario estimates, not guarantees.

These are estimates, not official league draft positions. The six-team postseason mapping assumes the common format where seeds 1-2 receive first-round byes, seeds 3-6 play in round one, and third/fifth place are settled by the indicated games/loser points. Sleeper league settings and scoring data are the source of truth; public APIs may change or be temporarily unavailable.

## GitHub Pages

The included workflow builds and deploys on pushes to `main` and on manual workflow dispatch. The Vite base path is configured for the `draft-ledger` repository; if it is renamed, update `base` in `vite.config.ts` to match the new repository path.

For this repository name, the site URL is `https://deep1130.github.io/draft-ledger/` after the first successful workflow run.
