import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, ArrowUpRight, ChevronDown, CircleAlert, Clock3, RefreshCw, Search, ShieldCheck, Trophy } from 'lucide-react'
import { projectDraftOrder } from './projection'
import { loadLeagueData, type LeagueData } from './sleeper'
import './App.css'

const DEFAULT_LEAGUE_ID = '1329251955255574528'
type View = 'order' | 'assets'
const formatNumber = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const formatChance = (chance: number) => chance >= 0.995 ? '99%+' : chance === 0 ? '0%' : chance < 0.005 ? '<0.5%' : `${Math.round(chance * 100)}%`

function teamName(data: LeagueData, roster: LeagueData['rosters'][number]): string {
  const owner = data.users.find((user) => user.user_id === roster.owner_id)
  return owner?.metadata?.team_name || owner?.display_name || `Team ${roster.roster_id}`
}

function App() {
  const [leagueId, setLeagueId] = useState(DEFAULT_LEAGUE_ID)
  const [data, setData] = useState<LeagueData | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('order')
  const [search, setSearch] = useState('')
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      const next = await loadLeagueData(leagueId.trim())
      setData(next)
      setLastUpdated(next.lastUpdated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load league data.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let active = true
    void loadLeagueData(DEFAULT_LEAGUE_ID).then((next) => {
      if (!active) return
      setData(next)
      setLastUpdated(next.lastUpdated)
      setError('')
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load league data.')
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [])

  const picks = useMemo(() => (data ? projectDraftOrder(data) : []), [data])
  const query = search.trim().toLowerCase()
  const visiblePicks = picks.filter((team) => `${team.name} ${team.pickHolder} ${team.record}`.toLowerCase().includes(query))
    .sort((first, second) => first.pick - second.pick)
  const rookieYear = Number(data?.league.season ?? 2026) + 1
  const tradedCount = data?.tradedPicks.filter((pick) => Number(pick.season) === Number(data.league.season) + 1 && pick.round === 1).length ?? 0
  const nonPlayoffCount = data ? Math.max(0, data.rosters.length - Number(data.league.settings.playoff_teams || 6)) : 6
  const currentWeek = data?.currentWeek ?? 0

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Draft Ledger home"><span className="brand-mark"><ArrowDownUp size={17} strokeWidth={2.5} /></span><span>DRAFT<span className="brand-light">LEDGER</span></span></a>
        <div className="topbar-right"><span className="season-label">DYNASTY / {data?.league.season ?? '2026'}</span><span className="live-dot" /><span className="live-label">LIVE DATA</span></div>
      </header>

      <section className="intro" id="top">
        <div><p className="eyebrow">PICK POSITION INTELLIGENCE <span>·</span> WEEK {currentWeek || '--'}</p><h1>Draft order, <em>in motion.</em></h1><p className="intro-copy">A live read on where the rookie picks are headed, shaped by every point, bye and roster move.</p></div>
        <div className="league-control"><label htmlFor="league-id">SLEEPER LEAGUE ID</label><div className="league-input-row"><input id="league-id" value={leagueId} onChange={(event) => setLeagueId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void refresh() }} /><button type="button" className="refresh-button" onClick={() => void refresh()} disabled={busy || !leagueId.trim()} title="Refresh live data"><RefreshCw size={15} className={busy ? 'spin' : ''} /><span>{busy ? 'UPDATING' : 'REFRESH'}</span></button></div><div className="refresh-meta"><Clock3 size={12} /> {lastUpdated ? `UPDATED ${new Date(lastUpdated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · MANUAL REFRESH` : 'FETCHES ON LOAD · NO POLLING'}</div></div>
      </section>

      {error && <div className="error-banner"><CircleAlert size={16} /><span>Live data unavailable: {error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

      <section className="summary-strip" aria-label="League summary">
        <div className="summary-item"><span className="summary-label">LEAGUE</span><strong>{data?.league.name ?? (busy ? 'Connecting…' : 'Sleeper league')}</strong><span className="summary-note">{data ? `${data.rosters.length} franchises · ${data.league.scoring_settings.rec ?? 1} PPR` : 'Public league data'}</span></div>
        <div className="summary-item"><span className="summary-label">REGULAR SEASON</span><strong>WEEK {currentWeek || '--'} <span className="summary-muted">/ 18</span></strong><span className="summary-note">Current week + remaining projections</span></div>
        <div className="summary-item"><span className="summary-label">LOTTERY PICKS</span><strong>{data ? `01 — ${String(nonPlayoffCount).padStart(2, '0')}` : '01 — 06'}</strong><span className="summary-note">Reverse Max Points For</span></div>
        <div className="summary-item"><span className="summary-label">PICKS IN PLAY</span><strong>{data ? `${tradedCount} TRADED` : '—'}</strong><span className="summary-note">{rookieYear} first-round ownership</span></div>
      </section>

      <section className="projection-section">
        <div className="section-heading"><div><p className="eyebrow">THE BOARD <span>·</span> {data?.league.name.toUpperCase() ?? 'SLEEPER DYNASTY'}</p><h2>{view === 'assets' ? 'Traded pick assets' : 'Projected rookie order'}</h2></div><div className="board-tools"><div className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a team" aria-label="Find a team" /></div><div className="view-tabs" role="tablist" aria-label="Board view"><button type="button" role="tab" aria-selected={view === 'order'} className={view === 'order' ? 'selected' : ''} onClick={() => setView('order')}>PICK ORDER</button><button type="button" role="tab" aria-selected={view === 'assets'} className={view === 'assets' ? 'selected' : ''} onClick={() => setView('assets')}>PICK ASSETS</button></div></div></div>

        {view === 'assets' ? <div className="table-wrap"><table><thead><tr><th>ORIGINAL PICK</th><th>CURRENT HOLDER</th><th>ROUND</th><th>SEASON</th><th>STATUS</th></tr></thead><tbody>
          {data?.tradedPicks.filter((pick) => Number(pick.season) === Number(data.league.season) + 1).sort((a, b) => a.round - b.round || a.roster_id - b.roster_id).map((pick) => { const origin = data.rosters.find((roster) => roster.roster_id === pick.roster_id); const holder = data.rosters.find((roster) => roster.roster_id === pick.owner_id); return <tr className="asset-row" key={`${pick.season}-${pick.round}-${pick.roster_id}`}><td>{origin ? teamName(data, origin) : `Team ${pick.roster_id}`}</td><td className="holder-cell">{holder ? teamName(data, holder) : `Team ${pick.owner_id}`} {pick.round === 1 && <span className="asset-tag">LOTTERY TRACKED</span>}</td><td>ROUND {pick.round}</td><td>{pick.season}</td><td><span className="trade-mark"><ArrowUpRight size={13} /> TRADED</span></td></tr> })}
          {data && <tr className="owned-picks-row"><td colSpan={5}>Unlisted picks remain with their original franchise. Sleeper is the source of truth for traded-pick ownership.</td></tr>}{!data && <tr><td colSpan={5} className="empty-cell">{busy ? 'Loading traded picks…' : 'Connect a league to see pick ownership.'}</td></tr>}
        </tbody></table></div> : <div className="table-wrap"><table><thead><tr><th className="rank-col">{view === 'order' ? 'PICK' : 'SEED'}</th><th>FRANCHISE</th>{view === 'order' && <th>{rookieYear} PICK HOLDER</th>}<th>CURRENT RECORD</th><th>{view === 'order' ? 'PICK ODDS' : 'PLAYOFF CHANCE'}</th><th>xPICK</th><th>PROJECTED MAX PF</th><th>CURRENT MAX PF</th></tr></thead><tbody>
          {visiblePicks.map((team) => { const inLottery = team.pick <= nonPlayoffCount; const top = team.probabilities.map((chance, pick) => ({ pick: pick + 1, chance, range: team.probabilityRanges[pick] })).filter((outcome) => outcome.chance > 0).sort((a, b) => b.chance - a.chance || a.pick - b.pick).slice(0, 8); return <tr key={team.roster.roster_id} className={`${inLottery ? 'lottery-row' : 'playoff-row'} ${busy ? 'dim-row' : ''}`}>
            <td className="rank-cell"><span className={inLottery ? 'pick-number lottery-number' : 'pick-number'}>{String(team.pick).padStart(2, '0')}</span></td><td><span className="franchise-name">{team.name}</span><span className="roster-id">ROSTER {team.roster.roster_id}</span></td>
            <td className="holder-cell" data-label={`${rookieYear} PICK HOLDER`}>{team.pickHolder}{team.pickHolderId !== team.roster.roster_id && <span className="asset-tag">TRADED</span>}</td><td><span className="record-pill">{team.record}</span></td>
            <td><div className="odds-cell">{top.map(({ pick: pickNumber, chance, range }) => <span className={`odds-pill ${pickNumber <= nonPlayoffCount ? 'odds-lottery' : ''}`} key={pickNumber}><b>{String(pickNumber).padStart(2, '0')}</b><span>{formatChance(chance)}</span><small>{formatChance(range.low)}–{formatChance(range.high)}</small></span>)}</div></td>
            <td className="numeric-cell xpick-cell"><span className={`xpick-pill ${inLottery ? 'xpick-lottery' : ''}`}>{team.expectedPick.toFixed(1)}</span></td>
            <td className="numeric-cell">{formatNumber(team.maxPf)}</td><td className="numeric-cell">{formatNumber(team.currentMaxPf)}</td>
          </tr> })}
          {!data && <tr><td colSpan={8} className="empty-cell">{busy ? <><RefreshCw size={16} className="spin" /> Loading live league data…</> : 'Enter a public Sleeper league ID and refresh.'}</td></tr>}{data && visiblePicks.length === 0 && <tr><td colSpan={8} className="empty-cell">No teams match “{search}”.</td></tr>}
        </tbody></table></div>}

        <footer className="table-footer"><div className="legend"><span><i className="legend-dot lottery-dot" /> 01—{String(nonPlayoffCount).padStart(2, '0')} REVERSE MAX PF</span><span><i className="legend-dot playoff-dot" /> PLAYOFF SEED</span><span><ShieldCheck size={14} /> INJURY + BYE ADJUSTED</span></div><span className="simulation-note">{picks.length ? `${picks.length} TEAMS · 5 MODELS · 2,500 SEASONS` : 'SIMULATIONS WILL APPEAR WHEN DATA LOADS'}</span></footer>
      </section>

      <details className="model-details" open>
        <summary>
          <span className="method-icon"><Trophy size={18} /></span>
          <span className="model-heading"><strong>How projected picks are calculated</strong><small>Sleeper projections · league scoring · 5 model methods</small></span>
          <ChevronDown className="model-chevron" size={17} />
        </summary>
        <div className="model-content">
          <div className="model-grid">
            <section><h3>Player & milestone scoring</h3><p>Weekly projected stat lines from Sleeper are scored with this league's exact rules (1 PPR, +0.5 TE premium, 0.05 pass yd, 6 pass TD, -2 INT, 0.1 rush/rec yd). 100/200-yard rushing/receiving, 300/400-yard passing, and 25-completion milestone bonuses are simulated via tail probabilities. Completed games lock in actual points, live games add stochastic remaining-game output, and unstarted games simulate full single-game outcomes.</p></section>
            <section><h3>Bench-aware Max PF (Matroid)</h3><p>Instead of assuming future Max PF equals a pre-game starter projection, every active, bench, and taxi player is simulated each week with position-calibrated right-skewed variance and NFL team stack shocks. Starter PF uses pre-kickoff starters, while weekly Max PF solves the exact ex-post optimal legal starting lineup (via transversal-matroid bipartite matching)—capturing true bench boom upside. Bye players score zero. Current injury tags draw realistic multi-week Markov spells, and healthy players can suffer new injuries that persist across future weeks.</p></section>
            <section><h3>Standings & median (2 games/wk)</h3><p>Official Sleeper records through the last finalized week are displayed in the table. The current in-progress week is actively simulated: completed NFL games lock in their real points, live games add stochastic remaining output, and current-week H2H matchups and median games are decided directly inside each simulation run before projecting future weeks. Standings are ranked by win percentage, with simulated season Starter Points For breaking ties.</p></section>
            <section><h3>Dual-tier pick mapping</h3><p>Draft picks are locked based on regular-season finish (playoff tournament games do not alter rookie pick order). Non-playoff teams (seeds 7–12) are ordered strictly by final regular-season Max PF, lowest first, for picks 01–06. Playoff qualifiers (seeds 1–6) are ordered strictly by reverse regular-season seed for picks 07–12: the 6th seed receives pick 07, up to the #1 regular-season seed receiving pick 12.</p></section>
          </div>
          <p className="model-caveat"><strong>Lottery vs. Playoff Seeding Mechanics:</strong> Pick 07 is awarded to the 6th playoff seed. In leagues with weekly median matchups (14 games decided over the final 7 weeks), a trailing roster that mounts a substantial winning run can secure the final playoff berth, resulting in Pick 07. Conversely, Pick 06 requires missing the postseason entirely while accumulating a higher season Max PF than all five other non-playoff rosters. For a roster with a low current Max PF baseline, that outcome requires an uncommon divergence where bench production surges for Max PF while starting lineups fail to win matchups or surpass weekly medians. Because offensive surges naturally correlate with game victories, high-scoring outcomes predominantly transition rosters into the postseason tier (Pick 07) rather than the upper boundary of the lottery tier (Pick 06).</p>
          <p className="model-caveat"><strong>Expected Pick (xPick):</strong> The probability-weighted average draft slot across all 2,500 simulations (&Sigma; [probability &times; slot]). While the main table ranks teams by their projected draft order, xPick provides a continuous mathematical expectation of draft position at a glance.</p>
          <p className="model-caveat"><strong>Simulation Methodology &amp; Precision:</strong> Pick odds chips reflect empirical Monte Carlo frequencies sorted strictly in descending order of calculated probability across 2,500 total seasons (5 simulation engines at 500 iterations each): player-level compound Gamma, heavy-tail log-normal with in-game risk, empirical historical bootstrap, empirical-Bayes form and starter efficiency calibration, and multi-week Markov injury attrition. Each simulation iteration incorporates persistent rest-of-season variance (individual player performance regimes and team offensive efficiency shocks that persist across all remaining weeks), accurately modeling how talent and opportunity shifts can close or widen point differentials over a multi-week horizon.</p>
        </div>
      </details>
      <div className="bottom-note">UNOFFICIAL DYNASTY TOOL <span>·</span> LIVE SCORES AND PLAYER PROJECTIONS BY SLEEPER</div>
    </main>
  )
}

export default App
