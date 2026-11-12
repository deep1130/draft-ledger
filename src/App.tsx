import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, ArrowUpRight, Calculator, Check, ChevronDown, CircleAlert, Clock3, RefreshCw, Search, Share2, ShieldCheck, Trophy } from 'lucide-react'
import { projectDraftOrder } from './projection'
import { fetchUserLeagues, loadLeagueData, upcomingRookieSeason, type LeagueData, type UserLeagueSummary } from './sleeper'
import './App.css'

type View = 'order' | 'assets'
interface RecentLeague {
  id: string
  name: string
  season: string
}

const RECENT_LEAGUES_KEY = 'draft-ledger-recent-leagues-v1'
const MAX_RECENT_LEAGUES = 5
const DEFAULT_ROOKIE_YEAR = new Date().getFullYear() + 1
const formatNumber = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const formatChance = (chance: number) => chance >= 0.9999 ? '100%' : chance >= 0.995 ? '99%+' : chance === 0 ? '0%' : chance < 0.005 ? '<0.5%' : `${Math.round(chance * 100)}%`

function isAbortError(reason: unknown): boolean {
  return (reason instanceof DOMException && reason.name === 'AbortError')
    || (reason instanceof Error && reason.name === 'AbortError')
}

function readRecentLeagues(): RecentLeague[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_LEAGUES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is RecentLeague =>
        Boolean(item) && typeof item === 'object'
        && typeof (item as RecentLeague).id === 'string'
        && typeof (item as RecentLeague).name === 'string'
        && typeof (item as RecentLeague).season === 'string'
    ).slice(0, MAX_RECENT_LEAGUES)
  } catch {
    return []
  }
}

function writeRecentLeagues(entries: RecentLeague[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_LEAGUES_KEY, JSON.stringify(entries.slice(0, MAX_RECENT_LEAGUES)))
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function getInitialLeagueId(): string {
  if (typeof window !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('league')
    if (fromQuery && fromQuery.trim()) return fromQuery.trim()
    const fromHash = window.location.hash.replace(/^#\/?/, '').trim()
    if (fromHash && /^\d+$/.test(fromHash)) return fromHash
  }
  return ''
}

function teamName(data: LeagueData, roster: LeagueData['rosters'][number]): string {
  const owner = data.users.find((user) => user.user_id === roster.owner_id)
  return owner?.metadata?.team_name || owner?.display_name || `Team ${roster.roster_id}`
}

function App() {
  const initialId = useMemo(() => getInitialLeagueId(), [])
  const [leagueId, setLeagueId] = useState(initialId)
  const [data, setData] = useState<LeagueData | null>(null)
  const [busy, setBusy] = useState(Boolean(initialId))
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('order')
  const [search, setSearch] = useState('')
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [recentLeagues, setRecentLeagues] = useState<RecentLeague[]>(() => readRecentLeagues())
  const [userLeagues, setUserLeagues] = useState<UserLeagueSummary[]>([])
  const [resolvedUserLabel, setResolvedUserLabel] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const recordRecentLeague = useCallback((next: LeagueData) => {
    const entry: RecentLeague = {
      id: next.league.league_id,
      name: next.league.name || `League ${next.league.league_id}`,
      season: next.league.season,
    }
    setRecentLeagues((prev) => {
      const merged = [entry, ...prev.filter((item) => item.id !== entry.id)].slice(0, MAX_RECENT_LEAGUES)
      writeRecentLeagues(merged)
      return merged
    })
  }, [])

  const loadLeagueById = useCallback(async (rawId: string, clearUserPicker = false) => {
    const activeId = rawId.trim()
    if (!activeId) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (clearUserPicker) {
      setUserLeagues([])
      setResolvedUserLabel('')
    }
    setLeagueId(activeId)
    setBusy(true)
    setError('')
    try {
      const next = await loadLeagueData(activeId, controller.signal)
      if (controller.signal.aborted) return
      setData(next)
      setLastUpdated(next.lastUpdated)
      recordRecentLeague(next)
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.set('league', activeId)
        window.history.replaceState({}, '', url.toString())
      }
    } catch (reason) {
      if (controller.signal.aborted || isAbortError(reason)) return
      setError(reason instanceof Error ? reason.message : 'Could not load league data.')
    } finally {
      if (abortRef.current === controller) {
        setBusy(false)
      }
    }
  }, [recordRecentLeague])

  async function refresh(targetInput?: string) {
    const queryInput = (targetInput ?? leagueId).trim()
    if (!queryInput) {
      setError('Please enter a Sleeper League ID or @username.')
      setBusy(false)
      return
    }
    if (/^\d+$/.test(queryInput)) {
      await loadLeagueById(queryInput, true)
      return
    }
    const cleanedUsername = queryInput.replace(/^@+/, '').trim()
    if (!cleanedUsername) {
      setError('Please enter a Sleeper League ID or @username.')
      setBusy(false)
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError('')
    try {
      const leagues = await fetchUserLeagues(cleanedUsername, controller.signal)
      if (controller.signal.aborted) return
      if (!leagues.length) {
        setUserLeagues([])
        setResolvedUserLabel('')
        setError(`No Sleeper leagues found for "@${cleanedUsername}".`)
        return
      }
      setUserLeagues(leagues)
      setResolvedUserLabel(cleanedUsername)
      await loadLeagueById(leagues[0].league_id, false)
    } catch (reason) {
      if (controller.signal.aborted || isAbortError(reason)) return
      setUserLeagues([])
      setResolvedUserLabel('')
      setError(reason instanceof Error ? reason.message : 'Could not find Sleeper user or leagues.')
    } finally {
      if (abortRef.current === controller) {
        setBusy(false)
      }
    }
  }

  async function copyShareUrl() {
    if (typeof window === 'undefined') return
    const trimmed = leagueId.trim()
    const activeId = data?.league.league_id ?? (/^\d+$/.test(trimmed) ? trimmed : '')
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
    if (!initialId) return
    const controller = new AbortController()
    abortRef.current = controller
    void loadLeagueData(initialId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return
        setData(next)
        setLastUpdated(next.lastUpdated)
        recordRecentLeague(next)
      })
      .catch((reason) => {
        if (controller.signal.aborted || isAbortError(reason)) return
        setError(reason instanceof Error ? reason.message : 'Could not load league data.')
      })
      .finally(() => {
        if (abortRef.current === controller) {
          setBusy(false)
        }
      })
    return () => {
      controller.abort()
    }
  }, [initialId, recordRecentLeague])

  const picks = useMemo(() => (data ? projectDraftOrder(data) : []), [data])
  const query = search.trim().toLowerCase()
  const visiblePicks = picks.filter((team) => `${team.name} ${team.pickHolder} ${team.record}`.toLowerCase().includes(query))
    .sort((first, second) => first.pick - second.pick)
  const rookieYear = data ? upcomingRookieSeason(data.league) : DEFAULT_ROOKIE_YEAR
  const totalTeams = data?.rosters.length ?? 0
  const playoffTeamsCount = data ? Math.min(totalTeams, Math.max(0, Number(data.league.settings.playoff_teams ?? 6))) : 6
  const nonPlayoffCount = data ? Math.max(0, totalTeams - playoffTeamsCount) : 6
  const currentWeek = data?.currentWeek ?? 0
  const hasMedianMatch = Number(data?.league.settings.league_average_match) === 1
  const regularSeasonEnd = data ? Math.min(18, Math.max(1, (Number(data.league.settings.playoff_week_start) || 15) - 1)) : 14
  const isRegularSeasonComplete = Boolean(data && data.lastScoredWeek >= regularSeasonEnd)
  const remainingWeeks = data ? Math.max(0, regularSeasonEnd - data.lastScoredWeek) : 0
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
          <label htmlFor="league-id">SLEEPER LEAGUE ID OR USERNAME</label>
          <div className="league-input-row">
            <input
              id="league-id"
              value={leagueId}
              onChange={(event) => setLeagueId(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void refresh() }}
              placeholder="League ID or @username"
              aria-label="Sleeper League ID or username"
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
            <Clock3 size={12} /> {lastUpdated ? `UPDATED ${new Date(lastUpdated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · MANUAL REFRESH` : 'ENTER A SLEEPER LEAGUE ID OR @USERNAME'}
          </div>
          {userLeagues.length > 1 && (
            <div className="quick-leagues-row" aria-label={`Leagues for @${resolvedUserLabel}`}>
              <span className="quick-leagues-label">@{resolvedUserLabel}</span>
              {userLeagues.map((entry) => (
                <button
                  key={entry.league_id}
                  type="button"
                  className={`quick-league-chip ${data?.league.league_id === entry.league_id ? 'active' : ''}`}
                  onClick={() => void loadLeagueById(entry.league_id, false)}
                  disabled={busy}
                  title={`${entry.name} (${entry.season} · ${entry.total_rosters} teams)`}
                >
                  <span>{entry.name}</span>
                  {entry.isDynasty && <span className="dynasty-badge">DYN</span>}
                </button>
              ))}
            </div>
          )}
          {userLeagues.length <= 1 && recentLeagues.length > 0 && (
            <div className="quick-leagues-row" aria-label="Recent leagues">
              <span className="quick-leagues-label">RECENT</span>
              {recentLeagues.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`quick-league-chip ${data?.league.league_id === entry.id ? 'active' : ''}`}
                  onClick={() => void loadLeagueById(entry.id, true)}
                  disabled={busy}
                  title={`${entry.name} (${entry.season})`}
                >
                  <span>{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {error && <div className="error-banner"><CircleAlert size={16} /><span>Live data unavailable: {error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

      <section className="summary-strip" aria-label="League summary">
        <div className="summary-item"><span className="summary-label">LEAGUE</span><strong>{data?.league.name ?? (busy ? 'Connecting…' : 'No league connected')}</strong><span className="summary-note">{data ? `${totalTeams} franchises · ${data.league.scoring_settings.rec ?? 0} PPR${data.league.scoring_settings.bonus_rec_te ? ` (+${data.league.scoring_settings.bonus_rec_te} TEP)` : ''}` : 'Enter a league ID or @username above'}</span></div>
        <div className="summary-item"><span className="summary-label">REGULAR SEASON</span><strong>WEEK {currentWeek || '--'} <span className="summary-muted">/ {regularSeasonEnd}</span></strong><span className="summary-note">{data ? (isRegularSeasonComplete ? 'Regular season complete · Order locked' : 'Current week + remaining projections') : 'Awaiting league ID'}</span></div>
        <div className="summary-item"><span className="summary-label">LOTTERY PICKS</span><strong>{data ? `01 — ${String(nonPlayoffCount).padStart(2, '0')}` : '—'}</strong><span className="summary-note">Reverse Max Points For</span></div>
      </section>

      <section className="projection-section">
        <div className="section-heading"><div><p className="eyebrow">THE BOARD <span>·</span> {data?.league.name.toUpperCase() ?? 'SLEEPER DYNASTY'}</p><h2>{view === 'assets' ? 'Traded pick assets' : 'Projected rookie order'}</h2></div><div className="board-tools"><div className="search-box"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a team" aria-label="Find a team" /></div><div className="view-tabs" role="tablist" aria-label="Board view"><button type="button" role="tab" aria-selected={view === 'order'} className={view === 'order' ? 'selected' : ''} onClick={() => setView('order')}>PICK ORDER</button><button type="button" role="tab" aria-selected={view === 'assets'} className={view === 'assets' ? 'selected' : ''} onClick={() => setView('assets')}>PICK ASSETS</button></div></div></div>

        {view === 'assets' ? <div className="table-wrap"><table><thead><tr><th>ORIGINAL PICK</th><th>CURRENT HOLDER</th><th>ROUND</th><th>SEASON</th><th>STATUS</th></tr></thead><tbody>
          {data?.tradedPicks.filter((pick) => Number(pick.season) === rookieYear).sort((a, b) => a.round - b.round || a.roster_id - b.roster_id).map((pick) => { const origin = data.rosters.find((roster) => roster.roster_id === pick.roster_id); const holder = data.rosters.find((roster) => roster.roster_id === pick.owner_id); return <tr className="asset-row" key={`${pick.season}-${pick.round}-${pick.roster_id}`}><td>{origin ? teamName(data, origin) : `Team ${pick.roster_id}`}</td><td className="holder-cell">{holder ? teamName(data, holder) : `Team ${pick.owner_id}`} {pick.round === 1 && <span className="asset-tag">LOTTERY TRACKED</span>}</td><td>ROUND {pick.round}</td><td>{pick.season}</td><td><span className="trade-mark"><ArrowUpRight size={13} /> TRADED</span></td></tr> })}
          {data && <tr className="owned-picks-row"><td colSpan={5}>Unlisted picks remain with their original franchise. Sleeper is the source of truth for traded-pick ownership.</td></tr>}{!data && <tr><td colSpan={5} className="empty-cell">{busy ? 'Loading traded picks…' : 'Enter a Sleeper league ID or @username above to see pick assets.'}</td></tr>}
        </tbody></table></div> : <div className="table-wrap"><table><thead><tr><th className="rank-col">PICK</th><th>FRANCHISE</th><th>{rookieYear} PICK HOLDER</th><th>CURRENT RECORD</th><th>PICK ODDS</th><th>xPICK</th><th>PROJECTED MAX PF</th><th>CURRENT MAX PF</th></tr></thead><tbody>
          {visiblePicks.map((team) => { const inLottery = team.pick <= nonPlayoffCount; const sortedOutcomes = team.probabilities.map((chance, pick) => ({ pick: pick + 1, chance, range: team.probabilityRanges[pick] })).filter((outcome) => outcome.chance > 0).sort((a, b) => b.chance - a.chance || a.pick - b.pick); const top = sortedOutcomes.filter((outcome, index) => outcome.chance >= 0.005 || index === 0).slice(0, 8); return <tr key={team.roster.roster_id} className={`${inLottery ? 'lottery-row' : 'playoff-row'} ${busy ? 'dim-row' : ''}`}>
            <td className="rank-cell"><span className={inLottery ? 'pick-number lottery-number' : 'pick-number'}>{String(team.pick).padStart(2, '0')}</span></td>
            <td className="franchise-cell"><span className="franchise-name" title={team.name}>{team.name}</span></td>
            <td className="holder-cell" data-label={`${rookieYear} PICK HOLDER`} title={team.pickHolder}>{team.pickHolder}{team.pickHolderId !== team.roster.roster_id && <span className="asset-tag">TRADED</span>}</td>
            <td className="record-cell"><span className="record-pill">{team.record}</span></td>
            <td className="odds-cell-td"><div className="odds-cell">{top.map(({ pick: pickNumber, chance, range }) => <span className={`odds-pill ${pickNumber <= nonPlayoffCount ? 'odds-lottery' : ''}`} key={pickNumber}><b>{String(pickNumber).padStart(2, '0')}</b><span>{formatChance(chance)}</span><small>{range.high - range.low < 0.0001 && chance >= 0.9999 ? 'LOCKED' : `${formatChance(range.low)}–${formatChance(range.high)}`}</small></span>)}</div></td>
            <td className="numeric-cell xpick-cell"><span className={`xpick-pill ${inLottery ? 'xpick-lottery' : ''}`}>{team.expectedPick.toFixed(1)}</span></td>
            <td className="numeric-cell proj-maxpf-cell">{formatNumber(team.maxPf)}</td>
            <td className="numeric-cell curr-maxpf-cell">{formatNumber(team.currentMaxPf)}</td>
          </tr> })}
          {!data && <tr><td colSpan={8} className="empty-cell">{busy ? <><RefreshCw size={16} className="spin" /> Loading live league data…</> : <div className="empty-league-prompt"><p>Enter your Sleeper League ID or @username above to generate live draft pick projections.</p></div>}</td></tr>}{data && visiblePicks.length === 0 && <tr><td colSpan={8} className="empty-cell">No teams match “{search}”.</td></tr>}
        </tbody></table></div>}

        <footer className="table-footer"><div className="legend"><span><i className="legend-dot lottery-dot" /> 01—{String(nonPlayoffCount).padStart(2, '0')} REVERSE MAX PF</span><span><i className="legend-dot playoff-dot" /> PLAYOFF SEED</span><span><ShieldCheck size={14} /> INJURY + BYE ADJUSTED</span></div><span className="simulation-note">{picks.length ? `${picks.length} TEAMS · ${picks[0]?.modelNames.length ?? 13} ENGINES · ${(picks[0]?.simulationCount ?? 6000).toLocaleString('en-US')} SEASONS + EXACT MATH` : 'SIMULATIONS WILL APPEAR WHEN DATA LOADS'}</span></footer>
      </section>

      <details className="model-details" open>
        <summary>
          <span className="method-icon"><Trophy size={18} /></span>
          <div className="model-heading">
            <span className="model-tag">HOW IT WORKS</span>
            <strong>How draft pick odds are calculated</strong>
          </div>
          <ChevronDown className="model-chevron" size={17} />
        </summary>
        <div className="model-content">
          <div className="model-cards-grid">
            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">LEAGUE SCORING</span>
                <h4>1. Exact League Settings &amp; Live Tracking</h4>
              </div>
              <p>
                Weekly projections from Sleeper are converted using {data && scoringSummary ? `this league's exact rules (${scoringSummary})` : "this league's exact rules"}.
                {hasMilestoneBonuses
                  ? ' Big-play bonuses (like 100-yard rushing/receiving or 300-yard passing milestones) are calculated using upper-tail probabilities under continuous '
                  : ' Standard yardage and touchdown scoring apply without milestone bonuses. '}{' '}
                {hasMilestoneBonuses ? <a href="https://en.wikipedia.org/wiki/Gamma_distribution" target="_blank" rel="noopener noreferrer">Gamma distribution</a> : null}{hasMilestoneBonuses ? ' curves. ' : ''}
                Completed games lock in actual player scores permanently. Games currently in progress project remaining stats using Bayesian in-game usage updating and non-linear NFL quarter scoring pacing, while future games simulate full-game outcomes.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">ANTI-TANKING</span>
                <h4>2. Max PF (Why Benching Stars Doesn't Work)</h4>
              </div>
              <p>
                In dynasty leagues, rookie draft order for non-playoff teams is decided by <strong>Max Points For (Max PF)</strong>, not win-loss record.
              </p>
              <p>
                Every week, the system looks at every single player on your roster—including your bench and taxi squad—and calculates the highest score you could have possibly posted in 20/20 hindsight (using <a href="https://en.wikipedia.org/wiki/Transversal_matroid" target="_blank" rel="noopener noreferrer">transversal matroid matching</a>). Benching your studs to intentionally lose matchups will never lower your Max PF or help your draft position.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">SCHEDULE SIMULATION</span>
                <h4>3. Remaining Matchups &amp; {data ? (hasMedianMatch ? 'Median Games' : 'Standings') : 'Standings'}</h4>
              </div>
              <p>
                Official Sleeper records through completed weeks are locked in. The current week updates live as real NFL games finish. For all remaining weeks, the engine simulates every scheduled head-to-head matchup{hasMedianMatch ? ' and weekly league median game' : ''} across every simulated season, with simulated starter points breaking any ties in the standings.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">DRAFT ORDER RULES</span>
                <h4>4. Lottery Picks vs. Playoff Picks</h4>
              </div>
              {data ? (
                <p>
                  Draft order locks at the end of the fantasy regular season (playoff matchups do not affect rookie picks):
                  {nonPlayoffCount > 0 ? (
                    <>
                      <br />
                      <strong>• Non-playoff teams (Lottery Picks 01–{String(nonPlayoffCount).padStart(2, '0')}):</strong> Ranked strictly from lowest regular-season Max PF to highest. The lowest-scoring non-playoff team gets the #1 overall pick.
                    </>
                  ) : ''}
                  {playoffTeamsCount > 0 ? (
                    <>
                      <br />
                      <strong>• Playoff teams (Picks {String(nonPlayoffCount + 1).padStart(2, '0')}–{String(totalTeams).padStart(2, '0')}):</strong> Ranked in reverse order of regular-season finish (the last playoff seed gets Pick {String(nonPlayoffCount + 1).padStart(2, '0')}, while the #1 regular-season seed picks last at Pick {String(totalTeams).padStart(2, '0')}).
                    </>
                  ) : ''}
                </p>
              ) : (
                <p>
                  Draft order locks at the end of the fantasy regular season. Non-playoff teams receive lottery picks ordered strictly by lowest regular-season Max PF. Playoff qualifiers receive post-lottery picks ordered in reverse of regular-season finish.
                </p>
              )}
            </div>

            <div className="model-card full-width">
              <div className="model-card-header">
                <span className="model-card-tag">SIMULATION ENGINES</span>
                <h4>5. The 13 Simulation Realities (6,000 Simulated Seasons + Exact Math)</h4>
              </div>
              <p>
                To avoid guessing or relying on any single formula, draft odds are simulated across <strong>13 distinct fantasy football scenarios</strong> (12 <a href="https://en.wikipedia.org/wiki/Monte_Carlo_method" target="_blank" rel="noopener noreferrer">Monte Carlo</a> models running 500 full remaining regular seasons each = 6,000 trials, plus an exact mathematical engine):
              </p>
              <div className="model-engine-list">
                <div className="model-engine-item">
                  <strong>1. Standard Game-Day Scoring:</strong>
                  Realistic point curves for every position (QB, RB, WR, TE) tied to team offensive output.
                </div>
                <div className="model-engine-item">
                  <strong>2. Boom / Bust Weeks:</strong>
                  Models wild blowouts, garbage-time spikes, and games where stars get game-scripted out.
                </div>
                <div className="model-engine-item">
                  <strong>3. Real NFL Game Logs:</strong>
                  Samples directly from games players have actually played this season to ground projections in reality.
                </div>
                <div className="model-engine-item">
                  <strong>4. Hot Streaks &amp; Lineup Smarts:</strong>
                  Weights recent multi-week momentum and rewards managers who consistently start their highest scorers using <a href="https://en.wikipedia.org/wiki/Empirical_Bayes_method" target="_blank" rel="noopener noreferrer">Empirical Bayes</a> shrinkage.
                </div>
                <div className="model-engine-item">
                  <strong>5. Late-Season Wear &amp; Tear (1.5&times; Injuries):</strong>
                  Stress-tests rosters with an above-average injury rate to see whose bench depth survives into winter.
                </div>
                <div className="model-engine-item">
                  <strong>6. Injury Crisis &amp; Chaos (2.0&times; Injuries):</strong>
                  Simulates a worst-case injury bug where multiple starters go down, testing true roster depth.
                </div>
                <div className="model-engine-item">
                  <strong>7. Shootouts &amp; Team Stacks:</strong>
                  Simulates high-scoring 40-point shootouts where quarterbacks and their pass-catchers erupt together.
                </div>
                <div className="model-engine-item">
                  <strong>8. Late-Season Rookie Surges:</strong>
                  Accounts for rookies and young prospects earning bigger roles and snap counts down the stretch.
                </div>
                <div className="model-engine-item">
                  <strong>9. Safe Chalk &amp; Low Variance:</strong>
                  A predictable, low-volatility scenario where star players reliably hit their projected baselines.
                </div>
                <div className="model-engine-item">
                  <strong>10. Contender vs. Rebuilder Tactics:</strong>
                  Reflects real dynasty behavior—contenders lean on veteran floors, while rebuilders test young talent.
                </div>
                <div className="model-engine-item">
                  <strong>11. Monster Outlier Booms:</strong>
                  Captures legendary 40+ point ceiling games alongside sudden in-game exits (hamstrings, early injuries).
                </div>
                <div className="model-engine-item">
                  <strong>12. Backup QB Downgrades:</strong>
                  When a starting quarterback misses time, their wide receivers and tight ends take a realistic efficiency hit.
                </div>
                <div className="model-engine-item">
                  <strong>13. Pure Matchup Math:</strong>
                  Calculates exact mathematical win probabilities for every matchup and median game without simulation randomness using <a href="https://en.wikipedia.org/wiki/Poisson_binomial_distribution" target="_blank" rel="noopener noreferrer">Poisson-Binomial convolutions</a> and <a href="https://en.wikipedia.org/wiki/Normal_distribution#Cumulative_distribution_function" target="_blank" rel="noopener noreferrer">Gaussian CDF integrals</a>.
                </div>
              </div>
              <p style={{ marginTop: '10px' }}>
                <strong>How to Read the Pick Chips:</strong> The large percentage on each pick chip is the <strong>consensus probability</strong> across all 13 engines (balanced via <a href="https://en.wikipedia.org/wiki/Sinkhorn%27s_theorem" target="_blank" rel="noopener noreferrer">Sinkhorn-Knopp matrix scaling</a> onto the <a href="https://en.wikipedia.org/wiki/Doubly_stochastic_matrix" target="_blank" rel="noopener noreferrer">Birkhoff polytope</a> so every pick slot and every team sums to exactly 100%). The small range underneath (e.g. <code>75%–87%</code>) is the <strong>range of outcomes</strong>—the lowest and highest probability found across the 13 different simulation scenarios.
              </p>
            </div>

            <div className="model-card">
              <div className="model-card-header">
                <span className="model-card-tag">ROSTER DURABILITY</span>
                <h4>6. Bench Depth &amp; Injury Survival</h4>
              </div>
              <p>
                Real fantasy seasons are decided by injuries. In our simulations, players face realistic injury odds governed by position-calibrated <a href="https://en.wikipedia.org/wiki/Markov_chain" target="_blank" rel="noopener noreferrer">Markov chains</a>: <strong>Running Backs (~4.6%)</strong>, <strong>Tight Ends (~3.6%)</strong>, <strong>Wide Receivers (~3.3%)</strong>, and <strong>Quarterbacks (~2.2%)</strong> per game, with existing injuries taking realistic time to heal.
              </p>
              <p>
                When a starter is sidelined, your highest-scoring bench player immediately steps up in both weekly matchups and Max PF calculations.
              </p>
              <p>
                This reveals the huge difference between deep rosters and top-heavy teams: fragile rosters suffer devastating scoring drops when stars miss time, losing matchups and tumbling down the standings, while deep benches insulate lineups and keep scoring high all season long.
              </p>
            </div>

            {data && nonPlayoffCount > 0 && playoffTeamsCount > 0 ? (
              <div className="model-card">
                <div className="model-card-header">
                  <span className="model-card-tag">SEEDING LOGIC</span>
                  <h4>7. The Playoff Bubble (Pick {String(nonPlayoffCount).padStart(2, '0')} vs. Pick {String(nonPlayoffCount + 1).padStart(2, '0')})</h4>
                </div>
                <p>
                  Why do bubble teams often have higher odds for Pick {String(nonPlayoffCount + 1).padStart(2, '0')} than Pick {String(nonPlayoffCount).padStart(2, '0')}?
                </p>
                <p>
                  Pick {String(nonPlayoffCount + 1).padStart(2, '0')} is awarded to the last playoff seed (Seed #{playoffTeamsCount}). If a bubble team goes on a hot winning streak down the stretch ({remainingGames} total matchups with medians over the final {remainingWeeks} weeks), those wins vault them into the playoffs, locking them into Pick {String(nonPlayoffCount + 1).padStart(2, '0')}.
                </p>
                <p>
                  To land Pick {String(nonPlayoffCount).padStart(2, '0')} instead, that team must score enough points all season to have the highest Max PF of any lottery team, but still somehow lose enough games to miss the playoffs. Because high scoring naturally produces matchup wins, high-scoring teams usually make the playoffs instead of finishing in the top lottery slot.
                </p>
              </div>
            ) : null}

            <div className={`model-card ${(!data || nonPlayoffCount === 0 || playoffTeamsCount === 0) ? 'full-width' : ''}`}>
              <div className="model-card-header">
                <span className="model-card-tag">DRAFT CAPITAL</span>
                <h4>{data && nonPlayoffCount > 0 && playoffTeamsCount > 0 ? '8. Expected Pick (xPick) & Traded Picks' : '7. Expected Pick (xPick) & Traded Picks'}</h4>
              </div>
              <p>
                <strong>Expected Pick (xPick):</strong> Think of xPick as a team's single "average draft slot"—the discrete <a href="https://en.wikipedia.org/wiki/Expected_value" target="_blank" rel="noopener noreferrer">Expected Value</a> of their draft position. For example, an xPick of <code>1.4</code> means a team is almost guaranteed the 1st or 2nd pick. An xPick of <code>6.8</code> means they are hovering right on the playoff bubble between Pick {String(nonPlayoffCount).padStart(2, '0')} and Pick {String(nonPlayoffCount + 1).padStart(2, '0')}.
              </p>
              <p>
                <strong>Traded Pick Tracking:</strong> All draft pick trades are pulled live from Sleeper. If Team A traded away their 1st-round pick to Team B, the draft slot is decided by where Team A finishes, but ownership of the pick is awarded to Team B on the board.
              </p>
            </div>
          </div>

          <details className="math-deep-dive">
            <summary>
              <span className="method-icon math-method-icon"><Calculator size={16} /></span>
              <div className="model-heading">
                <span className="math-tag">TECHNICAL DEEP DIVE</span>
                <strong>Mathematical Foundations &amp; Algorithm Reference</strong>
              </div>
              <span className="math-badge">Formulas &amp; Proofs</span>
              <ChevronDown className="model-chevron" size={16} />
            </summary>
            <div className="math-deep-dive-body">
              <p className="math-intro-p">
                For engineers, mathematicians, and curious players interested in the underlying calculus, probability theory, and discrete optimization algorithms running behind the scenes, here is the formal mathematical specification with links to foundational literature:
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
                    Over N remaining regular season weeks with heterogeneous win probabilities, total wins W follow an exact discrete distribution. In leagues with weekly median matches, each week's joint outcome over {'{'}0, 1, 2{'}'} wins is integrated via Gauss-Hermite quadrature to capture sweep correlation between head-to-head and median results, and convolved across the remaining schedule.
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
