import type { LeagueData, SleeperPlayer, SleeperRoster, StatLine } from './sleeper'

export interface ProjectedPick {
  roster: SleeperRoster
  name: string
  record: string
  maxPf: number
  currentMaxPf: number
  pick: number
  pickHolder: string
  pickHolderId: number
  probabilities: number[]
  probabilityRanges: Array<{ low: number; high: number }>
  modelNames: string[]
  simulationCount: number
}

const SIMULATIONS_PER_MODEL = 500
const MODELS = [
  { key: 'gaussian', label: 'Projection Gaussian', sampler: 'gaussian', variance: 1, formWeight: 0, projectionScale: 1 },
  { key: 'student-t', label: 'Heavy-tail Student-t', sampler: 'student-t', variance: 1, formWeight: 0, projectionScale: 1 },
  { key: 'bootstrap', label: 'Historical residual bootstrap', sampler: 'bootstrap', variance: 1, formWeight: 0, projectionScale: 1 },
  { key: 'recent-form', label: 'Recent-form adjusted', sampler: 'gaussian', variance: 0.9, formWeight: 0.35, projectionScale: 1 },
  { key: 'downside', label: 'Conservative downside stress', sampler: 'student-t', variance: 1.15, formWeight: 0, projectionScale: 0.9 },
] as const
const TOTAL_SIMULATIONS = SIMULATIONS_PER_MODEL * MODELS.length
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

function score(stats: StatLine | undefined, scoring: Record<string, number>): number {
  if (!stats) return 0
  let total = 0
  let found = false
  for (const [stat, value] of Object.entries(scoring)) {
    if (typeof stats[stat] === 'number') {
      found = true
      total += stats[stat] * value
    }
  }
  return Math.max(0, found ? total : number(stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std))
}

function injuryFactor(player?: SleeperPlayer): number {
  const status = `${player?.injury_status ?? ''} ${player?.status ?? ''}`.toLowerCase()
  if (/injured reserve|\bir\b|pup|suspended|out/.test(status)) return 0
  if (status.includes('doubtful')) return 0.25
  if (status.includes('questionable')) return 0.65
  if (status.includes('probable')) return 0.9
  return 1
}

function eligible(player: SleeperPlayer | undefined, slot: string): boolean {
  const positions = player?.fantasy_positions ?? (player?.position ? [player.position] : [])
  if (positions.includes(slot)) return true
  const flex: Record<string, string[]> = {
    FLEX: ['RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  }
  return (flex[slot] ?? []).some((position) => positions.includes(position))
}

function projectedLineup(data: LeagueData, roster: SleeperRoster, week: number): number {
  const feed = data.weeks[week]
  if (!feed) return 0
  const slots = data.league.roster_positions.filter((slot) => !['BN', 'IR', 'TAXI', 'RESERVE'].includes(slot))
  const liveMatchup = week === data.currentWeek ? feed.matchups.find((item) => item.roster_id === roster.roster_id) : undefined
  const candidates = (roster.players ?? []).map((id) => {
    const player = data.players[id]
    const bye = Boolean(player?.team && feed.byes.includes(player.team))
    const availability = week === data.currentWeek ? injuryFactor(player) : 1
    const projection = score(feed.projections[id], data.league.scoring_settings) * availability
    const gameState = player?.team ? feed.gameStates[player.team] : undefined
    const actual = number(liveMatchup?.players_points?.[id])
    const points = liveMatchup && gameState === 'post' ? actual
      : liveMatchup && gameState === 'in' ? actual + projection * (1 - (feed.gameProgress[player?.team ?? ''] ?? 0.5))
        : projection
    return { id, player, points: bye ? 0 : points }
  }).sort((a, b) => b.points - a.points)
  const orderedSlots = [...slots].sort((a, b) => candidates.filter((item) => eligible(item.player, a)).length - candidates.filter((item) => eligible(item.player, b)).length)
  const used = new Set<string>()
  let total = 0
  for (const slot of orderedSlots) {
    const candidate = candidates.find((item) => !used.has(item.id) && eligible(item.player, slot))
    if (!candidate) continue
    used.add(candidate.id)
    total += candidate.points
  }
  return total
}

function currentWeekPoints(data: LeagueData, roster: SleeperRoster): number {
  const feed = data.weeks[data.currentWeek]
  const matchup = feed?.matchups.find((item) => item.roster_id === roster.roster_id)
  if (!feed || !matchup) return 0
  const starters = matchup.starters?.length ? matchup.starters : (roster.players ?? [])
  return starters.reduce((total, id) => {
    const player = data.players[id]
    if (player?.team && feed.byes.includes(player.team)) return total
    const gameState = player?.team ? feed.gameStates[player.team] : undefined
    const actual = number(matchup.players_points?.[id])
    const projection = score(feed.projections[id], data.league.scoring_settings) * injuryFactor(player)
    if (gameState === 'post') return total + actual
    if (gameState === 'in') return total + actual + projection * (1 - (feed.gameProgress[player?.team ?? ''] ?? 0.5))
    return total + projection
  }, 0)
}

function randomFor(seed: number): () => number {
  let value = seed >>> 0
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296 }
}

function normal(random: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(random(), Number.EPSILON))) * Math.cos(2 * Math.PI * random())
}

function studentT5(random: () => number): number {
  const normalSample = normal(random)
  const chiSquare = Array.from({ length: 5 }, () => normal(random) ** 2).reduce((sum, value) => sum + value, 0)
  return normalSample / Math.sqrt(Math.max(chiSquare / 5, Number.EPSILON)) * Math.sqrt(3 / 5)
}

function bootstrapResidual(history: number[], index: number): number {
  if (history.length < 3) return normalFallback()
  const mean = history.reduce((sum, value) => sum + value, 0) / history.length
  const deviation = sampleDeviation(history)
  if (!deviation) return 0
  return ((history[index % history.length] ?? mean) - mean) / deviation
}

function normalFallback(): number {
  return 0
}

function sampleStandardizedResidual(
  sampler: (typeof MODELS)[number]['sampler'],
  random: () => number,
  history: number[],
  bootstrapIndex: number,
): number {
  if (sampler === 'bootstrap') {
    if (history.length >= 3 && sampleDeviation(history) > 0) return bootstrapResidual(history, bootstrapIndex)
    return normal(random)
  }
  if (sampler === 'student-t') return studentT5(random)
  return normal(random)
}

function sampleDeviation(scores: number[]): number {
  if (scores.length < 2) return 0
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length
  const variance = scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (scores.length - 1)
  return Math.sqrt(variance)
}

function blendDeviation(scores: number[], prior: number): number {
  if (scores.length < 2) return prior
  const weight = scores.length / (scores.length + 5)
  return sampleDeviation(scores) * weight + prior * (1 - weight)
}

function historicalScoreDeviation(data: LeagueData): number {
  const deviations = Object.values(data.historicalScores).flatMap((scores) => {
    if (scores.length < 2) return []
    return [sampleDeviation(scores)]
  })
  if (!deviations.length) return 18
  const averageDeviation = deviations.reduce((sum, value) => sum + value, 0) / deviations.length
  return Math.min(45, Math.max(12, averageDeviation))
}

function teamScoreDeviation(data: LeagueData, rosterId: number, leagueDeviation: number): number {
  const history = data.historicalTeamScores[rosterId] ?? []
  return Math.min(45, Math.max(12, blendDeviation(history, leagueDeviation)))
}

function teamMaxPfDeviation(data: LeagueData, rosterId: number, leagueDeviation: number): number {
  const history = data.historicalMaxPf[rosterId] ?? []
  return Math.min(45, Math.max(8, blendDeviation(history, leagueDeviation * 0.65)))
}

function recentFormDeltas(data: LeagueData, rosterId: number): { score: number; maxPf: number } {
  const scoreHistory = data.historicalTeamScores[rosterId] ?? []
  const maxPfHistory = data.historicalMaxPf[rosterId] ?? []
  const historicalWeeks = Object.keys(data.historicalScores).map(Number).sort((a, b) => a - b)
  const start = Math.max(0, historicalWeeks.length - 3)
  let scoreDelta = 0
  let maxPfDelta = 0
  let weightTotal = 0
  for (let index = start; index < historicalWeeks.length; index += 1) {
    const week = historicalWeeks[index]
    const leagueScores = data.historicalScores[week] ?? []
    const leagueAverageScore = leagueScores.length ? leagueScores.reduce((sum, value) => sum + value, 0) / leagueScores.length : 0
    const leagueMaxPf = Object.values(data.historicalMaxPf).map((values) => values[index]).filter((value): value is number => typeof value === 'number')
    const leagueAverageMaxPf = leagueMaxPf.length ? leagueMaxPf.reduce((sum, value) => sum + value, 0) / leagueMaxPf.length : 0
    const weight = index - start + 1
    scoreDelta += ((scoreHistory[index] ?? leagueAverageScore) - leagueAverageScore) * weight
    maxPfDelta += ((maxPfHistory[index] ?? leagueAverageMaxPf) - leagueAverageMaxPf) * weight
    weightTotal += weight
  }
  if (!weightTotal) return { score: 0, maxPf: 0 }
  return {
    score: Math.max(-12, Math.min(12, scoreDelta / weightTotal)),
    maxPf: Math.max(-15, Math.min(15, maxPfDelta / weightTotal)),
  }
}

function teamName(data: LeagueData, roster: SleeperRoster): string {
  const user = data.users.find((item) => item.user_id === roster.owner_id)
  return user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`
}

export function projectDraftOrder(data: LeagueData): ProjectedPick[] {
  const league = data.league
  const count = data.rosters.length
  const playoffStart = Number(league.settings.playoff_week_start) || 15
  const playoffTeams = Math.min(count, Number(league.settings.playoff_teams) || 6)
  const regularEnd = Math.min(18, Math.max(data.currentWeek, playoffStart - 1))
  const leagueScoreDeviation = historicalScoreDeviation(data)
  const scoreDeviations = new Map(data.rosters.map((roster) => [
    roster.roster_id,
    teamScoreDeviation(data, roster.roster_id, leagueScoreDeviation),
  ]))
  const maxPfDeviations = new Map(data.rosters.map((roster) => [
    roster.roster_id,
    teamMaxPfDeviation(data, roster.roster_id, leagueScoreDeviation),
  ]))
  const formDeltas = new Map(data.rosters.map((roster) => [roster.roster_id, recentFormDeltas(data, roster.roster_id)]))
  const weeks = new Map<number, Map<number, { score: number; maxPf: number }>>()
  for (let week = data.currentWeek; week <= Math.min(18, playoffStart + 2); week += 1) {
    weeks.set(week, new Map(data.rosters.map((roster) => [roster.roster_id, {
      score: week === data.currentWeek ? currentWeekPoints(data, roster) : projectedLineup(data, roster, week),
      maxPf: projectedLineup(data, roster, week),
    }])))
  }

  const maxPf = new Map<number, number>()
  for (const roster of data.rosters) {
    const total = number(roster.settings.ppts) + number(roster.settings.ppts_decimal) / 100
    const rest = Array.from({ length: Math.max(0, regularEnd - data.currentWeek + 1) }, (_, index) => data.currentWeek + index)
      .reduce((sum, week) => sum + (weeks.get(week)?.get(roster.roster_id)?.maxPf ?? 0), 0)
    maxPf.set(roster.roster_id, total + rest)
  }

  const stats = new Map(data.rosters.map((roster) => [roster.roster_id, {
    roster,
    name: teamName(data, roster),
    maxPf: maxPf.get(roster.roster_id) ?? 0,
    points: number(roster.settings.fpts) + number(roster.settings.fpts_decimal) / 100,
    picks: Array(count + 1).fill(0) as number[],
    modelPicks: Object.fromEntries(MODELS.map((model) => [model.key, Array(count + 1).fill(0) as number[]])) as Record<(typeof MODELS)[number]['key'], number[]>,
  }]))
  const baseSeed = Number(league.season) * 1000 + data.currentWeek

  for (const [modelIndex, model] of MODELS.entries()) {
    const random = randomFor(baseSeed + modelIndex * 7919)
    for (let run = 0; run < SIMULATIONS_PER_MODEL; run += 1) {
    const simulatedMaxPf = new Map(data.rosters.map((roster) => [
      roster.roster_id,
      number(roster.settings.ppts) + number(roster.settings.ppts_decimal) / 100,
    ]))
    const records = new Map(data.rosters.map((roster) => [roster.roster_id, {
      wins: number(roster.settings.wins), losses: number(roster.settings.losses), ties: number(roster.settings.ties),
      points: number(roster.settings.fpts) + number(roster.settings.fpts_decimal) / 100,
    }]))
    for (let week = data.currentWeek; week <= regularEnd; week += 1) {
      const points = new Map<number, number>()
      for (const roster of data.rosters) {
        const mean = weeks.get(week)?.get(roster.roster_id)?.score ?? 0
        const scoreDeviation = scoreDeviations.get(roster.roster_id) ?? leagueScoreDeviation
        const maxPfDeviation = maxPfDeviations.get(roster.roster_id) ?? leagueScoreDeviation * 0.65
        const form = formDeltas.get(roster.roster_id) ?? { score: 0, maxPf: 0 }
        const scoreHistory = data.historicalTeamScores[roster.roster_id] ?? []
        const maxPfHistory = data.historicalMaxPf[roster.roster_id] ?? []
        const historyLength = Math.max(scoreHistory.length, maxPfHistory.length, 1)
        const bootstrapIndex = Math.floor(random() * historyLength)
        const noise = week === data.currentWeek ? 0 : sampleStandardizedResidual(model.sampler, random, scoreHistory, bootstrapIndex)
        const projectedMean = mean * model.projectionScale + form.score * model.formWeight
        const projected = week === data.currentWeek ? mean : Math.max(0, projectedMean + noise * scoreDeviation * model.variance)
        const maxPfMean = weeks.get(week)?.get(roster.roster_id)?.maxPf ?? 0
        const projectedMaxPfMean = maxPfMean * model.projectionScale + form.maxPf * model.formWeight
        const maxPfForWeek = week === data.currentWeek ? maxPfMean : Math.max(0, projectedMaxPfMean + noise * maxPfDeviation * model.variance)
        simulatedMaxPf.set(roster.roster_id, (simulatedMaxPf.get(roster.roster_id) ?? 0) + maxPfForWeek)
        points.set(roster.roster_id, projected)
        records.get(roster.roster_id)!.points += week === data.currentWeek
          ? Math.max(0, mean - number(data.weeks[week]?.matchups.find((item) => item.roster_id === roster.roster_id)?.points))
          : mean
      }
      const pairs = new Map<number, number[]>()
      for (const matchup of data.weeks[week]?.matchups ?? []) {
        if (matchup.matchup_id == null) continue
        pairs.set(matchup.matchup_id, [...(pairs.get(matchup.matchup_id) ?? []), matchup.roster_id])
      }
      for (const pair of pairs.values()) {
        if (pair.length !== 2) continue
        const first = records.get(pair[0])!
        const second = records.get(pair[1])!
        const firstScore = points.get(pair[0]) ?? 0
        const secondScore = points.get(pair[1]) ?? 0
        if (Math.abs(firstScore - secondScore) < 0.01) { first.ties += 1; second.ties += 1 }
        else if (firstScore > secondScore) { first.wins += 1; second.losses += 1 }
        else { second.wins += 1; first.losses += 1 }
      }
      if (Number(league.settings.league_average_match) === 1) {
        const average = [...points.values()].reduce((sum, value) => sum + value, 0) / Math.max(1, count)
        for (const roster of data.rosters) {
          const record = records.get(roster.roster_id)!
          const teamPoints = points.get(roster.roster_id) ?? 0
          if (Math.abs(teamPoints - average) < 0.01) record.ties += 1
          else if (teamPoints > average) record.wins += 1
          else record.losses += 1
        }
      }
    }

    const seeded = [...data.rosters].sort((a, b) => {
      const first = records.get(a.roster_id)!
      const second = records.get(b.roster_id)!
      return (second.wins + second.ties / 2) - (first.wins + first.ties / 2) || second.points - first.points
    })
    const playoff = seeded.slice(0, playoffTeams)
    const playoffOrder: number[] = []
    if (playoff.length === 6) {
      const ids = playoff.map((roster) => roster.roster_id)
      const play = (first: number, second: number, week: number) => {
        const firstForm = formDeltas.get(first)?.score ?? 0
        const secondForm = formDeltas.get(second)?.score ?? 0
        const firstMean = (weeks.get(week)?.get(first)?.score ?? 0) * model.projectionScale + firstForm * model.formWeight
        const secondMean = (weeks.get(week)?.get(second)?.score ?? 0) * model.projectionScale + secondForm * model.formWeight
        const firstHistory = data.historicalTeamScores[first] ?? []
        const secondHistory = data.historicalTeamScores[second] ?? []
        const firstNoise = sampleStandardizedResidual(model.sampler, random, firstHistory, Math.floor(random() * Math.max(firstHistory.length, 1)))
        const secondNoise = sampleStandardizedResidual(model.sampler, random, secondHistory, Math.floor(random() * Math.max(secondHistory.length, 1)))
        const a = Math.max(0, firstMean + firstNoise * (scoreDeviations.get(first) ?? leagueScoreDeviation) * model.variance)
        const b = Math.max(0, secondMean + secondNoise * (scoreDeviations.get(second) ?? leagueScoreDeviation) * model.variance)
        const winning = a === b ? (random() < 0.5 ? first : second) : a > b ? first : second
        return { winner: winning, loser: winning === first ? second : first }
      }
      const one = play(ids[2], ids[5], playoffStart)
      const two = play(ids[3], ids[4], playoffStart)
      const semiOne = play(ids[0], two.winner, playoffStart + 1)
      const semiTwo = play(ids[1], one.winner, playoffStart + 1)
      const final = play(semiOne.winner, semiTwo.winner, playoffStart + 2)
      const third = play(semiOne.loser, semiTwo.loser, playoffStart + 2)
      const fifth = play(one.loser, two.loser, playoffStart + 1)
      playoffOrder.push(final.winner, final.loser, third.winner, third.loser, fifth.winner, fifth.loser)
    } else playoff.forEach((roster) => playoffOrder.push(roster.roster_id))
    playoffOrder.forEach((rosterId, index) => {
      const team = stats.get(rosterId)!
      team.picks[count - index] += 1
      team.modelPicks[model.key][count - index] += 1
    })
    const eliminated = data.rosters.filter((roster) => !playoff.some((seed) => seed.roster_id === roster.roster_id))
      .sort((a, b) => (simulatedMaxPf.get(a.roster_id) ?? 0) - (simulatedMaxPf.get(b.roster_id) ?? 0))
    eliminated.forEach((roster, index) => {
      const team = stats.get(roster.roster_id)!
      team.picks[index + 1] += 1
      team.modelPicks[model.key][index + 1] += 1
    })
    }
  }

  const pickOwners = new Map<number, number>()
  for (const pick of data.tradedPicks) {
    if (Number(pick.season) === Number(league.season) + 1 && pick.round === 1) pickOwners.set(pick.roster_id, pick.owner_id)
  }
  return [...stats.values()].map((team) => {
    const modelProbabilities = MODELS.map((model) => team.modelPicks[model.key].slice(1).map((value) => value / SIMULATIONS_PER_MODEL))
    const probabilities = team.picks.slice(1).map((value) => value / TOTAL_SIMULATIONS)
    const probabilityRanges = probabilities.map((_, index) => ({
      low: Math.min(...modelProbabilities.map((model) => model[index] ?? 0)),
      high: Math.max(...modelProbabilities.map((model) => model[index] ?? 0)),
    }))
    const pick = probabilities.reduce((best, chance, index) => chance > probabilities[best - 1] ? index + 1 : best, 1)
    const pickHolderId = pickOwners.get(team.roster.roster_id) ?? team.roster.roster_id
    const holder = data.rosters.find((roster) => roster.roster_id === pickHolderId)
    const wins = number(team.roster.settings.wins)
    const losses = number(team.roster.settings.losses)
    const ties = number(team.roster.settings.ties)
    return {
      roster: team.roster,
      name: team.name,
      record: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
      maxPf: team.maxPf,
      currentMaxPf: number(team.roster.settings.ppts) + number(team.roster.settings.ppts_decimal) / 100,
      pick,
      pickHolder: holder ? teamName(data, holder) : `Team ${pickHolderId}`,
      pickHolderId,
      probabilities,
      probabilityRanges,
      modelNames: MODELS.map((model) => model.label),
      simulationCount: TOTAL_SIMULATIONS,
    }
  }).sort((a, b) => a.pick - b.pick)
}
