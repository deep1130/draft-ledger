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

export interface LeagueData {
  league: SleeperLeague
  rosters: SleeperRoster[]
  users: SleeperUser[]
  players: Record<string, SleeperPlayer>
  tradedPicks: TradedPick[]
  currentWeek: number
  weeks: Record<number, WeekFeed>
  historicalScores: Record<number, number[]>
  historicalMaxPf: Record<number, number[]>
  historicalTeamScores: Record<number, number[]>
  lastUpdated: number
}

interface NflState {
  week?: number
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

function playerFitsSlot(player: SleeperPlayer | undefined, slot: string): boolean {
  const positions = player?.fantasy_positions ?? (player?.position ? [player.position] : [])
  if (positions.includes(slot)) return true
  const flex: Record<string, string[]> = {
    FLEX: ['RB', 'WR', 'TE'],
    REC_FLEX: ['WR', 'TE'],
    WRRB_FLEX: ['RB', 'WR'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  }
  return (flex[slot] ?? []).some((position) => positions.includes(position))
}

function historicalMaxLineup(matchup: Matchup, players: Record<string, SleeperPlayer>, rosterPositions: string[]): number {
  const slots = rosterPositions.filter((slot) => !['BN', 'IR', 'TAXI', 'RESERVE'].includes(slot))
  const points = matchup.players_points ?? {}
  const candidates = (matchup.players ?? Object.keys(points)).map((id) => ({
    id,
    player: players[id],
    points: typeof points[id] === 'number' && Number.isFinite(points[id]) ? points[id] : 0,
  })).sort((first, second) => second.points - first.points)
  const orderedSlots = [...slots].sort((first, second) =>
    candidates.filter((candidate) => playerFitsSlot(candidate.player, first)).length -
    candidates.filter((candidate) => playerFitsSlot(candidate.player, second)).length,
  )
  const used = new Set<string>()
  let total = 0
  for (const slot of orderedSlots) {
    const candidate = candidates.find((item) => !used.has(item.id) && playerFitsSlot(item.player, slot))
    if (!candidate) continue
    used.add(candidate.id)
    total += candidate.points
  }
  return total
}

const SLEEPER_API = 'https://api.sleeper.app/v1'
const PLAYER_CACHE_KEY = 'draft-order-player-index-v1'
const PLAYER_CACHE_MAX_AGE = 24 * 60 * 60 * 1000

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`)
  return response.json() as Promise<T>
}

async function getPlayerIndex(): Promise<Record<string, SleeperPlayer>> {
  try {
    const stored = localStorage.getItem(PLAYER_CACHE_KEY)
    if (stored) {
      const cached = JSON.parse(stored) as { savedAt: number; players: Record<string, SleeperPlayer> }
      if (Date.now() - cached.savedAt < PLAYER_CACHE_MAX_AGE) return cached.players
    }
  } catch {
    localStorage.removeItem(PLAYER_CACHE_KEY)
  }

  const players = await getJson<Record<string, SleeperPlayer>>(`${SLEEPER_API}/players/nfl?active=true`)
  try {
    localStorage.setItem(PLAYER_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), players }))
  } catch {
    // The full index can exceed a browser's local storage quota.
  }
  return players
}

async function getWeekFeed(leagueId: string, season: string, week: number): Promise<WeekFeed> {
  const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&year=${season}`
  const [matchups, projections, scoreboard] = await Promise.all([
    getJson<Matchup[]>(`${SLEEPER_API}/league/${leagueId}/matchups/${week}`).catch(() => []),
    getJson<Record<string, StatLine>>(`${SLEEPER_API}/projections/nfl/regular/${season}/${week}?season_type=regular`).catch(() => ({})),
    getJson<EspnScoreboard>(scoreboardUrl).catch((): EspnScoreboard => ({})),
  ])
  const byes = (scoreboard.week?.teamsOnBye ?? []).map((team) => team.abbreviation).filter((team): team is string => Boolean(team))
  const gameStates: Record<string, 'pre' | 'in' | 'post'> = {}
  const gameProgress: Record<string, number> = {}
  for (const event of scoreboard.events ?? []) {
    const competition = event.competitions?.[0]
    const state = competition?.status?.type?.state
    const period = competition?.status?.period ?? 0
    const clockParts = competition?.status?.displayClock?.match(/^(\d+):(\d{2})$/)
    const secondsLeft = clockParts ? Number(clockParts[1]) * 60 + Number(clockParts[2]) : 900
    const progress = state === 'post' ? 1 : state === 'in'
      ? Math.min(0.98, Math.max(0, ((Math.min(Math.max(period, 1), 4) - 1) * 900 + (900 - secondsLeft)) / 3600))
      : 0
    for (const competitor of competition?.competitors ?? []) {
      const abbreviation = competitor.team?.abbreviation
      if (abbreviation && state) {
        gameStates[abbreviation] = state
        gameProgress[abbreviation] = progress
      }
    }
  }
  return { matchups, projections, byes, gameStates, gameProgress }
}

export async function loadLeagueData(leagueId: string): Promise<LeagueData> {
  const [league, rosters, users, tradedPicks, nflState] = await Promise.all([
    getJson<SleeperLeague>(`${SLEEPER_API}/league/${leagueId}`),
    getJson<SleeperRoster[]>(`${SLEEPER_API}/league/${leagueId}/rosters`),
    getJson<SleeperUser[]>(`${SLEEPER_API}/league/${leagueId}/users`),
    getJson<TradedPick[]>(`${SLEEPER_API}/league/${leagueId}/traded_picks`),
    getJson<NflState>(`${SLEEPER_API}/state/nfl`),
  ])
  const season = league.season || nflState.league_season || nflState.season || String(new Date().getFullYear())
  const currentWeek = Math.min(18, Math.max(1, nflState.week ?? (Number(league.settings.leg) || 1)))
  const playoffStart = Number(league.settings.playoff_week_start) || 15
  const lastWeek = Math.min(18, Math.max(currentWeek, playoffStart + 2))
  const [weekEntries, historicEntries, players] = await Promise.all([
    Promise.all(Array.from({ length: lastWeek - currentWeek + 1 }, async (_, index) => {
      const week = currentWeek + index
      return [week, await getWeekFeed(leagueId, season, week)] as const
    })),
    Promise.all(Array.from({ length: currentWeek - 1 }, async (_, index) => {
      const week = index + 1
      const matchups = await getJson<Matchup[]>(`${SLEEPER_API}/league/${leagueId}/matchups/${week}`).catch(() => [])
      return [week, matchups] as const
    })),
    getPlayerIndex(),
  ])
  const historicalScores = Object.fromEntries(historicEntries.map(([week, matchups]) => [
    week,
    matchups.map((matchup) => matchup.custom_points ?? matchup.points).filter(Number.isFinite),
  ]))
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
  return { league, rosters, users, players, tradedPicks, currentWeek, weeks: Object.fromEntries(weekEntries), historicalScores, historicalMaxPf, historicalTeamScores, lastUpdated: Date.now() }
}