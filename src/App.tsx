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
        </tbody></table></div> : <div className="table-wrap"><table><thead><tr><th className="rank-col">{view === 'order' ? 'PICK' : 'SEED'}</th><th>FRANCHISE</th>{view === 'order' && <th>{rookieYear} PICK HOLDER</th>}<th>CURRENT RECORD</th><th>{view === 'order' ? 'PICK ODDS' : 'PLAYOFF CHANCE'}</th><th>PROJECTED MAX PF</th><th>CURRENT MAX PF</th></tr></thead><tbody>
          {visiblePicks.map((team) => { const inLottery = team.pick <= nonPlayoffCount; const top = team.probabilities.map((chance, pick) => ({ pick: pick + 1, chance, range: team.probabilityRanges[pick] })).filter((outcome) => outcome.chance > 0).sort((a, b) => b.chance - a.chance).slice(0, 8); return <tr key={team.roster.roster_id} className={`${inLottery ? 'lottery-row' : 'playoff-row'} ${busy ? 'dim-row' : ''}`}>
            <td className="rank-cell"><span className={inLottery ? 'pick-number lottery-number' : 'pick-number'}>{String(team.pick).padStart(2, '0')}</span></td><td><span className="franchise-name">{team.name}</span><span className="roster-id">ROSTER {team.roster.roster_id}</span></td>
            <td className="holder-cell" data-label={`${rookieYear} PICK HOLDER`}>{team.pickHolder}{team.pickHolderId !== team.roster.roster_id && <span className="asset-tag">TRADED</span>}</td><td><span className="record-pill">{team.record}</span></td>
            <td><div className="odds-cell">{top.map(({ pick: pickNumber, chance, range }) => <span className={`odds-pill ${pickNumber <= nonPlayoffCount ? 'odds-lottery' : ''}`} key={pickNumber} title={`${Math.round(chance * team.simulationCount)} of ${team.simulationCount} simulations · ${team.modelNames.join(' / ')} range ${formatChance(range.low)}–${formatChance(range.high)}`}><b>{String(pickNumber).padStart(2, '0')}</b><span>{formatChance(chance)}</span><small>{formatChance(range.low)}–{formatChance(range.high)}</small></span>)}</div></td><td className="numeric-cell">{formatNumber(team.maxPf)}</td><td className="numeric-cell">{formatNumber(team.currentMaxPf)}</td>
          </tr> })}
          {!data && <tr><td colSpan={7} className="empty-cell">{busy ? <><RefreshCw size={16} className="spin" /> Loading live league data…</> : 'Enter a public Sleeper league ID and refresh.'}</td></tr>}{data && visiblePicks.length === 0 && <tr><td colSpan={7} className="empty-cell">No teams match “{search}”.</td></tr>}
        </tbody></table></div>}

        <footer className="table-footer"><div className="legend"><span><i className="legend-dot lottery-dot" /> 01—{String(nonPlayoffCount).padStart(2, '0')} REVERSE MAX PF</span><span><i className="legend-dot playoff-dot" /> PLAYOFF FINISH</span><span><ShieldCheck size={14} /> INJURY + BYE ADJUSTED</span></div><span className="simulation-note">{picks.length ? `${picks.length} TEAMS · 5 MODELS · 2,500 SEASONS` : 'SIMULATIONS WILL APPEAR WHEN DATA LOADS'}</span></footer>
      </section>

      <details className="model-details" open>
        <summary>
          <span className="method-icon"><Trophy size={18} /></span>
          <span className="model-heading"><strong>How projected picks are calculated</strong><small>Sleeper projections · league scoring · 5 model methods</small></span>
          <ChevronDown className="model-chevron" size={17} />
        </summary>
        <div className="model-content">
          <div className="model-grid">
            <section><h3>Player-level scoring</h3><p>Sleeper's weekly projected stat lines are scored with this league's exact rules, including TE reception bonuses and simulated 100/200-yard rushing/receiving, 300/400-yard passing, and 25-completion milestone bonuses. Finished games lock in actual points; live games add remaining-time stochastic output to actual points; unstarted games simulate full single-game outcomes.</p></section>
            <section><h3>Bench-aware Max PF</h3><p>Instead of assuming future Max PF equals a pre-game starter projection, every active roster, bench, and taxi player is simulated each week with position-calibrated right-skewed variance and NFL team stack correlation. Starter PF uses pre-kickoff starters, while weekly Max PF computes the exact ex-post optimal lineup across the full roster—capturing real bench boom upside. Bye players score zero. Injuries follow a season-long Markov process: current Out/IR/Doubtful/Questionable tags draw realistic multi-week absence spells, and healthy players can suffer new position-specific injuries each simulated week that persist across following weeks.</p></section>
            <section><h3>Playoff qualification</h3><p>Official Sleeper records and points through the last finalized week are carried forward without double-counting mid-week scores. Both head-to-head matchups and the extra weekly league-median game are simulated across all unscored weeks, seeding teams by record and simulated season Points For into the playoff bracket (supporting fixed or reseeded brackets and completed playoff rounds).</p></section>
            <section><h3>Pick assignment</h3><p>In every simulation, non-playoff teams are ordered strictly by final regular-season Max PF, lowest first, for picks 1–6; playoff bracket finish maps to picks 7–12. Projected slots 01–12 are assigned 1-to-1 by lottery likelihood and expected draft slot so duplicate or skipped pick numbers never occur. Traded picks retain the original franchise's slot while displaying the current owner.</p></section>
          </div>
          <p className="model-caveat">The consensus is the average pick frequency across five player-level models (500 season simulations each, 2,500 total). Every simulated season also draws persistent rest-of-season uncertainty—player role/talent shifts and NFL offense-level shifts that carry across all remaining weeks—so gaps between teams can close or widen realistically instead of averaging out week to week. Player means blend Sleeper projections with each player's recency-weighted actual production (empirical-Bayes shrinkage). Models: compound-process Gamma, heavy-tail log-normal boom/bust, empirical league bootstrap, strong recent-form &amp; lineup efficiency, and elevated injury attrition. Each chip's small range is the lowest-to-highest result among these five models (model sensitivity, not a confidence interval). Sleeper player metadata is cached in local storage for up to 24 hours while Refresh reloads live matchups, projections, and ESPN game progress.</p>
        </div>
      </details>
      <div className="bottom-note">UNOFFICIAL DYNASTY TOOL <span>·</span> LIVE SCORES AND PLAYER PROJECTIONS BY SLEEPER</div>
    </main>
  )
}

export default App
