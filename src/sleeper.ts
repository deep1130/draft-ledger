export type StatLine = Record<string, number>

export interface SleeperLeague {
  league_id: string
  name: string
  season: string
  status: string
  total_rosters: number
  settings: Record<string, number | string | null>
  scoring_settings: Record<string, number>
  roster_positions: string[]
}

export interface SleeperRoster {
  roster_id: number
  owner_id: string | null
  players: string[] | null
  starters?: string[] | null
  taxi?: string[] | null
  reserve?: string[] | null
  settings: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
    ppts?: number
    ppts_decimal?: number
  }
  metadata?: { record?: string }
}

export interface SleeperUser {
  user_id: string
  display_name: string
  metadata?: { team_name?: string }
}

export interface SleeperPlayer {
  player_id: string
  first_name?: string
  last_name?: string
  full_name?: string
  team?: string | null
  position?: string
  fantasy_positions?: string[] | null
  injury_status?: string | null
  status?: string | null
  years_exp?: number | null
  age?: number | null
}

export interface TradedPick {
  season: string
  round: number
  roster_id: number
  previous_owner_id: number
  owner_id: number
}

export interface Matchup {
  roster_id: number
  matchup_id: number | null
  points: number
  players?: string[]
  starters?: string[]
  players_points?: Record<string, number>
  custom_points?: number | null
}

export interface WeekFeed {
  matchups: Matchup[]
  projections: Record<string, StatLine>
  byes: string[]
  gameStates: Record<string, 'pre' | 'in' | 'post'>
  gameProgress: Record<string, number>
}

export interface UserLeagueSummary {
  league_id: string
  name: string
  season: string
  total_rosters: number
  status: string
  isDynasty: boolean
}

export interface LeagueData {
  league: SleeperLeague
  rosters: SleeperRoster[]
  users: SleeperUser[]
  players: Record<string, SleeperPlayer>
  tradedPicks: TradedPick[]
  currentWeek: number
  lastScoredWeek: number
  weeks: Record<number, WeekFeed>
  historicalMaxPf: Record<number, number[]>
  historicalTeamScores: Record<number, number[]>
  historicalPlayerPoints: Record<string, number[]>
  historicalPlayerWeeks: Record<string, number[]>
  lastUpdated: number
}

export function upcomingRookieSeason(league: Pick<SleeperLeague, 'season' | 'status'>): number {
  const base = Number(league.season) || new Date().getFullYear()
  return league.status === 'pre_draft' || league.status === 'drafting' ? base : base + 1
}

interface NflState {
  week?: number
  leg?: number
  season?: string
  league_season?: string
}

interface EspnScoreboard {
  week?: { teamsOnBye?: Array<{ abbreviation?: string }> }
  events?: Array<{
    competitions?: Array<{
      competitors?: Array<{ team?: { abbreviation?: string } }>
      status?: { period?: number; displayClock?: string; type?: { state?: 'pre' | 'in' | 'post' } }
    }>
  }>
}

const NON_STARTER_SLOTS = new Set(['BN', 'IR', 'TAXI', 'RESERVE'])

const FLEX_ELIGIBILITY: Record<string, readonly string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
}

const ESPN_TO_SLEEPER_TEAM: Record<string, string> = {
  WSH: 'WAS',
  JAC: 'JAX',
  LA: 'LAR',
}

export function normalizeNflTeam(abbreviation?: string | null): string | undefined {
  if (!abbreviation) return undefined
  return ESPN_TO_SLEEPER_TEAM[abbreviation] ?? abbreviation
}

export function starterSlotsForLeague(rosterPositions: readonly string[]): string[] {
  return rosterPositions.filter((slot) => !NON_STARTER_SLOTS.has(slot))
}

export function playerFitsSlot(player: SleeperPlayer | undefined, slot: string): boolean {
  const positions = player?.fantasy_positions?.length
    ? player.fantasy_positions
    : (player?.position ? [player.position] : [])
  if (positions.includes(slot)) return true
  const allowed = FLEX_ELIGIBILITY[slot]
  return allowed ? allowed.some((position) => positions.includes(position)) : false
}

export interface LineupCandidate {
  id: string
  player: SleeperPlayer | undefined
  points: number
}

/**
 * Computes the exact maximum-scoring legal starting lineup for a set of candidates and slots.
 * Since a player's score does not depend on which eligible slot they occupy, legal lineups form a
 * transversal matroid: processing candidates in descending score order and augmenting the slot
 * matching via Kuhn's DFS guarantees the exact global optimum for any multi-position eligibility
 * and any overlapping flex slots in O(M log M + S^2) time.
 */
export function selectOptimalLineup(
  candidates: readonly LineupCandidate[],
  slots: readonly string[],
): { total: number; starterIds: string[] } {
  const numSlots = slots.length
  if (!numSlots || !candidates.length) return { total: 0, starterIds: [] }

  const sorted = [...candidates]
    .filter((item) => item.points > 0)
    .sort((first, second) => second.points - first.points)

  if (!sorted.length) return { total: 0, starterIds: [] }

  // matchSlot[s] stores the index in `sorted` currently assigned to slot s, or -1 if open.
  const matchSlot = new Int32Array(numSlots).fill(-1)
  const visited = new Uint8Array(numSlots)
  const candSlots: number[][] = []

  function tryAugment(candIdx: number): boolean {
    let eligibleSlots = candSlots[candIdx]
    if (!eligibleSlots) {
      eligibleSlots = []
      const player = sorted[candIdx].player
      for (let s = 0; s < numSlots; s += 1) {
        if (playerFitsSlot(player, slots[s])) eligibleSlots.push(s)
      }
      candSlots[candIdx] = eligibleSlots
    }
    // Prefer an immediately open slot first.
    for (let i = 0; i < eligibleSlots.length; i += 1) {
      const s = eligibleSlots[i]
      if (matchSlot[s] === -1) {
        matchSlot[s] = candIdx
        return true
      }
    }
    // Otherwise search for an augmenting path that shifts an already-selected player to another eligible slot.
    for (let i = 0; i < eligibleSlots.length; i += 1) {
      const s = eligibleSlots[i]
      if (visited[s]) continue
      visited[s] = 1
      if (tryAugment(matchSlot[s])) {
        matchSlot[s] = candIdx
        return true
      }
    }
    return false
  }

  let matchedCount = 0
  let total = 0
  for (let candIdx = 0; candIdx < sorted.length && matchedCount < numSlots; candIdx += 1) {
    visited.fill(0)
    if (tryAugment(candIdx)) {
      matchedCount += 1
      total += sorted[candIdx].points
    }
  }

  const starterIds: string[] = []
  for (let s = 0; s < numSlots; s += 1) {
    if (matchSlot[s] >= 0) starterIds.push(sorted[matchSlot[s]].id)
  }
  return { total, starterIds }
}

function historicalMaxLineup(
  matchup: Matchup,
  players: Record<string, SleeperPlayer>,
  rosterPositions: string[],
): number {
  const slots = starterSlotsForLeague(rosterPositions)
  const points = matchup.players_points ?? {}
  const candidates = (matchup.players ?? Object.keys(points)).map((id) => ({
    id,
    player: players[id],
    points: typeof points[id] === 'number' && Number.isFinite(points[id]) ? points[id] : 0,
  }))
  return selectOptimalLineup(candidates, slots).total
}

function parseClockSeconds(displayClock?: string): number {
  if (!displayClock) return 900
  const trimmed = displayClock.trim()
  const mmss = trimmed.match(/^(\d+):(\d{2})$/)
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2])
  const secondsOnly = trimmed.match(/^(\d+(?:\.\d+)?)$/)
  if (secondsOnly) return Number(secondsOnly[1])
  return 900
}

const SLEEPER_API = 'https://api.sleeper.app/v1'
const LEGACY_PLAYER_CACHE_KEY = 'draft-order-player-index-v1'
const PLAYER_CACHE_KEY = 'draft-order-player-index-v2'
const PLAYER_CACHE_MAX_AGE = 24 * 60 * 60 * 1000

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`)
  return response.json() as Promise<T>
}

function compactPlayerIndex(raw: Record<string, SleeperPlayer>): Record<string, SleeperPlayer> {
  const compact: Record<string, SleeperPlayer> = {}
  for (const [id, p] of Object.entries(raw)) {
    if (!p) continue
    const entry: SleeperPlayer = { player_id: id }
    if (p.full_name) entry.full_name = p.full_name
    if (p.team) entry.team = p.team
    if (p.position) entry.position = p.position
    if (p.fantasy_positions?.length) entry.fantasy_positions = p.fantasy_positions
    if (p.injury_status) entry.injury_status = p.injury_status
    if (p.status) entry.status = p.status
    if (typeof p.years_exp === 'number') entry.years_exp = p.years_exp
    if (typeof p.age === 'number') entry.age = p.age
    compact[id] = entry
  }
  return compact
}

async function getPlayerIndex(signal?: AbortSignal): Promise<Record<string, SleeperPlayer>> {
  try {
    localStorage.removeItem(LEGACY_PLAYER_CACHE_KEY)
    const stored = localStorage.getItem(PLAYER_CACHE_KEY)
    if (stored) {
      const cached = JSON.parse(stored) as { savedAt: number; players: Record<string, SleeperPlayer> }
      if (Date.now() - cached.savedAt < PLAYER_CACHE_MAX_AGE) return cached.players
    }
  } catch {
    localStorage.removeItem(PLAYER_CACHE_KEY)
  }

  const rawPlayers = await getJson<Record<string, SleeperPlayer>>(`${SLEEPER_API}/players/nfl?active=true`, signal)
  const players = compactPlayerIndex(rawPlayers)
  try {
    localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), players }))
  } catch {
    // Fallback gracefully if storage quota is unavailable.
  }
  return players
}

export async function fetchUserLeagues(usernameOrId: string, signal?: AbortSignal): Promise<UserLeagueSummary[]> {
  const cleaned = usernameOrId.trim().replace(/^@/, '')
  if (!cleaned) return []
  const user = await getJson<{ user_id?: string; display_name?: string } | null>(
    `${SLEEPER_API}/user/${encodeURIComponent(cleaned)}`,
    signal,
  )
  if (!user?.user_id) {
    throw new Error(`Sleeper user "${cleaned}" not found.`)
  }
  const nflState = await getJson<NflState>(`${SLEEPER_API}/state/nfl`, signal)
  const season = nflState.league_season || nflState.season || String(new Date().getFullYear())
  const leagues = await getJson<SleeperLeague[]>(
    `${SLEEPER_API}/user/${user.user_id}/leagues/nfl/${season}`,
    signal,
  )
  return (leagues ?? [])
    .map((league) => ({
      league_id: league.league_id,
      name: league.name,
      season: league.season || season,
      total_rosters: league.total_rosters,
      status: league.status,
      isDynasty: Number(league.settings?.type) === 2,
    }))
    .sort((a, b) => Number(b.isDynasty) - Number(a.isDynasty) || a.name.localeCompare(b.name))
}

async function getWeekFeed(leagueId: string, season: string, week: number, signal?: AbortSignal): Promise<WeekFeed> {
  const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&year=${season}`
  const catchNonAbort = <T,>(fallback: T) => (err: unknown): T => {
    if (signal?.aborted) throw err
    return fallback
  }
  const [matchups, projections, scoreboard] = await Promise.all([
    getJson<Matchup[]>(`${SLEEPER_API}/league/${leagueId}/matchups/${week}`, signal).catch(catchNonAbort<Matchup[]>([])),
    getJson<Record<string, StatLine>>(`${SLEEPER_API}/projections/nfl/regular/${season}/${week}?season_type=regular`, signal).catch(catchNonAbort<Record<string, StatLine>>({})),
    getJson<EspnScoreboard>(scoreboardUrl, signal).catch(catchNonAbort<EspnScoreboard>({})),
  ])
  const byes = (scoreboard.week?.teamsOnBye ?? [])
    .map((team) => normalizeNflTeam(team.abbreviation))
    .filter((team): team is string => Boolean(team))
  const gameStates: Record<string, 'pre' | 'in' | 'post'> = {}
  const gameProgress: Record<string, number> = {}
  for (const event of scoreboard.events ?? []) {
    const competition = event.competitions?.[0]
    const state = competition?.status?.type?.state
    const period = competition?.status?.period ?? 0
    const secondsLeft = Math.min(900, Math.max(0, parseClockSeconds(competition?.status?.displayClock)))
    const quarterFraction = Math.min(1, Math.max(0, (900 - secondsLeft) / 900))
    let progress = 0
    if (state === 'post') {
      progress = 1
    } else if (state === 'in') {
      if (period >= 5) {
        progress = 0.98
      } else if (period === 4) {
        // NFL 4th quarter has high scoring density (~30% of total game points from hurry-up and comeback scripts).
        progress = Math.min(0.98, 0.70 + 0.30 * quarterFraction)
      } else if (period === 3) {
        progress = 0.48 + 0.22 * quarterFraction
      } else if (period === 2) {
        // NFL 2nd quarter contains the 2-minute drill (~28% of game scoring).
        progress = 0.20 + 0.28 * quarterFraction
      } else {
        progress = 0.00 + 0.20 * quarterFraction
      }
    }
    for (const competitor of competition?.competitors ?? []) {
      const abbreviation = normalizeNflTeam(competitor.team?.abbreviation)
      if (abbreviation && state) {
        gameStates[abbreviation] = state
        gameProgress[abbreviation] = progress
      }
    }
  }
  return { matchups, projections, byes, gameStates, gameProgress }
}

export async function loadLeagueData(leagueId: string, signal?: AbortSignal): Promise<LeagueData> {
  const [league, rosters, users, tradedPicks, nflState] = await Promise.all([
    getJson<SleeperLeague>(`${SLEEPER_API}/league/${leagueId}`, signal),
    getJson<SleeperRoster[]>(`${SLEEPER_API}/league/${leagueId}/rosters`, signal),
    getJson<SleeperUser[]>(`${SLEEPER_API}/league/${leagueId}/users`, signal),
    getJson<TradedPick[]>(`${SLEEPER_API}/league/${leagueId}/traded_picks`, signal),
    getJson<NflState>(`${SLEEPER_API}/state/nfl`, signal),
  ])
  const season = league.season || nflState.league_season || nflState.season || String(new Date().getFullYear())
  const currentWeek = Math.min(18, Math.max(1, nflState.week ?? (Number(league.settings.leg) || 1)))
  const rawLastScored = Number(league.settings.last_scored_leg)
  const lastScoredWeek = Number.isFinite(rawLastScored) && rawLastScored >= 0
    ? Math.min(18, rawLastScored)
    : Math.max(0, currentWeek - 1)
  const playoffStart = Number(league.settings.playoff_week_start) || 15
  const regularEnd = Math.min(18, Math.max(1, playoffStart - 1))
  const firstActiveWeek = Math.max(1, lastScoredWeek + 1)
  const lastWeek = regularEnd
  const completedCount = Math.min(regularEnd, Math.max(0, lastScoredWeek))

  const [weekEntries, historicEntries, players] = await Promise.all([
    Promise.all(Array.from({ length: Math.max(0, lastWeek - firstActiveWeek + 1) }, async (_, index) => {
      const week = firstActiveWeek + index
      return [week, await getWeekFeed(leagueId, season, week, signal)] as const
    })),
    Promise.all(Array.from({ length: completedCount }, async (_, index) => {
      const week = index + 1
      const matchups = await getJson<Matchup[]>(`${SLEEPER_API}/league/${leagueId}/matchups/${week}`, signal).catch((err) => {
        if (signal?.aborted) throw err
        return [] as Matchup[]
      })
      return [week, matchups] as const
    })),
    getPlayerIndex(signal),
  ])

  const historicalMaxPf = Object.fromEntries(rosters.map((roster) => [
    roster.roster_id,
    historicEntries.flatMap(([, matchups]) => {
      const matchup = matchups.find((item) => item.roster_id === roster.roster_id)
      return matchup ? [historicalMaxLineup(matchup, players, league.roster_positions)] : []
    }),
  ]))
  const historicalTeamScores = Object.fromEntries(rosters.map((roster) => [
    roster.roster_id,
    historicEntries.flatMap(([, matchups]) => {
      const matchup = matchups.find((item) => item.roster_id === roster.roster_id)
      const score = matchup?.custom_points ?? matchup?.points
      return typeof score === 'number' && Number.isFinite(score) ? [score] : []
    }),
  ]))

  const historicalPlayerPoints: Record<string, number[]> = {}
  const historicalPlayerWeeks: Record<string, number[]> = {}
  for (const [week, matchups] of historicEntries) {
    for (const matchup of matchups) {
      for (const [playerId, pts] of Object.entries(matchup.players_points ?? {})) {
        if (typeof pts === 'number' && Number.isFinite(pts)) {
          const bucket = historicalPlayerPoints[playerId]
          if (bucket) {
            bucket.push(pts)
            historicalPlayerWeeks[playerId].push(week)
          } else {
            historicalPlayerPoints[playerId] = [pts]
            historicalPlayerWeeks[playerId] = [week]
          }
        }
      }
    }
  }

  return {
    league,
    rosters,
    users,
    players,
    tradedPicks,
    currentWeek,
    lastScoredWeek,
    weeks: Object.fromEntries(weekEntries),
    historicalMaxPf,
    historicalTeamScores,
    historicalPlayerPoints,
    historicalPlayerWeeks,
    lastUpdated: Date.now(),
  }
}
