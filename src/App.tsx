import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, ArrowUpRight, Check, ChevronDown, CircleAlert, Clock3, RefreshCw, Search, Share2, ShieldCheck, Trophy } from 'lucide-react'
import { projectDraftOrder } from './projection'
import { loadLeagueData, type LeagueData } from './sleeper'
import './App.css'

type View = 'order' | 'assets'
const formatNumber = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const formatChance = (chance: number) => chance >= 0.995 ? '99%+' : chance === 0 ? '0%' : chance < 0.005 ? '<0.5%' : `${Math.round(chance * 100)}%`

function getInitialLeagueId(): string {
  if (typeof window !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('league')
    if (fromQuery && fromQuery.trim()) return fromQuery.trim()
    const fromHash = window.location.hash.replace(/^#\/?/, '').trim()
    if (fromHash && /^\d+$/.test(fromHash)) return fromHash
    const saved = localStorage.getItem('last_league_id')
    if (saved && saved.trim()) return saved.trim()
  }
  return ''
}

function teamName(data: LeagueData, roster: LeagueData['rosters'][number]): string {
  const owner = data.users.find((user) => user.user_id === roster.owner_id)
  return owner?.metadata?.team_name || owner?.display_name || `Team ${roster.roster_id}`
}

function App() {
  const initialId = useMemo(getInitialLeagueId, [])
  const [leagueId, setLeagueId] = useState(initialId)
  const [data, setData] = useState<LeagueData | null>(null)
  const [busy, setBusy] = useState(Boolean(initialId))
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('order')
  const [search, setSearch] = useState('')
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  async function refresh(targetId?: string) {
    const activeId = (targetId ?? leagueId).trim()
    if (!activeId) {
      setError('Please enter a Sleeper League ID.')
      setBusy(false)
      return
    }
    setBusy(true)
    setError('')
    try {
      const next = await loadLeagueData(activeId)
      setData(next)
      setLastUpdated(next.lastUpdated)
      if (typeof window !== 'undefined') {
        localStorage.setItem('last_league_id', activeId)
        const url = new URL(window.location.href)
        url.searchParams.set('league', activeId)
        window.history.replaceState({}, '', url.toString())
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load league data.')
    } finally {
      setBusy(false)
    }
  }

  async function copyShareUrl() {
    if (typeof window === 'undefined') return
    const activeId = leagueId.trim()
    if (!activeId) return
    const url = new URL(window.location.href)
    url.searchParams.set('league', activeId)
    const shareUrl = url.toString()
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy shareable league URL:', shareUrl)
    }
  }

  useEffect(() => {
    const id = getInitialLeagueId()
    if (id) {
      void refresh(id)
    } else {
      setBusy(false)
    }
  }, [])

  const picks = useMemo(() => (data ? projectDraftOrder(data) : []), [data])
  const query = search.trim().toLowerCase()
  const visiblePicks = picks.filter((team) => `${team.name} ${team.pickHolder} ${team.record}`.toLowerCase().includes(query))
    .sort((first, second) => first.pick - second.pick)
  const rookieYear = Number(data?.league.season ?? 2026) + 1
  const tradedCount = data?.tradedPicks.filter((pick) => Number(pick.season) === Number(data.league.season) + 1 && pick.round === 1).length ?? 0
  const totalTeams = data?.rosters.length ?? 0
  const playoffTeamsCount = data ? Math.min(totalTeams, Math.max(0, Number(data.league.settings.playoff_teams ?? 6))) : 6
  const nonPlayoffCount = data ? Math.max(0, totalTeams - playoffTeamsCount) : 6
  const currentWeek = data?.currentWeek ?? 0
  const hasMedianMatch = Number(data?.league.settings.league_average_match) === 1
  const regularSeasonEnd = data ? Math.min(18, Math.max(1, (Number(data.league.settings.playoff_week_start) || 15) - 1)) : 14
  const remainingWeeks = data ? Math.max(0, regularSeasonEnd - Math.max(1, data.currentWeek) + 1) : 0
  const remainingGames = remainingWeeks * (hasMedianMatch ? 2 : 1)

  const scoring = data?.league.scoring_settings
  const scoringSummary = useMemo(() => {
    if (!scoring) return null
    const parts: string[] = []
    const ppr = Number(scoring.rec ?? 0)
    parts.push(ppr === 1 ? '1 PPR' : ppr === 0.5 ? '0.5 Half-PPR' : `${ppr} PPR`)
    if (scoring.bonus_rec_te) {
      parts.push(`+${scoring.bonus_rec_te} TE premium`)
    }
    if (scoring.pass_yd) {
      parts.push(`${scoring.pass_yd} pass yd`)
    }
    if (scoring.pass_td) {
      parts.push(`${scoring.pass_td} pass TD`)
    }
    if (scoring.pass_int) {
      parts.push(`${scoring.pass_int} INT`)
    }
    if (scoring.rush_yd) {
      parts.push(`${scoring.rush_yd} rush yd`)
    }
    if (scoring.rec_yd) {
      parts.push(`${scoring.rec_yd} rec yd`)
    }
    return parts.join(', ')
  }, [scoring])

  const hasMilestoneBonuses = useMemo(() => {
    if (!scoring) return false
    return Boolean(
      scoring.bonus_rec_yd_100 ||
      scoring.bonus_rec_yd_200 ||
      scoring.bonus_rush_yd_100 ||
      scoring.bonus_rush_yd_200 ||
      scoring.bonus_rush_rec_yd_100 ||
      scoring.bonus_rush_rec_yd_200 ||
      scoring.bonus_pass_yd_300 ||
      scoring.bonus_pass_yd_400 ||
      scoring.bonus_pass_cmp_25
    )
  }, [scoring])

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Draft Ledger home"><span className="brand-mark"><ArrowDownUp size={17} strokeWidth={2.5} /></span><span>DRAFT<span className="brand-light">LEDGER</span></span></a>
        <div className="topbar-right"><span className="season-label">DYNASTY / {data?.league.season ?? '2026'}</span><span className="live-dot" /><span className="live-label">LIVE DATA</span></div>
      </header>

      <section className="intro" id="top">
        <div><p className="eyebrow">PICK POSITION INTELLIGENCE <span>·</span> WEEK {currentWeek || '--'}</p><h1>Draft order, <em>in motion.</em></h1><p className="intro-copy">A live read on where the rookie picks are headed, shaped by every point, bye and roster move.</p></div>
        <div className="league-control">
          <label htmlFor="league-id">SLEEPER LEAGUE ID</label>
          <div className="league-input-row">
            <input
              id="league-id"
              value={leagueId}
              onChange={(event) => setLeagueId(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void refresh() }}
              placeholder="League ID"
              aria-label="Sleeper League ID"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="button"
              className={`share-button ${copied ? 'copied' : ''}`}
              onClick={() => void copyShareUrl()}
              title="Copy shareable link to this league"
            >
              {copied ? <Check size={13} /> : <Share2 size={13} />}
              <span>{copied ? 'COPIED' : 'SHARE'}</span>
            </button>
            <button
              type="button"
              className="refresh-button"
              onClick={() => void refresh()}
              disabled={busy || !leagueId.trim()}
              title="Refresh live data"
            >
              <RefreshCw size={14} className={busy ? 'spin' : ''} />
              <span>{busy ? 'UPDATING' : 'REFRESH'}</span>
            </button>
          </div>
          <div className="refresh-meta">
            <Clock3 size={12} /> {lastUpdated ? `UPDATED ${new Date(lastUpdated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · MANUAL REFRESH` : 'ENTER A SLEEPER LEAGUE ID AND CLICK REFRESH'}
          </div>
        </div>
      </section>

      {error && <div className="error-banner"><CircleAlert size={16} /><span>Live data unavailable: {error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

      <section className="summary-strip" aria-label="League summary">
        <div className="summary-item"><span className="summary-label">LEAGUE</span><strong>{data?.league.name ?? (busy ? 'Connecting…' : 'No league connected')}</strong><span className="summary-note">{data ? `${totalTeams} franchises · ${data.league.scoring_settings.rec ?? 0} PPR${data.league.scoring_settings.bonus_rec_te ? ` (+${data.league.scoring_settings.bonus_rec_te} TEP)` : ''}` : 'Enter a league ID above'}</span></div>
        <div className="summary-item"><span className="summary-label">REGULAR SEASON</span><strong>WEEK {currentWeek || '--'} <span className="summary-muted">/ {regularSeasonEnd}</span></strong><span className="summary-note">{data ? 'Current week + remaining projections' : 'Awaiting league ID'}</span></div>
        <div className="summary-item"><span className="summary-label">LOTTERY PICKS</span><strong>{data ? `01 — ${String(nonPlayoffCount).padStart(2, '0')}` : '—'}</strong><span className="summary-note">Reverse Max Points For</span></div>
        <div className="summary-item"><span className="summary-label">PICKS IN PLAY</span><strong>{data ? `${tradedCount} TRADED` : '—'}</strong><span className="summary-note">{data ? `${rookieYear} first-round ownership` : 'Awaiting league ID'}</span></div>
      </section>

      <section className="projection-section">
        <div className="section-heading"><div><p className="eyebrow">THE BOARD <span>·</span> {data?.league.name.toUpperCase() ?? 'SLEEPER DYNASTY'}</p><h2>{view === 'assets' ? 'Traded pick assets' : 'Projected rookie order'}</h2></div><div className="board-tools"><div className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a team" aria-label="Find a team" /></div><div className="view-tabs" role="tablist" aria-label="Board view"><button type="button" role="tab" aria-selected={view === 'order'} className={view === 'order' ? 'selected' : ''} onClick={() => setView('order')}>PICK ORDER</button><button type="button" role="tab" aria-selected={view === 'assets'} className={view === 'assets' ? 'selected' : ''} onClick={() => setView('assets')}>PICK ASSETS</button></div></div></div>

        {view === 'assets' ? <div className="table-wrap"><table><thead><tr><th>ORIGINAL PICK</th><th>CURRENT HOLDER</th><th>ROUND</th><th>SEASON</th><th>STATUS</th></tr></thead><tbody>
          {data?.tradedPicks.filter((pick) => Number(pick.season) === Number(data.league.season) + 1).sort((a, b) => a.round - b.round || a.roster_id - b.roster_id).map((pick) => { const origin = data.rosters.find((roster) => roster.roster_id === pick.roster_id); const holder = data.rosters.find((roster) => roster.roster_id === pick.owner_id); return <tr className="asset-row" key={`${pick.season}-${pick.round}-${pick.roster_id}`}><td>{origin ? teamName(data, origin) : `Team ${pick.roster_id}`}</td><td className="holder-cell">{holder ? teamName(data, holder) : `Team ${pick.owner_id}`} {pick.round === 1 && <span className="asset-tag">LOTTERY TRACKED</span>}</td><td>ROUND {pick.round}</td><td>{pick.season}</td><td><span className="trade-mark"><ArrowUpRight size={13} /> TRADED</span></td></tr> })}
          {data && <tr className="owned-picks-row"><td colSpan={5}>Unlisted picks remain with their original franchise. Sleeper is the source of truth for traded-pick ownership.</td></tr>}{!data && <tr><td colSpan={5} className="empty-cell">{busy ? 'Loading traded picks…' : 'Enter a Sleeper league ID above to see pick assets.'}</td></tr>}
        </tbody></table></div> : <div className="table-wrap"><table><thead><tr><th className="rank-col">{view === 'order' ? 'PICK' : 'SEED'}</th><th>FRANCHISE</th>{view === 'order' && <th>{rookieYear} PICK HOLDER</th>}<th>CURRENT RECORD</th><th>{view === 'order' ? 'PICK ODDS' : 'PLAYOFF CHANCE'}</th><th>xPICK</th><th>PROJECTED MAX PF</th><th>CURRENT MAX PF</th></tr></thead><tbody>
          {visiblePicks.map((team) => { const inLottery = team.pick <= nonPlayoffCount; const top = team.probabilities.map((chance, pick) => ({ pick: pick + 1, chance, range: team.probabilityRanges[pick] })).filter((outcome) => outcome.chance > 0).sort((a, b) => b.chance - a.chance || a.pick - b.pick).slice(0, 8); return <tr key={team.roster.roster_id} className={`${inLottery ? 'lottery-row' : 'playoff-row'} ${busy ? 'dim-row' : ''}`}>
            <td className="rank-cell"><span className={inLottery ? 'pick-number lottery-number' : 'pick-number'}>{String(team.pick).padStart(2, '0')}</span></td>
            <td className="franchise-cell"><span className="franchise-name" title={team.name}>{team.name}</span></td>
            <td className="holder-cell" data-label={`${rookieYear} PICK HOLDER`} title={team.pickHolder}>{team.pickHolder}{team.pickHolderId !== team.roster.roster_id && <span className="asset-tag">TRADED</span>}</td>
            <td className="record-cell"><span className="record-pill">{team.record}</span></td>
            <td className="odds-cell-td"><div className="odds-cell">{top.map(({ pick: pickNumber, chance, range }) => <span className={`odds-pill ${pickNumber <= nonPlayoffCount ? 'odds-lottery' : ''}`} key={pickNumber}><b>{String(pickNumber).padStart(2, '0')}</b><span>{formatChance(chance)}</span><small>{formatChance(range.low)}–{formatChance(range.high)}</small></span>)}</div></td>
            <td className="numeric-cell xpick-cell"><span className={`xpick-pill ${inLottery ? 'xpick-lottery' : ''}`}>{team.expectedPick.toFixed(1)}</span></td>
            <td className="numeric-cell proj-maxpf-cell">{formatNumber(team.maxPf)}</td>
            <td className="numeric-cell curr-maxpf-cell">{formatNumber(team.currentMaxPf)}</td>
          </tr> })}
          {!data && <tr><td colSpan={8} className="empty-cell">{busy ? <><RefreshCw size={16} className="spin" /> Loading live league data…</> : <div className="empty-league-prompt"><p>Enter your Sleeper League ID above to generate live draft pick projections.</p></div>}</td></tr>}{data && visiblePicks.length === 0 && <tr><td colSpan={8} className="empty-cell">No teams match “{search}”.</td></tr>}
        </tbody></table></div>}

        <footer className="table-footer"><div className="legend"><span><i className="legend-dot lottery-dot" /> 01—{String(nonPlayoffCount).padStart(2, '0')} REVERSE MAX PF</span><span><i className="legend-dot playoff-dot" /> PLAYOFF SEED</span><span><ShieldCheck size={14} /> INJURY + BYE ADJUSTED</span></div><span className="simulation-note">{picks.length ? `${picks.length} TEAMS · 6 ENGINES · 3,750 SEASONS + ANALYTICAL CDF` : 'SIMULATIONS WILL APPEAR WHEN DATA LOADS'}</span></footer>
      </section>

      <details className="model-details" open>
        <summary>
          <span className="method-icon"><Trophy size={18} /></span>
          <span className="model-heading"><strong>How projected picks are calculated</strong><small>Sleeper projections · 5 Monte Carlo engines + Analytical Gaussian CDF</small></span>
          <ChevronDown className="model-chevron" size={17} />
        </summary>
        <div className="model-content">
          <div className="model-grid">
            <section>
              <h3>Player &amp; milestone scoring</h3>
              <p>
                Weekly projected stat lines from Sleeper are scored with {data && scoringSummary ? `this league's exact rules (${scoringSummary})` : "this league's exact rules"}.
                {hasMilestoneBonuses
                  ? ' 100/200-yard rushing/receiving, 300/400-yard passing, and milestone bonuses are simulated via tail probabilities.'
                  : ' Milestone bonuses (e.g. 100yd rush/rec) are active only if configured in Sleeper.'}{' '}
                Completed games lock in actual points, live games add stochastic remaining-game output, and unstarted games simulate full single-game outcomes.
              </p>
            </section>
            <section>
              <h3>Bench-aware Max PF (Matroid)</h3>
              <p>
                Instead of assuming future Max PF equals a pre-game starter projection, every active, bench, and taxi player is simulated each week with position-calibrated right-skewed variance and NFL team stack shocks. Starter PF uses pre-kickoff starters, while weekly Max PF solves the exact ex-post optimal legal starting lineup (via transversal-matroid bipartite matching)—capturing true bench boom upside. Bye players score zero. Current injury tags draw realistic multi-week Markov spells, and healthy players can suffer new injuries that persist across future weeks.
              </p>
            </section>
            <section>
              <h3>Standings &amp; {data ? (hasMedianMatch ? 'median (2 games/wk)' : 'H2H matchups (1 game/wk)') : 'matchups'}</h3>
              <p>
                Official Sleeper records through the last finalized week are displayed in the table. The current in-progress week is actively simulated: completed NFL games lock in their real points, live games add stochastic remaining output, and current-week H2H matchups{hasMedianMatch ? ' and median games' : ''} are decided directly inside each simulation run before projecting future weeks. Standings are ranked by win percentage, with simulated season Starter Points For breaking ties.
              </p>
            </section>
            <section>
              <h3>Dual-tier pick mapping</h3>
              {data ? (
                <p>
                  Draft picks are locked based on regular-season finish (playoff tournament games do not alter rookie pick order).
                  {nonPlayoffCount > 0 ? ` Non-playoff teams (seeds ${nonPlayoffCount + 1}–${totalTeams}) are ordered strictly by final regular-season Max PF, lowest first, for picks 01–${String(nonPlayoffCount).padStart(2, '0')}.` : ''}
                  {playoffTeamsCount > 0 ? ` Playoff qualifiers (seeds 1–${playoffTeamsCount}) are ordered strictly by reverse regular-season seed for picks ${String(nonPlayoffCount + 1).padStart(2, '0')}–${String(totalTeams).padStart(2, '0')}: the #${playoffTeamsCount} seed receives pick ${String(nonPlayoffCount + 1).padStart(2, '0')}, up to the #1 regular-season seed receiving pick ${String(totalTeams).padStart(2, '0')}.` : ''}
                </p>
              ) : (
                <p>
                  Draft picks are locked based on regular-season finish (playoff tournament games do not alter rookie pick order). Non-playoff teams are ordered strictly by final regular-season Max PF, lowest first, for lottery picks. Playoff qualifiers are ordered strictly by reverse regular-season finish for post-lottery picks.
                </p>
              )}
            </section>
          </div>
          {data && nonPlayoffCount > 0 && playoffTeamsCount > 0 && (
            <p className="model-caveat">
              <strong>Lottery vs. Playoff Seeding Mechanics:</strong> Pick {String(nonPlayoffCount + 1).padStart(2, '0')} is awarded to the #{playoffTeamsCount} playoff seed.
              {hasMedianMatch ? (
                <> In leagues with weekly median matchups ({remainingGames} games decided over the final {remainingWeeks} regular season weeks), a trailing roster that mounts a substantial winning run can secure the final playoff berth, resulting in Pick {String(nonPlayoffCount + 1).padStart(2, '0')}.</>
              ) : (
                <> With {remainingWeeks} regular season weeks remaining, a trailing roster that mounts a substantial winning run can secure the final playoff berth, resulting in Pick {String(nonPlayoffCount + 1).padStart(2, '0')}.</>
              )} Conversely, Pick {String(nonPlayoffCount).padStart(2, '0')} requires missing the postseason entirely while accumulating a higher season Max PF than all {nonPlayoffCount > 1 ? `${nonPlayoffCount - 1} other` : ''} non-playoff rosters. For a roster with a low current Max PF baseline, that outcome requires an uncommon divergence where bench production surges for Max PF while starting lineups fail to win matchups{hasMedianMatch ? ' or surpass weekly medians' : ''}. Because offensive surges naturally correlate with game victories, high-scoring outcomes predominantly transition rosters into the postseason tier (Pick {String(nonPlayoffCount + 1).padStart(2, '0')}) rather than the upper boundary of the lottery tier (Pick {String(nonPlayoffCount).padStart(2, '0')}).
            </p>
          )}
          <p className="model-caveat"><strong>Expected Pick (xPick):</strong> The probability-weighted average draft slot across all 6 projection engines (&Sigma; [probability &times; slot]). While the main table ranks teams by their projected draft order, xPick provides a continuous mathematical expectation of draft position at a glance.</p>
          <p className="model-caveat"><strong>Simulation Methodology &amp; Multi-Engine Ensemble:</strong> Pick odds chips reflect the consensus average across six independent analytical engines: five Monte Carlo simulation engines (3,750 full seasons total, 750 per engine: player-level compound Gamma, heavy-tail log-normal with in-game risk, empirical historical bootstrap, empirical-Bayes form and starter efficiency calibration, and multi-week Markov injury attrition) plus a deterministic Analytical Gaussian Convolution Engine (using closed-form bivariate normal integration and Poisson-Binomial characteristic convolution to calculate exact win distributions). Model sensitivity ranges displayed under each chip report the min-to-max spread across all six engines.</p>
        </div>
      </details>
      <div className="bottom-note">UNOFFICIAL DYNASTY TOOL <span>·</span> LIVE SCORES AND PLAYER PROJECTIONS BY SLEEPER</div>
    </main>
  )
}

export default App
