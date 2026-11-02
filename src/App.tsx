import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, ArrowUpRight, Calculator, Check, ChevronDown, CircleAlert, Clock3, RefreshCw, Search, Share2, ShieldCheck, Trophy } from 'lucide-react'
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

        <footer className="table-footer"><div className="legend"><span><i className="legend-dot lottery-dot" /> 01—{String(nonPlayoffCount).padStart(2, '0')} REVERSE MAX PF</span><span><i className="legend-dot playoff-dot" /> PLAYOFF SEED</span><span><ShieldCheck size={14} /> INJURY + BYE ADJUSTED</span></div><span className="simulation-note">{picks.length ? `${picks.length} TEAMS · ${picks[0]?.modelNames.length ?? 13} ENGINES · ${(picks[0]?.simulationCount ?? 6000).toLocaleString('en-US')} SEASONS + EXACT MATH` : 'SIMULATIONS WILL APPEAR WHEN DATA LOADS'}</span></footer>
      </section>

      <details className="model-details" open>
        <summary>
          <span className="method-icon"><Trophy size={18} /></span>
          <div className="model-heading">
            <span className="model-tag">METHODOLOGY &amp; MATHEMATICS</span>
            <strong>How draft pick odds are calculated (College-Level Specification)</strong>
          </div>
          <ChevronDown className="model-chevron" size={17} />
        </summary>
        <div className="model-content">
          <div className="model-cards-grid">
            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">RULES &amp; CONTINUOUS SCORING</span>
                <h4>1. League Coefficients &amp; Milestone Integrals</h4>
                <div className="model-formula-pill">∫_T^∞ f(x) dx · Γ(k)</div>
              </div>
              <p>
                Weekly player stat lines from Sleeper are converted through {data && scoringSummary ? `this league's exact scoring vector (${scoringSummary})` : "this league's exact scoring vector"}.
                {hasMilestoneBonuses
                  ? ' High-yardage milestone triggers (100-yard rushing/receiving, 300-yard passing) are evaluated via upper-tail definite integrals under continuous '
                  : ' Standard yardage and touchdown multipliers apply without milestone bonuses. '}{' '}
                {hasMilestoneBonuses ? <a href="https://en.wikipedia.org/wiki/Gamma_distribution" target="_blank" rel="noopener noreferrer">Gamma distribution</a> : null}{hasMilestoneBonuses ? ' curves. ' : ''}
                Finalized NFL games lock in observed point totals; games in progress integrate remaining clock and drive possession volume; and upcoming matchups model full continuous scoring densities.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">COMBINATORIAL OPTIMIZATION</span>
                <h4>2. Optimal Hindsight Lineups &amp; Max PF</h4>
                <div className="model-formula-pill">max_{'{'}I ∈ ℐ{'}'} ∑ w(e)</div>
              </div>
              <p>
                In dynasty leagues, non-playoff rookie order uses <strong>Max Points For (Max PF)</strong> to eliminate strategic tanking incentives.
              </p>
              <p>
                Weekly roster eligibility forms a bipartite system between player assets and lineup slots. Because valid roster allocations satisfy the independent set axioms of a <a href="https://en.wikipedia.org/wiki/Transversal_matroid" target="_blank" rel="noopener noreferrer">Transversal Matroid</a>, the maximum-weight hindsight lineup across all active, bench, and taxi players is solved in O(|E| log |E|) greedy augmenting time. Benching elite starters cannot mathematically depress a roster's Max PF.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">SCHEDULE STOCHASTICS</span>
                <h4>3. Matchup Schedules &amp; {data ? (hasMedianMatch ? 'Median Games' : 'Standings') : 'Standings'}</h4>
                <div className="model-formula-pill">W = ∑ I_i · PF Ties</div>
              </div>
              <p>
                Official Sleeper records through completed weeks establish the empirical prior. For all remaining regular-season weeks, head-to-head pairings{hasMedianMatch ? ' and weekly league median games' : ''} are simulated dynamically across each trial. Standings distributions update continuously, with simulated season Starter Points For breaking any record ties according to official league bylaws.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">DRAFT CAPITAL MAPPING</span>
                <h4>4. Dual-Tier Partitioning (Lottery vs. Playoff Seeds)</h4>
                <div className="model-formula-pill">min(Max PF) → Pick 01</div>
              </div>
              {data ? (
                <p>
                  At regular season conclusion, the league partitions into two non-overlapping tiers (postseason bracket games do not modify rookie draft capital):
                  {nonPlayoffCount > 0 ? (
                    <>
                      <br />
                      <strong>• Lottery Tier (Picks 01–{String(nonPlayoffCount).padStart(2, '0')}):</strong> Franchises that fail to qualify for the postseason, ordered strictly in ascending order of regular-season Max PF (the lowest-scoring roster is awarded Pick 01).
                    </>
                  ) : ''}
                  {playoffTeamsCount > 0 ? (
                    <>
                      <br />
                      <strong>• Playoff Tier (Picks {String(nonPlayoffCount + 1).padStart(2, '0')}–{String(totalTeams).padStart(2, '0')}):</strong> Postseason qualifiers, ordered in reverse of regular-season seeding finish (Seed #{playoffTeamsCount} receives Pick {String(nonPlayoffCount + 1).padStart(2, '0')}; the #1 regular-season seed receives Pick {String(totalTeams).padStart(2, '0')}).
                    </>
                  ) : ''}
                </p>
              ) : (
                <p>
                  At regular season conclusion, the league partitions into two non-overlapping tiers. Non-playoff franchises receive lottery picks ordered strictly in ascending order of regular-season Max PF. Postseason qualifiers receive post-lottery picks ordered in reverse of regular-season finish.
                </p>
              )}
            </div>

            <div className="model-card full-width">
              <div className="model-card-header">
                <span className="model-card-tag">MULTI-MODEL ENSEMBLE</span>
                <h4>5. The 13-Engine Multi-Model Ensemble (6,000 Monte Carlo Seasons + Exact Math)</h4>
                <div className="model-formula-pill">lim_{'{'}k→∞{'}'} D₁^(k) M D₂^(k) = P* ∈ ℬ_n</div>
              </div>
              <p>
                To eliminate reliance on any single mathematical hypothesis, rookie draft odds are integrated across <strong>13 distinct analytical engines</strong> (12 <a href="https://en.wikipedia.org/wiki/Monte_Carlo_method" target="_blank" rel="noopener noreferrer">Monte Carlo</a> engines running 500 complete regular seasons each = 6,000 trials, plus a deterministic closed-form analytical engine):
              </p>
              <div className="model-engine-list">
                <div className="model-engine-item">
                  <strong>1. Positional Dispersion Gamma:</strong>
                  Continuous player scoring with variance scaling with the mean (σ = θ√μ), coupled to NFL team offensive correlation shocks.
                </div>
                <div className="model-engine-item">
                  <strong>2. Heavy-Tail Lognormal Boom/Bust:</strong>
                  Asymmetric distribution modeling blowout ceilings and negative game-script floor collapse.
                </div>
                <div className="model-engine-item">
                  <strong>3. Empirical League Bootstrap:</strong>
                  Non-parametric resampling from observed active-season NFL player game logs.
                </div>
                <div className="model-engine-item">
                  <strong>4. Bayesian Form &amp; Lineup Efficiency:</strong>
                  <a href="https://en.wikipedia.org/wiki/Empirical_Bayes_method" target="_blank" rel="noopener noreferrer">Empirical Bayes</a> shrinkage weighting multi-week momentum against manager starter-capture efficiency.
                </div>
                <div className="model-engine-item">
                  <strong>5. Elevated Injury Hazard (1.5&times;):</strong>
                  Stress-tests roster resilience under above-average late-season attrition.
                </div>
                <div className="model-engine-item">
                  <strong>6. Severe Absence Shock (2.0&times;):</strong>
                  Simulates acute injury cascades to identify severe bench failure points.
                </div>
                <div className="model-engine-item">
                  <strong>7. Game-Script Shootout &amp; Stacking:</strong>
                  Amplifies covariance between quarterbacks and pass-catchers in high-total shootouts.
                </div>
                <div className="model-engine-item">
                  <strong>8. Dynasty Youth &amp; Rookie Breakouts:</strong>
                  Models second-half rookie snap expansion and late-season youth surges vs. veteran wear.
                </div>
                <div className="model-engine-item">
                  <strong>9. Low-Variance Baseline Chalk:</strong>
                  Tight median expectations modeling predictable floor outcomes.
                </div>
                <div className="model-engine-item">
                  <strong>10. Contender vs. Rebuilder Management:</strong>
                  Models strategic lineup divergence—contenders optimize floor while rebuilders evaluate youth.
                </div>
                <div className="model-engine-item">
                  <strong>11. Power-Law Fat-Tail Outliers:</strong>
                  Pareto mixture models capturing monster 40+ point explosions alongside early exit risks.
                </div>
                <div className="model-engine-item">
                  <strong>12. Starting QB Injury Domino:</strong>
                  Cascades target quality and efficiency drops to receivers when their starting QB is sidelined.
                </div>
                <div className="model-engine-item">
                  <strong>13. Closed-Form Analytical Math:</strong>
                  Evaluates <a href="https://en.wikipedia.org/wiki/Poisson_binomial_distribution" target="_blank" rel="noopener noreferrer">Poisson-Binomial</a> convolutions and <a href="https://en.wikipedia.org/wiki/Normal_distribution#Cumulative_distribution_function" target="_blank" rel="noopener noreferrer">Gaussian CDF integrals</a> for zero-noise win distributions.
                </div>
              </div>
              <p style={{ marginTop: '10px' }}>
                <strong>Doubly-Stochastic Normalization &amp; Sensitivity:</strong> The large percentage on each pick chip is the consensus probability, projected onto the <a href="https://en.wikipedia.org/wiki/Doubly_stochastic_matrix" target="_blank" rel="noopener noreferrer">Birkhoff polytope</a> via the <a href="https://en.wikipedia.org/wiki/Sinkhorn%27s_theorem" target="_blank" rel="noopener noreferrer">Sinkhorn-Knopp algorithm</a> so all team and pick margins sum to exactly 100.0%. The sensitivity interval underneath ([min P_m, max P_m]) bounds model uncertainty across the 13 hypotheses.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">STOCHASTIC PROCESSES</span>
                <h4>6. Markov Chain Injury Hazards &amp; Bench Insulation</h4>
                <div className="model-formula-pill">s_{'{'}t+1{'}'} = s_t · P(λ_pos, μ_rec)</div>
              </div>
              <p>
                Weekly player availability is governed by a discrete-time <a href="https://en.wikipedia.org/wiki/Markov_chain" target="_blank" rel="noopener noreferrer">Markov Chain</a> with transition hazards calibrated from empirical NFL snap data: <strong>Running Backs (~4.6%)</strong>, <strong>Tight Ends (~3.6%)</strong>, <strong>Wide Receivers (~3.3%)</strong>, and <strong>Quarterbacks (~2.2%)</strong> per game, with existing injury tags following exponential recovery half-lives.
              </p>
              <p>
                When starters are sidelined, the rules engine dynamically promotes bench assets into active scoring and Max PF.
              </p>
              <p>
                This mathematically isolates fragile, top-heavy rosters (which suffer steep variance collapses when starters go down) from insulated rosters with sufficient bench depth to preserve scoring floors.
              </p>
            </div>

            {data && nonPlayoffCount > 0 && playoffTeamsCount > 0 ? (
              <div className="model-card">
                <div className="model-card-header">
                  <span className="model-card-tag">SEEDING DYNAMICS</span>
                  <h4>7. The Playoff Bubble Boundary (Pick {String(nonPlayoffCount).padStart(2, '0')} vs. Pick {String(nonPlayoffCount + 1).padStart(2, '0')})</h4>
                  <div className="model-formula-pill">Seed #{playoffTeamsCount} ↔ Pick {String(nonPlayoffCount + 1).padStart(2, '0')}</div>
                </div>
                <p>
                  Pick {String(nonPlayoffCount + 1).padStart(2, '0')} is awarded to the final playoff qualifier (Seed #{playoffTeamsCount}). In leagues with weekly median scoring ({remainingGames} total decisions over the final {remainingWeeks} weeks), a strong late-season scoring surge correlates strongly with matchup and median victories, carrying teams over the playoff threshold into Pick {String(nonPlayoffCount + 1).padStart(2, '0')}.
                </p>
                <p>
                  Conversely, Pick {String(nonPlayoffCount).padStart(2, '0')} requires accumulating higher season Max PF than all {nonPlayoffCount > 1 ? `${nonPlayoffCount - 1} other` : ''} lottery rosters while simultaneously failing to qualify for the postseason. Because offensive scoring surges produce game victories, high-scoring rosters predominantly transition into the postseason tier rather than the upper lottery boundary.
                </p>
              </div>
            ) : null}

            <div className={`model-card ${(!data || nonPlayoffCount === 0 || playoffTeamsCount === 0) ? 'full-width' : ''}`}>
              <div className="model-card-header">
                <span className="model-card-tag">DRAFT CAPITAL</span>
                <h4>{data && nonPlayoffCount > 0 && playoffTeamsCount > 0 ? '8. Expected Value (xPick) & Traded Asset Rights' : '7. Expected Value (xPick) & Traded Asset Rights'}</h4>
                <div className="model-formula-pill">E[X] = ∑ j · P(Pick = j)</div>
              </div>
              <p>
                <strong>Expected Pick (xPick):</strong> The first statistical moment (<a href="https://en.wikipedia.org/wiki/Expected_value" target="_blank" rel="noopener noreferrer">Expected Value</a>) of the rookie pick distribution E[Pick] = ∑ j · P(Pick = j), compressing multi-modal draft distributions into a continuous draft capital scalar.
              </p>
              <p>
                <strong>Traded Asset Ownership:</strong> Traded draft capital is tracked live via Sleeper. If Franchise A owns Franchise B's pick, the selection slot is governed strictly by Franchise B's mathematical finish, while ownership rights are assigned to Franchise A on the board.
              </p>
            </div>
          </div>

          <details className="math-deep-dive">
            <summary>
              <span className="method-icon math-method-icon"><Calculator size={16} /></span>
              <div className="model-heading">
                <span className="math-tag">TECHNICAL DEEP DIVE</span>
                <strong>College-Level Math &amp; Algorithm Reference (Calculus &amp; Linear Algebra)</strong>
              </div>
              <span className="math-badge">Calculus &amp; Proofs</span>
              <ChevronDown className="model-chevron" size={16} />
            </summary>
            <div className="math-deep-dive-body">
              <p className="math-intro-p">
                For engineers, mathematicians, and fantasy players interested in the rigorous calculus, probability theory, and discrete optimization algorithms running behind the scenes, here is the formal mathematical specification with links to foundational literature:
              </p>

              <div className="math-cards-grid">
                <div className="math-card">
                  <div className="math-card-header">
                    <span className="math-card-tag">CALCULUS &amp; PROBABILITY</span>
                    <h4>1. Continuous Scoring Densities &amp; Milestone Integrals</h4>
                  </div>
                  <div className="math-formula-box">
{`f(x; k, θ) = (1 / [Γ(k) θ^k]) * x^(k-1) * e^(-x/θ)
E[X] = ∫₀^∞ x f(x) dx = kθ = μ
Var(X) = kθ² = θ²μ   (σ = θ√μ)
P(X ≥ T) = ∫_T^∞ f(x) dx = 1 - γ(k, T/θ) / Γ(k)`}
                  </div>
                  <p>
                    Weekly player fantasy scoring X is modeled as a continuous random variable following a Gamma density function. Rather than assuming constant variance, positional dispersion scales as σ = θ√μ, reflecting that high-volume starters carry wider absolute point spreads. Yardage milestone bonuses (e.g. 100-yard rushing or 300-yard passing thresholds) are evaluated via improper definite integrals over upper tail thresholds.
                  </p>
                  <a href="https://en.wikipedia.org/wiki/Gamma_distribution" target="_blank" rel="noopener noreferrer" className="math-wiki-link">
                    <span>Read Wikipedia: Gamma distribution</span>
                    <ArrowUpRight size={12} />
                  </a>
                </div>

                <div className="math-card">
                  <div className="math-card-header">
                    <span className="math-card-tag">DISCRETE COMBINATORICS</span>
                    <h4>2. Greedy Transversal Matroid Matching (Max PF)</h4>
                  </div>
                  <div className="math-formula-box">
{`max_{I ∈ ℐ} ∑_{e ∈ I} w(e)
where ℐ = { I ⊆ V_players : I matchable in bipartite graph G }
Greedy matroid optimality: O(|E| log |E|)`}
                  </div>
                  <p>
                    Dynasty non-playoff draft order uses Max Points For (Max PF) to prevent tanking. Evaluating valid starter lineups over position eligibility slots forms a bipartite system. Because the family of matchable subsets forms a transversal matroid satisfying the Rado-Edmonds exchange property, the globally optimal hindsight lineup is solved in O(|E| log |E|) greedy time. Benching stars cannot depress a team's Max PF.
                  </p>
                  <a href="https://en.wikipedia.org/wiki/Transversal_matroid" target="_blank" rel="noopener noreferrer" className="math-wiki-link">
                    <span>Read Wikipedia: Transversal matroid</span>
                    <ArrowUpRight size={12} />
                  </a>
                </div>

                <div className="math-card">
                  <div className="math-card-header">
                    <span className="math-card-tag">MULTIVARIABLE CALCULUS</span>
                    <h4>3. Gaussian Cumulative Matchup Integrals</h4>
                  </div>
                  <div className="math-formula-box">
{`D = S_A - S_B  ~  N(μ_D, σ_D²)
μ_D = μ_A - μ_B,   σ_D² = σ_A² + σ_B² - 2Cov(S_A, S_B)
P(S_A > S_B) = ∫₀^∞ (1 / [σ_D √(2π)]) e^(-(z - μ_D)² / (2σ_D²)) dz
             = 1/2 [ 1 + erf( μ_D / [σ_D √2] ) ]`}
                  </div>
                  <p>
                    In Engine 13, two opposing teams with starter score distributions S_A and S_B yield a score difference D = S_A - S_B. The exact head-to-head win probability is the double integral of the joint Gaussian density over the positive half-space, evaluated in closed form using the Gauss error function erf(z) with zero sampling noise.
                  </p>
                  <a href="https://en.wikipedia.org/wiki/Error_function" target="_blank" rel="noopener noreferrer" className="math-wiki-link">
                    <span>Read Wikipedia: Error function (erf) &amp; Normal CDF</span>
                    <ArrowUpRight size={12} />
                  </a>
                </div>

                <div className="math-card">
                  <div className="math-card-header">
                    <span className="math-card-tag">GENERATING FUNCTIONS</span>
                    <h4>4. Exact Win Convolutions (Poisson-Binomial)</h4>
                  </div>
                  <div className="math-formula-box">
{`G_W(z) = ∏_{i=1}^N [ (1 - p_i) + p_i z ] = ∑_{k=0}^N P(W = k) z^k
Discrete recursion:
P_m(k) = P_{m-1}(k) * (1 - p_m) + P_{m-1}(k - 1) * p_m`}
                  </div>
                  <p>
                    Over N remaining regular season weeks with heterogeneous win probabilities {'{'}p_1, ..., p_N{'}'}, total wins W follow a Poisson-Binomial distribution. Rather than approximating via standard binomial models (which falsely assume identical odds), the exact probability mass function is calculated by polynomial convolution in O(N²) time.
                  </p>
                  <a href="https://en.wikipedia.org/wiki/Poisson_binomial_distribution" target="_blank" rel="noopener noreferrer" className="math-wiki-link">
                    <span>Read Wikipedia: Poisson binomial distribution</span>
                    <ArrowUpRight size={12} />
                  </a>
                </div>

                <div className="math-card">
                  <div className="math-card-header">
                    <span className="math-card-tag">STOCHASTIC PROCESSES</span>
                    <h4>5. Markov Chain Health Transitions</h4>
                  </div>
                  <div className="math-formula-box">
{`s_{t+1} = s_t * P
P = [ [ 1 - λ_pos,    λ_pos   ]
      [  μ_rec,     1 - μ_rec ] ]
λ_RB ≈ 4.6%,  λ_TE ≈ 3.6%,  λ_WR ≈ 3.3%,  λ_QB ≈ 2.2%`}
                  </div>
                  <p>
                    Weekly player availability follows a discrete-time Markov chain with transition matrix P. New weekly hazard rates λ are position-calibrated from historical NFL snap data, while recovery parameter μ models multi-week recovery half-lives across simulated seasons to test roster depth and bench insulation.
                  </p>
                  <a href="https://en.wikipedia.org/wiki/Markov_chain" target="_blank" rel="noopener noreferrer" className="math-wiki-link">
                    <span>Read Wikipedia: Markov chain</span>
                    <ArrowUpRight size={12} />
                  </a>
                </div>

                <div className="math-card">
                  <div className="math-card-header">
                    <span className="math-card-tag">LINEAR ALGEBRA</span>
                    <h4>6. Sinkhorn-Knopp Doubly-Stochastic Scaling</h4>
                  </div>
                  <div className="math-formula-box">
{`lim_{k → ∞} D_1^(k) M D_2^(k) = P*
subject to:
∑_{j=1}^M P*_{ij} = 1  (∀ i),     ∑_{i=1}^M P*_{ij} = 1  (∀ j)`}
                  </div>
                  <p>
                    Ensemble averaging across 13 engines produces a raw probability matrix M. Because every team must be assigned exactly one pick slot and every pick slot must belong to exactly one team, M must lie on the Birkhoff polytope. Alternating diagonal scaling converges linearly to a unique doubly-stochastic matrix P*, ensuring all pick odds sum to exactly 100%.
                  </p>
                  <a href="https://en.wikipedia.org/wiki/Sinkhorn%27s_theorem" target="_blank" rel="noopener noreferrer" className="math-wiki-link">
                    <span>Read Wikipedia: Sinkhorn's theorem</span>
                    <ArrowUpRight size={12} />
                  </a>
                </div>

                <div className="math-card">
                  <div className="math-card-header">
                    <span className="math-card-tag">PROBABILITY THEORY</span>
                    <h4>7. Expected Value (xPick) &amp; Sensitivity Bounds</h4>
                  </div>
                  <div className="math-formula-box">
{`E[Pick_i] = ∑_{j=1}^M j * P(Pick_i = j)
Spread(i, j) = [ min_{m ∈ ℳ} P_m(i, j),   max_{m ∈ ℳ} P_m(i, j) ]`}
                  </div>
                  <p>
                    The Expected Pick (xPick) calculates the discrete expected value (first statistical moment) of the pick distribution, providing a continuous draft capital metric. The sensitivity range computes the infimum and supremum probabilities across the 13 independent engine hypotheses ℳ, bounding model uncertainty.
                  </p>
                  <a href="https://en.wikipedia.org/wiki/Expected_value" target="_blank" rel="noopener noreferrer" className="math-wiki-link">
                    <span>Read Wikipedia: Expected value</span>
                    <ArrowUpRight size={12} />
                  </a>
                </div>

                <div className="math-card">
                  <div className="math-card-header">
                    <span className="math-card-tag">ESTIMATION THEORY</span>
                    <h4>8. Empirical Bayes &amp; Monte Carlo Trials</h4>
                  </div>
                  <div className="math-formula-box">
{`μ̂_i = B_i * x̄_i + (1 - B_i) * μ_{0, i}
B_i = τ² / [ τ² + σ_i² / n_i ]
P(Pick = j) ≈ (1 / K) ∑_{k=1}^K I(Pick^(k) = j),   K = 6,000`}
                  </div>
                  <p>
                    Player baseline means apply Empirical Bayes shrinkage, pulling small in-season sample averages toward projected priors to prevent overfitting early anomalies. Twelve Monte Carlo engines then simulate 6,000 complete remaining seasons with persistent talent and offensive shocks.
                  </p>
                  <a href="https://en.wikipedia.org/wiki/Empirical_Bayes_method" target="_blank" rel="noopener noreferrer" className="math-wiki-link">
                    <span>Read Wikipedia: Empirical Bayes method</span>
                    <ArrowUpRight size={12} />
                  </a>
                </div>
              </div>
            </div>
          </details>
        </div>
      </details>
      <div className="bottom-note">UNOFFICIAL DYNASTY TOOL <span>·</span> LIVE SCORES AND PLAYER PROJECTIONS BY SLEEPER</div>
    </main>
  )
}

export default App
