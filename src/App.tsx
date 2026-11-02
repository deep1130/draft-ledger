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
          <div className="model-heading">
            <span className="model-tag">INTELLIGENCE ARCHITECTURE</span>
            <strong>How projected picks are calculated</strong>
          </div>
          <ChevronDown className="model-chevron" size={17} />
        </summary>
        <div className="model-content">
          <div className="model-cards-grid">
            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">RULES ENGINE</span>
                <h4>1. Scoring &amp; Milestones</h4>
              </div>
              <p>
                Weekly projected stat lines from Sleeper are scored with {data && scoringSummary ? `this league's exact rules (${scoringSummary})` : "this league's exact rules"}.
                {hasMilestoneBonuses
                  ? ' 100/200-yard rushing/receiving, 300/400-yard passing, and milestone bonuses are active and modeled via tail probabilities.'
                  : ' Standard yardage and touchdown multipliers apply without milestone bonuses.'}{' '}
                Completed games lock in actual points, live games add stochastic remaining-game output, and unstarted games simulate full single-game outcomes.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">ROSTER INTEGRITY</span>
                <h4>2. Anti-Tanking Max PF</h4>
              </div>
              <p>
                Dynasty rookie order uses Reverse Max PF to eliminate active tanking. Benching studs does NOT lower Max PF: the engine evaluates every active, bench, and taxi player every week using transversal-matroid bipartite matching to solve the highest possible legal starting lineup in hindsight.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">SCHEDULE SIMULATION</span>
                <h4>3. Standings &amp; {data ? (hasMedianMatch ? 'Median (2 Games/Wk)' : 'H2H (1 Game/Wk)') : 'Matchups'}</h4>
              </div>
              <p>
                Official Sleeper records through finalized weeks are displayed in the table. The current week is actively simulated live: real points lock in as games finish, while upcoming H2H matchups{hasMedianMatch ? ' and weekly median games' : ''} are resolved dynamically inside every simulation run, with simulated Starter Points For breaking ties.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">DRAFT CAPITAL</span>
                <h4>4. Dual-Tier Pick Mapping</h4>
              </div>
              {data ? (
                <p>
                  Draft order is locked at regular season's end (playoff bracket games do not alter rookie picks).
                  {nonPlayoffCount > 0 ? ` Non-playoff teams (seeds ${nonPlayoffCount + 1}–${totalTeams}) receive lottery picks 01–${String(nonPlayoffCount).padStart(2, '0')} ordered strictly by lowest regular-season Max PF.` : ''}
                  {playoffTeamsCount > 0 ? ` Playoff qualifiers (seeds 1–${playoffTeamsCount}) receive picks ${String(nonPlayoffCount + 1).padStart(2, '0')}–${String(totalTeams).padStart(2, '0')} ordered strictly by reverse regular-season finish (seed #${playoffTeamsCount} receives pick ${String(nonPlayoffCount + 1).padStart(2, '0')}, up to the #1 regular-season seed receiving pick ${String(totalTeams).padStart(2, '0')}).` : ''}
                </p>
              ) : (
                <p>
                  Draft order is locked at regular season's end. Non-playoff teams receive lottery picks ordered strictly by lowest regular-season Max PF. Playoff qualifiers receive post-lottery picks ordered strictly by reverse regular-season finish.
                </p>
              )}
            </div>

            <div className="model-card full-width">
              <div className="model-card-header">
                <span className="model-card-tag">MULTI-MODEL METHODOLOGY</span>
                <h4>5. The 6-Engine Ensemble (3,750 Monte Carlo Seasons + Analytical Gaussian CDF)</h4>
              </div>
              <p>
                To avoid relying on any single mathematical assumption, pick odds are determined by an ensemble of <strong>six distinct analytical engines</strong> (750 full remaining regular seasons per Monte Carlo model, plus a closed-form deterministic mathematical engine):
              </p>
              <div className="model-engine-list">
                <div className="model-engine-item">
                  <strong>1. Player-Level Compound Gamma:</strong>
                  Positional dispersion modeling with NFL team-level offensive correlation shocks across remaining matchups.
                </div>
                <div className="model-engine-item">
                  <strong>2. Heavy-Tail Boom / Bust:</strong>
                  Lognormal variance modeling blowout ceiling eruptions and negative game-script floor collapse.
                </div>
                <div className="model-engine-item">
                  <strong>3. Historical League Bootstrap:</strong>
                  Empirically resamples real achieved player point distributions from the active NFL season.
                </div>
                <div className="model-engine-item">
                  <strong>4. Bayesian Form &amp; Lineup Efficiency:</strong>
                  Weights recent multi-week team momentum and actual starter-selection efficiency vs optimal Max PF.
                </div>
                <div className="model-engine-item">
                  <strong>5. Injury Attrition &amp; Depth Stress:</strong>
                  Applies a 1.45&times; elevated injury hazard to stress-test bench depth and roster durability through the winter.
                </div>
                <div className="model-engine-item">
                  <strong>6. Analytical Gaussian CDF:</strong>
                  Closed-form bivariate normal integration with Poisson-Binomial characteristic convolution for exact, zero-noise win distributions.
                </div>
              </div>
              <p style={{ marginTop: '10px' }}>
                <strong>Consensus &amp; Sensitivity Spread:</strong> The large percentage on each pick chip is the consensus average across all 6 engines (balanced via Sinkhorn-Knopp doubly-stochastic normalization so every column and row sums to exactly 100.0%). The small range underneath (e.g. <code>75%–87%</code>) shows model sensitivity—the lowest and highest probability found across the 6 different engine perspectives.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">DEPTH &amp; ATTRITION</span>
                <h4>6. Realistic In-Game Injuries (Markov Chains)</h4>
              </div>
              <p>
                Simulations do not assume players stay healthy through the winter. In every projected future week, active players face real-life, position-calibrated injury hazards: <strong>RB: ~4.6%</strong>, <strong>TE: ~3.6%</strong>, <strong>WR: ~3.3%</strong>, <strong>QB: ~2.2%</strong> per game (plus a +25% fragility factor for players with recent tags).
              </p>
              <p>
                When a player goes down in a simulation run, a multi-week Markov recovery spell is drawn: <strong>48%</strong> miss 1 week, <strong>30%</strong> miss 2–3 weeks, and <strong>22%</strong> suffer severe 4–8+ week absences. Existing Sleeper tags (IR, Out, Doubtful, Questionable) follow calibrated empirical recovery curves. This directly tests each franchise's bench depth—shallow rosters suffer sharp collapses in matchup wins and Max PF, while deep benches insulate rosters and stabilize draft position.
              </p>
            </div>

            {data && nonPlayoffCount > 0 && playoffTeamsCount > 0 ? (
              <div className="model-card">
                <div className="model-card-header">
                  <span className="model-card-tag">SEEDING LOGIC</span>
                  <h4>7. Bubble Mechanics (Pick {String(nonPlayoffCount).padStart(2, '0')} vs. Pick {String(nonPlayoffCount + 1).padStart(2, '0')})</h4>
                </div>
                <p>
                  Pick {String(nonPlayoffCount + 1).padStart(2, '0')} is awarded to the #{playoffTeamsCount} playoff seed.
                  {hasMedianMatch ? (
                    <> In leagues with weekly median matchups ({remainingGames} games decided over the final {remainingWeeks} regular season weeks), a trailing roster that mounts a substantial winning run can secure the final playoff berth, resulting in Pick {String(nonPlayoffCount + 1).padStart(2, '0')}.</>
                  ) : (
                    <> With {remainingWeeks} regular season weeks remaining, a trailing roster that mounts a substantial winning run can secure the final playoff berth, resulting in Pick {String(nonPlayoffCount + 1).padStart(2, '0')}.</>
                  )} Conversely, Pick {String(nonPlayoffCount).padStart(2, '0')} requires missing the postseason entirely while accumulating a higher season Max PF than all {nonPlayoffCount > 1 ? `${nonPlayoffCount - 1} other` : ''} non-playoff rosters.
                </p>
                <p>
                  Because offensive scoring surges naturally correlate with game victories, high-scoring surges predominantly transition rosters into the postseason tier (Pick {String(nonPlayoffCount + 1).padStart(2, '0')}) rather than the upper boundary of the lottery tier (Pick {String(nonPlayoffCount).padStart(2, '0')}).
                </p>
              </div>
            ) : null}

            <div className={`model-card ${(!data || nonPlayoffCount === 0 || playoffTeamsCount === 0) ? 'full-width' : ''}`}>
              <div className="model-card-header">
                <span className="model-card-tag">CAPITAL &amp; OWNERSHIP</span>
                <h4>{data && nonPlayoffCount > 0 && playoffTeamsCount > 0 ? '8. xPick & Traded Picks' : '7. xPick & Traded Picks'}</h4>
              </div>
              <p>
                <strong>Expected Pick (xPick):</strong> The probability-weighted mathematical expectation of draft position (&Sigma; [Pick Number &times; Probability]). While the board ranks franchises by their projected rookie order, xPick provides a continuous numerical measure (e.g. <code>1.4</code> vs <code>2.8</code>) of expected draft capital at a glance.
              </p>
              <p>
                <strong>Traded Pick Ownership:</strong> Traded draft pick records are pulled live from Sleeper. If a team trades away their first-round rookie pick, that pick's order is determined by the original owner's finish, but ownership and lottery rights are tracked and awarded to the acquiring franchise.
              </p>
            </div>
          </div>
        </div>
      </details>
      <div className="bottom-note">UNOFFICIAL DYNASTY TOOL <span>·</span> LIVE SCORES AND PLAYER PROJECTIONS BY SLEEPER</div>
    </main>
  )
}

export default App
