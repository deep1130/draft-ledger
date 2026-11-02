import {
  normalizeNflTeam,
  playerFitsSlot,
  selectOptimalLineup,
  starterSlotsForLeague,
  type BracketMatch,
  type LeagueData,
  type SleeperPlayer,
  type SleeperRoster,
  type StatLine,
} from './sleeper'

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
  {
    key: 'gamma',
    label: 'Player-level Gamma',
    sampler: 'gamma',
    teamCorrSd: 0.18,
    useBayesianForm: false,
    useAttrition: false,
  },
  {
    key: 'boom-bust',
    label: 'Heavy-tail boom/bust',
    sampler: 'lognormal',
    teamCorrSd: 0.22,
    useBayesianForm: false,
    useAttrition: false,
  },
  {
    key: 'bootstrap',
    label: 'Empirical league bootstrap',
    sampler: 'bootstrap',
    teamCorrSd: 0.16,
    useBayesianForm: false,
    useAttrition: false,
  },
  {
    key: 'bayesian-form',
    label: 'Bayesian form & lineup efficiency',
    sampler: 'gamma',
    teamCorrSd: 0.18,
    useBayesianForm: true,
    useAttrition: false,
  },
  {
    key: 'attrition',
    label: 'Injury attrition & bench stress',
    sampler: 'gamma',
    teamCorrSd: 0.20,
    useBayesianForm: false,
    useAttrition: true,
  },
] as const

type ModelConfig = (typeof MODELS)[number]
type ModelKey = ModelConfig['key']

const TOTAL_SIMULATIONS = SIMULATIONS_PER_MODEL * MODELS.length

// Empirically calibrated positional dispersion theta where SD(X) = theta * sqrt(mean).
const POSITIONAL_THETA: Record<string, number> = {
  QB: 1.85,
  RB: 1.95,
  WR: 2.02,
  TE: 2.10,
  K: 1.65,
  DEF: 1.90,
}

// Weekly baseline surprise-inactive/injury attrition rates by position for Model 5.
const POSITIONAL_ATTRITION: Record<string, number> = {
  QB: 0.025,
  RB: 0.06,
  WR: 0.04,
  TE: 0.04,
  K: 0.015,
  DEF: 0.0,
}

const POSITION_BIT: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 4,
  TE: 8,
  K: 16,
  DEF: 32,
  DL: 64,
  LB: 128,
  DB: 256,
}

const SLOT_MASK: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 4,
  TE: 8,
  K: 16,
  DEF: 32,
  DL: 64,
  LB: 128,
  DB: 256,
  FLEX: 2 | 4 | 8,
  REC_FLEX: 4 | 8,
  WRRB_FLEX: 2 | 4,
  SUPER_FLEX: 1 | 2 | 4 | 8,
  IDP_FLEX: 64 | 128 | 256,
}

const MILESTONE_BONUS_KEYS = new Set([
  'bonus_rec_yd_100',
  'bonus_rec_yd_200',
  'bonus_rush_yd_100',
  'bonus_rush_yd_200',
  'bonus_rush_rec_yd_100',
  'bonus_rush_rec_yd_200',
  'bonus_pass_yd_300',
  'bonus_pass_yd_400',
  'bonus_pass_cmp_25',
])

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

function popcount(mask: number): number {
  let bits = 0
  let v = mask
  while (v) {
    bits += v & 1
    v >>>= 1
  }
  return bits
}

interface RandomSource {
  next: () => number
  nextU32: () => number
  normal: () => number
}

// 4096-point exact Acklam inverse-normal quantile table for O(1) branchless normal draws in L1 cache.
const NORMAL_QUANTILES = (() => {
  const size = 4096
  const table = new Float64Array(size)
  const a1 = -39.69683028665376
  const a2 = 220.9460984245205
  const a3 = -275.9285104469687
  const a4 = 138.357751867269
  const a5 = -30.66479806614716
  const a6 = 2.506628277459239
  const b1 = -54.47609879822406
  const b2 = 161.5858368580409
  const b3 = -155.6989798598866
  const b4 = 66.80131188771972
  const b5 = -13.28068155288572
  const c1 = -0.007784894002430293
  const c2 = -0.3223964580411365
  const c3 = -2.400758277161838
  const c4 = -2.549732539343734
  const c5 = 4.374664141464968
  const c6 = 2.938163982698783
  const d1 = 0.007784695709041462
  const d2 = 0.3224671290700398
  const d3 = 2.445134137142996
  const d4 = 3.754408661907416
  const pLow = 0.02425
  const pHigh = 1 - pLow

  for (let i = 0; i < size; i += 1) {
    const p = (i + 0.5) / size
    if (p < pLow) {
      const q = Math.sqrt(-2 * Math.log(p))
      table[i] = (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
        ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    } else if (p <= pHigh) {
      const q = p - 0.5
      const r = q * q
      table[i] = ((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) /
        (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
    } else {
      const q = Math.sqrt(-2 * Math.log(1 - p))
      table[i] = -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
        ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    }
  }
  return table
})()

function createRandomSource(seed: number): RandomSource {
  let state = seed >>> 0

  const nextU32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }

  const next = (): number => nextU32() / 4294967296
  const normal = (): number => NORMAL_QUANTILES[nextU32() >>> 20]

  return { next, nextU32, normal }
}

function sampleGamma(shape: number, rng: RandomSource): number {
  if (!(shape > 0) || !Number.isFinite(shape)) return 0
  if (shape >= 0.35) {
    // Wilson-Hilferty cube-root Gamma transform: matches Gamma mean, variance, and right skew with O(1) ops.
    const inv9 = 1 / (9 * shape)
    const v = 1 - inv9 + rng.normal() * Math.sqrt(inv9)
    return v > 0 ? shape * v * v * v : 0
  }
  // Very small shape (< 0.35): exact Ahrens-Dieter / Marsaglia reduction from shape + 1 >= 1.
  const d = shape + 1 - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  let gammaPlusOne = 0
  for (;;) {
    let x = 0
    let v = 0
    do {
      x = rng.normal()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = Math.max(rng.next(), 1e-12)
    const x2 = x * x
    if (u < 1 - 0.0331 * x2 * x2 || Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) {
      gammaPlusOne = d * v
      break
    }
  }
  const u = Math.max(rng.next(), 1e-12)
  return gammaPlusOne * Math.exp(Math.log(u) / shape)
}

function baseProjectionScore(stats: StatLine | undefined, scoring: Record<string, number>): number {
  if (!stats) return 0
  let total = 0
  let found = false
  for (const [stat, weight] of Object.entries(scoring)) {
    if (MILESTONE_BONUS_KEYS.has(stat)) continue
    if (typeof stats[stat] === 'number' && Number.isFinite(stats[stat])) {
      found = true
      total += stats[stat] * weight
    }
  }
  if (found) return Math.max(0, total)
  return Math.max(0, num(stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std))
}

interface MilestoneWeights {
  enabled: boolean
  rec100: number
  rec200: number
  rush100: number
  rush200: number
  comb100: number
  comb200: number
  pass300: number
  pass400: number
  cmp25: number
}

function extractMilestoneWeights(scoring: Record<string, number>): MilestoneWeights {
  const rec100 = num(scoring.bonus_rec_yd_100)
  const rec200 = num(scoring.bonus_rec_yd_200)
  const rush100 = num(scoring.bonus_rush_yd_100)
  const rush200 = num(scoring.bonus_rush_yd_200)
  const comb100 = num(scoring.bonus_rush_rec_yd_100)
  const comb200 = num(scoring.bonus_rush_rec_yd_200)
  const pass300 = num(scoring.bonus_pass_yd_300)
  const pass400 = num(scoring.bonus_pass_yd_400)
  const cmp25 = num(scoring.bonus_pass_cmp_25)
  const enabled = Boolean(
    rec100 || rec200 || rush100 || rush200 || comb100 || comb200 || pass300 || pass400 || cmp25,
  )
  return { enabled, rec100, rec200, rush100, rush200, comb100, comb200, pass300, pass400, cmp25 }
}

function milestoneBonusFromYards(
  passYd: number,
  passCmp: number,
  rushYd: number,
  recYd: number,
  mw: MilestoneWeights,
): number {
  let bonus = 0
  if (recYd >= 200 && mw.rec200) bonus += mw.rec200
  else if (recYd >= 100 && mw.rec100) bonus += mw.rec100

  if (rushYd >= 200 && mw.rush200) bonus += mw.rush200
  else if (rushYd >= 100 && mw.rush100) bonus += mw.rush100

  const combinedYd = rushYd + recYd
  if (combinedYd >= 200 && mw.comb200) bonus += mw.comb200
  else if (combinedYd >= 100 && mw.comb100) bonus += mw.comb100

  if (passYd >= 400 && mw.pass400) bonus += mw.pass400
  else if (passYd >= 300 && mw.pass300) bonus += mw.pass300

  if (passCmp >= 25 && mw.cmp25) bonus += mw.cmp25
  return bonus
}

function tailProbNormal(threshold: number, mean: number, sd: number): number {
  if (mean <= 0 || sd <= 0) return mean >= threshold ? 1 : 0
  const z = (threshold - mean) / sd
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)
  const upper = pdf * poly
  return z >= 0 ? upper : 1 - upper
}

function expectedMilestoneBonus(stats: StatLine | undefined, scoring: Record<string, number>): number {
  if (!stats) return 0
  const recYd = num(stats.rec_yd)
  const rushYd = num(stats.rush_yd)
  const passYd = num(stats.pass_yd)
  const passCmp = num(stats.pass_cmp)
  let expected = 0

  if (recYd > 15 && (scoring.bonus_rec_yd_100 || scoring.bonus_rec_yd_200)) {
    const sd = Math.max(12, 0.48 * recYd + 12)
    const p200 = tailProbNormal(200, recYd, sd)
    const p100 = Math.max(0, tailProbNormal(100, recYd, sd) - p200)
    expected += p100 * num(scoring.bonus_rec_yd_100) + p200 * num(scoring.bonus_rec_yd_200)
  }
  if (rushYd > 15 && (scoring.bonus_rush_yd_100 || scoring.bonus_rush_yd_200)) {
    const sd = Math.max(12, 0.46 * rushYd + 10)
    const p200 = tailProbNormal(200, rushYd, sd)
    const p100 = Math.max(0, tailProbNormal(100, rushYd, sd) - p200)
    expected += p100 * num(scoring.bonus_rush_yd_100) + p200 * num(scoring.bonus_rush_yd_200)
  }
  const combinedYd = rushYd + recYd
  if (combinedYd > 20 && (scoring.bonus_rush_rec_yd_100 || scoring.bonus_rush_rec_yd_200)) {
    const sd = Math.max(14, 0.44 * combinedYd + 12)
    const p200 = tailProbNormal(200, combinedYd, sd)
    const p100 = Math.max(0, tailProbNormal(100, combinedYd, sd) - p200)
    expected += p100 * num(scoring.bonus_rush_rec_yd_100) + p200 * num(scoring.bonus_rush_rec_yd_200)
  }
  if (passYd > 80 && (scoring.bonus_pass_yd_300 || scoring.bonus_pass_yd_400)) {
    const sd = Math.max(35, 0.27 * passYd + 18)
    const p400 = tailProbNormal(400, passYd, sd)
    const p300 = Math.max(0, tailProbNormal(300, passYd, sd) - p400)
    expected += p300 * num(scoring.bonus_pass_yd_300) + p400 * num(scoring.bonus_pass_yd_400)
  }
  if (passCmp > 8 && scoring.bonus_pass_cmp_25) {
    const sd = Math.max(3.5, 0.24 * passCmp + 1.5)
    expected += tailProbNormal(25, passCmp, sd) * num(scoring.bonus_pass_cmp_25)
  }
  return expected
}

type InjuryTier = 'healthy' | 'probable' | 'questionable' | 'doubtful' | 'out' | 'ir'

function classifyInjury(player?: SleeperPlayer): InjuryTier {
  const inj = (player?.injury_status ?? '').trim().toLowerCase()
  const status = (player?.status ?? '').trim().toLowerCase()
  if (/\bir\b|injured reserve|pup|\bnfi\b/.test(inj)) return 'ir'
  if (/\bout\b|\bsus\b|suspended|\bcov\b|\bdnr\b|\bna\b/.test(inj)) return 'out'
  if (inj.includes('doubtful')) return 'doubtful'
  if (inj.includes('questionable')) return 'questionable'
  if (inj.includes('probable')) return 'probable'
  if (status === 'inactive' && inj) return 'out'
  return 'healthy'
}

function playProbability(
  tier: InjuryTier,
  position: string,
  weeksAhead: number,
  useAttrition: boolean,
): number {
  if (weeksAhead <= 0) {
    switch (tier) {
      case 'ir':
      case 'out':
        return 0
      case 'doubtful':
        return 0.20
      case 'questionable':
        return 0.75
      case 'probable':
        return 0.93
      case 'healthy':
        return 1
    }
  }

  let injuryPersistMiss = 0
  if (tier === 'ir') {
    const irSchedule = [0, 0.65, 0.40, 0.20, 0.08]
    injuryPersistMiss = irSchedule[weeksAhead] ?? (useAttrition ? 0.05 : 0)
  } else if (tier === 'out') {
    injuryPersistMiss = Math.pow(0.32, weeksAhead)
  } else if (tier === 'doubtful') {
    injuryPersistMiss = 0.28 * Math.pow(0.35, weeksAhead - 1)
  } else if (tier === 'questionable' && useAttrition) {
    injuryPersistMiss = 0.10 * Math.pow(0.5, weeksAhead - 1)
  }

  const baseAttrition = useAttrition ? (POSITIONAL_ATTRITION[position] ?? 0.035) : 0
  const playProb = (1 - injuryPersistMiss) * (1 - baseAttrition)
  return Math.max(0, Math.min(1, playProb))
}

interface EmpiricalBootstrapPools {
  byKey: Record<string, Float64Array>
  fallback: Float64Array
}

function buildEmpiricalBootstrapPools(data: LeagueData): EmpiricalBootstrapPools {
  const buckets: Record<string, number[]> = {}
  const allRatios: number[] = []

  for (const [playerId, scores] of Object.entries(data.historicalPlayerPoints)) {
    const active = scores.filter((pts) => pts > 0.5)
    if (active.length < 3) continue
    const mean = active.reduce((sum, pts) => sum + pts, 0) / active.length
    if (mean < 2.5) continue
    const pos = data.players[playerId]?.position ?? 'OTHER'
    const tier = mean >= 10 ? 'high' : 'low'
    const key = `${pos}:${tier}`
    if (!buckets[key]) buckets[key] = []
    for (const pts of active) {
      const ratio = Math.max(0, pts / mean)
      buckets[key].push(ratio)
      allRatios.push(ratio)
    }
  }

  const byKey: Record<string, Float64Array> = {}
  for (const [key, values] of Object.entries(buckets)) {
    if (values.length >= 12) {
      byKey[key] = Float64Array.from(values)
    }
  }
  return {
    byKey,
    fallback: allRatios.length >= 20 ? Float64Array.from(allRatios) : new Float64Array(0),
  }
}

// Integer state codes for zero-string-comparison inner loop: 0 = bye, 1 = post, 2 = in, 3 = pre.
type GameStateCode = 0 | 1 | 2 | 3

interface CompiledPlayerWeek {
  id: string
  player: SleeperPlayer | undefined
  posMask: number
  nflTeamIndex: number
  state: GameStateCode
  lockedPoints: number
  remBaseMu: number
  expectedBonus: number
  remFraction: number
  theta2: number
  pPlayBase: number
  pPlayAttrition: number
  bootstrapPool: Float64Array
  projPassYd: number
  projPassCmp: number
  projRushYd: number
  projRecYd: number
}

interface CompiledRosterWeek {
  players: CompiledPlayerWeek[]
  hasActualStarters: boolean
  actualStarterSlotPlayers: Array<number>
  canUseBitmaskGreedy: boolean
}

interface CompiledSlotGroup {
  mask: number
  count: number
}

function compileSlotGroups(slots: readonly string[]): {
  unionMask: number
  groups: CompiledSlotGroup[]
  allStandardMasks: boolean
  hasOverlappingPartialFlex: boolean
} {
  const allStandardMasks = slots.every((slot) => slot in SLOT_MASK)
  const hasOverlappingPartialFlex = slots.includes('REC_FLEX') && slots.includes('WRRB_FLEX')
  let unionMask = 0
  for (const slot of slots) {
    unionMask |= SLOT_MASK[slot] ?? 0
  }

  const ordered = [...slots].sort(
    (a, b) => (popcount(SLOT_MASK[a] ?? 0) || 99) - (popcount(SLOT_MASK[b] ?? 0) || 99),
  )
  const groups: CompiledSlotGroup[] = []
  for (const slot of ordered) {
    const mask = SLOT_MASK[slot] ?? 0
    const existing = groups.find((group) => group.mask === mask)
    if (existing) existing.count += 1
    else groups.push({ mask, count: 1 })
  }
  return { unionMask, groups, allStandardMasks, hasOverlappingPartialFlex }
}

function fastBitmaskOptimalTotal(
  players: readonly CompiledPlayerWeek[],
  scores: Float64Array,
  orderScratch: Int32Array,
  usedScratch: Uint8Array,
  groups: readonly CompiledSlotGroup[],
): number {
  const n = players.length
  let activeCount = 0
  for (let i = 0; i < n; i += 1) {
    if (scores[i] > 0) {
      orderScratch[activeCount] = i
      activeCount += 1
    }
    usedScratch[i] = 0
  }
  for (let i = 1; i < activeCount; i += 1) {
    const idx = orderScratch[i]
    const val = scores[idx]
    let j = i - 1
    while (j >= 0 && scores[orderScratch[j]] < val) {
      orderScratch[j + 1] = orderScratch[j]
      j -= 1
    }
    orderScratch[j + 1] = idx
  }

  let total = 0
  for (let g = 0; g < groups.length; g += 1) {
    const mask = groups[g].mask
    let needed = groups[g].count
    for (let k = 0; k < activeCount && needed > 0; k += 1) {
      const pIdx = orderScratch[k]
      if (!usedScratch[pIdx] && (players[pIdx].posMask & mask) !== 0) {
        usedScratch[pIdx] = 1
        total += scores[pIdx]
        needed -= 1
      }
    }
  }
  return total
}

function fastBitmaskSelectStarters(
  players: readonly CompiledPlayerWeek[],
  expectedScores: Float64Array,
  orderScratch: Int32Array,
  usedScratch: Uint8Array,
  groups: readonly CompiledSlotGroup[],
): void {
  const n = players.length
  let activeCount = 0
  for (let i = 0; i < n; i += 1) {
    if (expectedScores[i] > 0) {
      orderScratch[activeCount] = i
      activeCount += 1
    }
    usedScratch[i] = 0
  }
  for (let i = 1; i < activeCount; i += 1) {
    const idx = orderScratch[i]
    const val = expectedScores[idx]
    let j = i - 1
    while (j >= 0 && expectedScores[orderScratch[j]] < val) {
      orderScratch[j + 1] = orderScratch[j]
      j -= 1
    }
    orderScratch[j + 1] = idx
  }
  for (let g = 0; g < groups.length; g += 1) {
    const mask = groups[g].mask
    let needed = groups[g].count
    for (let k = 0; k < activeCount && needed > 0; k += 1) {
      const pIdx = orderScratch[k]
      if (!usedScratch[pIdx] && (players[pIdx].posMask & mask) !== 0) {
        usedScratch[pIdx] = 1
        needed -= 1
      }
    }
  }
}

function samplePlayerRemainingPoints(
  pw: CompiledPlayerWeek,
  teamMult: number,
  formScale: number,
  sampler: ModelConfig['sampler'],
  milestoneWeights: MilestoneWeights,
  idioVarFactor: number,
  rng: RandomSource,
): number {
  const mu = pw.remBaseMu * formScale
  if (mu <= 0.02) return 0

  const scale = pw.theta2 * idioVarFactor

  let multiplier = 1
  if (sampler === 'bootstrap' && pw.bootstrapPool.length > 0 && pw.state === 3) {
    const rawRatio = pw.bootstrapPool[(rng.nextU32() % pw.bootstrapPool.length)]
    multiplier = 0.85 * rawRatio + 0.15 * teamMult
  } else if (sampler === 'lognormal') {
    const earlyExit = pw.state === 3 && rng.next() < 0.04
    const cv2 = Math.min(2.2, (scale * 1.18) / Math.max(mu, 0.6))
    const sigma2 = Math.log(1 + cv2)
    const sigma = Math.sqrt(sigma2)
    const logNormalUnit = Math.exp(-0.5 * sigma2 + sigma * rng.normal())
    const survivalAdjust = pw.state === 3 ? (earlyExit ? 0.20 : 1.0333333333333334) : 1
    multiplier = teamMult * logNormalUnit * survivalAdjust
  } else {
    const shape = mu / scale
    const idioSample = sampleGamma(shape, rng) * scale
    multiplier = (idioSample / mu) * teamMult
  }

  const baseSimulated = mu * multiplier
  if (!milestoneWeights.enabled) return baseSimulated

  if (pw.state === 2) {
    return baseSimulated + pw.expectedBonus * formScale * Math.min(2.2, multiplier)
  }

  const yardMult = multiplier * formScale
  const bonus = milestoneBonusFromYards(
    pw.projPassYd * yardMult,
    pw.projPassCmp * yardMult,
    pw.projRushYd * yardMult,
    pw.projRecYd * yardMult,
    milestoneWeights,
  )
  return baseSimulated + bonus
}

interface BayesianRosterCalibration {
  formMultiplier: number
  lineupEfficiency: number
}

function calibrateBayesianForm(
  data: LeagueData,
  compiledWeeks: Map<number, Map<number, CompiledRosterWeek>>,
  slots: readonly string[],
  firstSimWeek: number,
  regularEnd: number,
): Map<number, BayesianRosterCalibration> {
  const result = new Map<number, BayesianRosterCalibration>()
  const completedWeeks = data.lastScoredWeek

  const upcomingWeeks: number[] = []
  for (let w = firstSimWeek; w <= regularEnd; w += 1) {
    if (w > data.currentWeek && compiledWeeks.has(w)) upcomingWeeks.push(w)
  }

  for (const roster of data.rosters) {
    const scoreHist = data.historicalTeamScores[roster.roster_id] ?? []
    const maxPfHist = data.historicalMaxPf[roster.roster_id] ?? []
    if (completedWeeks < 2 || scoreHist.length < 2) {
      result.set(roster.roster_id, { formMultiplier: 1, lineupEfficiency: 1 })
      continue
    }

    const startIdx = Math.max(0, scoreHist.length - 4)
    let recentScoreSum = 0
    let recentWeightSum = 0
    for (let i = startIdx; i < scoreHist.length; i += 1) {
      const w = i - startIdx + 1
      recentScoreSum += scoreHist[i] * w
      recentWeightSum += w
    }
    const recentStarterAvg = recentWeightSum > 0 ? recentScoreSum / recentWeightSum : 0

    let projStarterAvg = 0
    if (upcomingWeeks.length > 0) {
      let sum = 0
      for (const w of upcomingWeeks) {
        const rw = compiledWeeks.get(w)?.get(roster.roster_id)
        if (!rw) continue
        const candidates = rw.players.map((pw) => ({
          id: pw.id,
          player: pw.player,
          points: (pw.remBaseMu + pw.expectedBonus) * pw.pPlayBase,
        }))
        sum += selectOptimalLineup(candidates, slots).total
      }
      projStarterAvg = sum / upcomingWeeks.length
    }

    let formMultiplier = 1
    if (projStarterAvg > 40 && recentStarterAvg > 40) {
      const rawRatio = recentStarterAvg / projStarterAvg
      const recentN = scoreHist.length - startIdx
      const shrinkWeight = recentN / (recentN + 14)
      formMultiplier = Math.max(0.92, Math.min(1.08, 1 + (rawRatio - 1) * shrinkWeight))
    }

    const histPfSum = scoreHist.reduce((s, v) => s + v, 0)
    const histMaxPfSum = maxPfHist.reduce((s, v) => s + v, 0)
    let lineupEfficiency = 1
    if (histMaxPfSum > 100) {
      const teamCapture = histPfSum / histMaxPfSum
      const expectedCapture = 0.865
      const effWeight = scoreHist.length / (scoreHist.length + 10)
      const rawEfficiency = teamCapture / expectedCapture
      lineupEfficiency = Math.max(0.90, Math.min(1.03, 1 + (rawEfficiency - 1) * effWeight))
    }

    result.set(roster.roster_id, { formMultiplier, lineupEfficiency })
  }

  return result
}

function teamName(data: LeagueData, roster: SleeperRoster): string {
  const user = data.users.find((item) => item.user_id === roster.owner_id)
  return user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`
}

function findDecidedBracketMatch(
  bracket: readonly BracketMatch[],
  round: number,
  teamA: number,
  teamB: number,
): { winner: number; loser: number } | undefined {
  const match = bracket.find(
    (item) =>
      item.r === round &&
      item.w != null &&
      item.l != null &&
      ((item.t1 === teamA && item.t2 === teamB) || (item.t1 === teamB && item.t2 === teamA)),
  )
  if (!match || match.w == null || match.l == null) return undefined
  return { winner: match.w, loser: match.l }
}

function assignBijectiveDraftPicks<T extends { probabilities: number[]; maxPf: number }>(
  teams: T[],
  nonPlayoffCount: number,
): Array<T & { pick: number; expectedPick: number }> {
  const enriched = teams.map((team) => {
    const lotteryProb = team.probabilities
      .slice(0, nonPlayoffCount)
      .reduce((sum, chance) => sum + chance, 0)
    const expectedPick = team.probabilities.reduce((sum, chance, index) => sum + chance * (index + 1), 0)
    return { team, lotteryProb, expectedPick }
  })

  const byLotteryLikelihood = [...enriched].sort(
    (a, b) =>
      b.lotteryProb - a.lotteryProb ||
      a.expectedPick - b.expectedPick ||
      a.team.maxPf - b.team.maxPf,
  )

  const lotteryGroup = byLotteryLikelihood
    .slice(0, nonPlayoffCount)
    .sort((a, b) => a.expectedPick - b.expectedPick || a.team.maxPf - b.team.maxPf)

  const playoffGroup = byLotteryLikelihood
    .slice(nonPlayoffCount)
    .sort((a, b) => a.expectedPick - b.expectedPick || a.team.maxPf - b.team.maxPf)

  const ordered = [...lotteryGroup, ...playoffGroup]
  return ordered.map((entry, index) => ({
    ...entry.team,
    pick: index + 1,
    expectedPick: entry.expectedPick,
  }))
}

export function projectDraftOrder(data: LeagueData): ProjectedPick[] {
  const league = data.league
  const count = data.rosters.length
  if (count === 0) return []

  const scoring = league.scoring_settings
  const milestoneWeights = extractMilestoneWeights(scoring)
  const hasMilestoneBonuses = milestoneWeights.enabled
  const slots = starterSlotsForLeague(league.roster_positions)
  const slotInfo = compileSlotGroups(slots)

  const playoffStart = Number(league.settings.playoff_week_start) || 15
  const playoffTeams = Math.min(count, Math.max(0, Number(league.settings.playoff_teams) || 6))
  const nonPlayoffCount = Math.max(0, count - playoffTeams)
  const reseedPlayoffs = Number(league.settings.playoff_type) === 1
  const hasLeagueMedianMatch = Number(league.settings.league_average_match) === 1

  const regularEnd = Math.min(18, Math.max(1, playoffStart - 1))
  const playoffEnd = Math.min(18, playoffStart + (playoffTeams > 4 ? 2 : 1))
  const firstSimWeek = Math.max(1, data.lastScoredWeek + 1)

  const nflTeamToId = new Map<string, number>()
  const getNflTeamId = (abbr?: string | null): number => {
    const norm = normalizeNflTeam(abbr)
    if (!norm) return -1
    const existing = nflTeamToId.get(norm)
    if (existing !== undefined) return existing
    const next = nflTeamToId.size
    nflTeamToId.set(norm, next)
    return next
  }

  const bootstrapPools = buildEmpiricalBootstrapPools(data)
  const compiledWeeks = new Map<number, Map<number, CompiledRosterWeek>>()
  let maxCompiledPlayers = slots.length

  for (let week = firstSimWeek; week <= playoffEnd; week += 1) {
    const feed = data.weeks[week]
    const isLiveCurrentWeek = week === data.currentWeek && week > data.lastScoredWeek
    const weeksAhead = Math.max(0, week - data.currentWeek)
    const byeSet = new Set(feed?.byes ?? [])
    const weekMap = new Map<number, CompiledRosterWeek>()

    for (const roster of data.rosters) {
      const liveMatchup = isLiveCurrentWeek
        ? feed?.matchups.find((item) => item.roster_id === roster.roster_id)
        : undefined
      const rawStarters = liveMatchup?.starters ?? []
      const actualStarterSet = new Set(rawStarters.filter((id) => id && id !== '0'))
      const playerIds = isLiveCurrentWeek && liveMatchup?.players?.length
        ? liveMatchup.players
        : (roster.players ?? [])

      let hasEffectiveMultiPos = false
      let hasExoticActivePos = false
      const idToIndex = new Map<string, number>()
      const compiledPlayers: CompiledPlayerWeek[] = []

      for (const id of playerIds) {
        const player = data.players[id]
        const nflTeam = normalizeNflTeam(player?.team)
        const onBye = Boolean(nflTeam && byeSet.has(nflTeam))
        const rawState = nflTeam ? feed?.gameStates[nflTeam] : undefined
        const projStats = feed?.projections[id]
        const baseMu = baseProjectionScore(projStats, scoring)
        const expBonus = hasMilestoneBonuses ? expectedMilestoneBonus(projStats, scoring) : 0
        const injuryTier = classifyInjury(player)
        const positions = player?.fantasy_positions?.length
          ? player.fantasy_positions
          : (player?.position ? [player.position] : [])
        const primaryPos = player?.position ?? positions[0] ?? 'WR'

        let state: GameStateCode = 3
        let lockedPoints = 0
        let remBaseMu = baseMu
        let expectedBonus = expBonus
        let remFraction = 1

        if (onBye) {
          state = 0
          remBaseMu = 0
          expectedBonus = 0
          remFraction = 0
        } else if (isLiveCurrentWeek && rawState === 'post') {
          state = 1
          lockedPoints = num(liveMatchup?.players_points?.[id])
          remBaseMu = 0
          expectedBonus = 0
          remFraction = 0
        } else if (isLiveCurrentWeek && rawState === 'in') {
          state = 2
          lockedPoints = num(liveMatchup?.players_points?.[id])
          const progress = nflTeam ? (feed?.gameProgress[nflTeam] ?? 0.5) : 0.5
          remFraction = Math.max(0.02, 1 - progress)
          const activeInGame = lockedPoints > 0 || (injuryTier !== 'out' && injuryTier !== 'ir')
          const liveAvail = lockedPoints > 0
            ? 1
            : (activeInGame ? playProbability(injuryTier, primaryPos, 0, false) : 0)
          remBaseMu = baseMu * remFraction * liveAvail
          expectedBonus = expBonus * remFraction * liveAvail
        }

        const pPlayBase = playProbability(injuryTier, primaryPos, weeksAhead, false)
        const pPlayAttrition = playProbability(injuryTier, primaryPos, weeksAhead, true)
        const isActualStarter = actualStarterSet.has(id)

        const neverScores =
          !isActualStarter &&
          lockedPoints <= 0 &&
          (remBaseMu <= 0.02 || (pPlayBase <= 0 && pPlayAttrition <= 0))
        if (neverScores) continue

        let rawMask = 0
        for (const p of positions) {
          const bit = POSITION_BIT[p]
          if (bit) rawMask |= bit
          else if (slots.some((slot) => playerFitsSlot(player, slot))) hasExoticActivePos = true
        }
        const effectiveMask = rawMask & slotInfo.unionMask
        if (effectiveMask === 0 && !isActualStarter && !hasExoticActivePos) continue
        if (popcount(effectiveMask) > 1) hasEffectiveMultiPos = true

        const theta = POSITIONAL_THETA[primaryPos] ?? 1.95
        const tier = remBaseMu >= 10 ? 'high' : 'low'
        const bootstrapPool = bootstrapPools.byKey[`${primaryPos}:${tier}`] ?? bootstrapPools.fallback
        idToIndex.set(id, compiledPlayers.length)
        compiledPlayers.push({
          id,
          player,
          posMask: effectiveMask,
          nflTeamIndex: getNflTeamId(nflTeam),
          state,
          lockedPoints,
          remBaseMu,
          expectedBonus,
          remFraction,
          theta2: theta * theta,
          pPlayBase,
          pPlayAttrition,
          bootstrapPool,
          projPassYd: num(projStats?.pass_yd),
          projPassCmp: num(projStats?.pass_cmp),
          projRushYd: num(projStats?.rush_yd),
          projRecYd: num(projStats?.rec_yd),
        })
      }

      if (compiledPlayers.length > maxCompiledPlayers) {
        maxCompiledPlayers = compiledPlayers.length
      }

      const hasActualStarters = isLiveCurrentWeek && rawStarters.length > 0
      const actualStarterSlotPlayers = hasActualStarters
        ? slots.map((_, slotIdx) => {
          const starterId = rawStarters[slotIdx]
          if (!starterId || starterId === '0') return -1
          return idToIndex.get(starterId) ?? -1
        })
        : []

      weekMap.set(roster.roster_id, {
        players: compiledPlayers,
        hasActualStarters,
        actualStarterSlotPlayers,
        canUseBitmaskGreedy:
          slotInfo.allStandardMasks &&
          !slotInfo.hasOverlappingPartialFlex &&
          !hasEffectiveMultiPos &&
          !hasExoticActivePos,
      })
    }

    compiledWeeks.set(week, weekMap)
  }

  const weekPairs = new Map<number, Array<[number, number]>>()
  for (let week = firstSimWeek; week <= regularEnd; week += 1) {
    const grouped = new Map<number, number[]>()
    for (const matchup of data.weeks[week]?.matchups ?? []) {
      if (matchup.matchup_id == null) continue
      const list = grouped.get(matchup.matchup_id)
      if (list) list.push(matchup.roster_id)
      else grouped.set(matchup.matchup_id, [matchup.roster_id])
    }
    const pairs: Array<[number, number]> = []
    for (const group of grouped.values()) {
      if (group.length === 2) pairs.push([group[0], group[1]])
    }
    weekPairs.set(week, pairs)
  }

  const bayesianCalibration = calibrateBayesianForm(data, compiledWeeks, slots, firstSimWeek, regularEnd)

  const baseMaxPfByRoster = new Map<number, number>()
  const baseFptsByRoster = new Map<number, number>()
  for (const roster of data.rosters) {
    baseMaxPfByRoster.set(
      roster.roster_id,
      num(roster.settings.ppts) + num(roster.settings.ppts_decimal) / 100,
    )
    baseFptsByRoster.set(
      roster.roster_id,
      num(roster.settings.fpts) + num(roster.settings.fpts_decimal) / 100,
    )
  }

  const stats = new Map(
    data.rosters.map((roster) => [
      roster.roster_id,
      {
        roster,
        name: teamName(data, roster),
        sumSimulatedMaxPf: 0,
        picks: Array(count + 1).fill(0) as number[],
        modelPicks: Object.fromEntries(
          MODELS.map((model) => [model.key, Array(count + 1).fill(0) as number[]]),
        ) as Record<ModelKey, number[]>,
      },
    ]),
  )

  const numNflTeams = Math.max(1, nflTeamToId.size)
  const nflTeamShocks = new Float64Array(numNflTeams)
  const bufLen = Math.max(maxCompiledPlayers, 1)
  const scratchScores = new Float64Array(bufLen)
  const scratchExpected = new Float64Array(bufLen)
  const scratchAvailable = new Uint8Array(bufLen)
  const scratchOrder = new Int32Array(bufLen)
  const scratchUsed = new Uint8Array(bufLen)
  const medianScratch = new Float64Array(count)

  function rollNflTeamShocks(teamCorrSd: number, rng: RandomSource): void {
    if (teamCorrSd <= 0) {
      nflTeamShocks.fill(1)
      return
    }
    const corrVar = teamCorrSd * teamCorrSd
    const shape = 1 / corrVar
    for (let t = 0; t < numNflTeams; t += 1) {
      nflTeamShocks[t] = sampleGamma(shape, rng) * corrVar
    }
  }

  function simulateRosterForWeek(
    rw: CompiledRosterWeek,
    rosterId: number,
    model: ModelConfig,
    fullIdioVarFactor: number,
    rng: RandomSource,
    computeMaxPf: boolean,
  ): { starterScore: number; maxPfScore: number } {
    const players = rw.players
    const n = players.length
    const calib = model.useBayesianForm ? bayesianCalibration.get(rosterId) : undefined
    const formScale = calib?.formMultiplier ?? 1
    const lineupEfficiency = calib?.lineupEfficiency ?? 1

    for (let i = 0; i < n; i += 1) {
      const pw = players[i]
      if (pw.state === 0) {
        scratchAvailable[i] = 0
        scratchExpected[i] = 0
        scratchScores[i] = 0
        continue
      }
      if (pw.state === 1) {
        scratchAvailable[i] = 1
        scratchExpected[i] = pw.lockedPoints
        scratchScores[i] = pw.lockedPoints
        continue
      }
      if (pw.state === 2) {
        scratchAvailable[i] = 1
        const teamMult = pw.nflTeamIndex >= 0 ? nflTeamShocks[pw.nflTeamIndex] : 1
        const inCorrVar = model.teamCorrSd * model.teamCorrSd * pw.remFraction
        const inIdioFactor = Math.max(0.45, (1 - 0.35 * inCorrVar) / (1 + inCorrVar))
        const remSim = samplePlayerRemainingPoints(
          pw,
          teamMult,
          formScale,
          model.sampler,
          milestoneWeights,
          inIdioFactor,
          rng,
        )
        scratchExpected[i] = pw.lockedPoints + (pw.remBaseMu + pw.expectedBonus) * formScale
        scratchScores[i] = pw.lockedPoints + remSim
        continue
      }

      const pPlay = model.useAttrition ? pw.pPlayAttrition : pw.pPlayBase
      const plays = pPlay >= 1 ? true : (pPlay <= 0 ? false : rng.next() < pPlay)
      if (!plays) {
        scratchAvailable[i] = 0
        scratchExpected[i] = 0
        scratchScores[i] = 0
        continue
      }

      scratchAvailable[i] = 1
      scratchExpected[i] = (pw.remBaseMu + pw.expectedBonus) * formScale
      const teamMult = pw.nflTeamIndex >= 0 ? nflTeamShocks[pw.nflTeamIndex] : 1
      scratchScores[i] = samplePlayerRemainingPoints(
        pw,
        teamMult,
        formScale,
        model.sampler,
        milestoneWeights,
        fullIdioVarFactor,
        rng,
      )
    }

    let starterScore = 0
    if (rw.hasActualStarters) {
      scratchUsed.fill(0, 0, n)
      for (const sIdx of rw.actualStarterSlotPlayers) {
        if (sIdx >= 0) scratchUsed[sIdx] = 1
      }
      for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
        const pIdx = rw.actualStarterSlotPlayers[slotIdx]
        if (pIdx >= 0) {
          const pw = players[pIdx]
          if (pw.state === 1 || pw.state === 2 || scratchAvailable[pIdx]) {
            starterScore += scratchScores[pIdx]
            continue
          }
        }
        const slotMask = SLOT_MASK[slots[slotIdx]] ?? 0
        const slotName = slots[slotIdx]
        let bestSub = -1
        let bestExp = 0
        for (let i = 0; i < n; i += 1) {
          if (
            !scratchUsed[i] &&
            players[i].state === 3 &&
            scratchAvailable[i] &&
            scratchExpected[i] > bestExp &&
            (slotMask ? (players[i].posMask & slotMask) !== 0 : playerFitsSlot(players[i].player, slotName))
          ) {
            bestExp = scratchExpected[i]
            bestSub = i
          }
        }
        if (bestSub >= 0) {
          scratchUsed[bestSub] = 1
          starterScore += scratchScores[bestSub]
        }
      }
    } else if (rw.canUseBitmaskGreedy) {
      fastBitmaskSelectStarters(players, scratchExpected, scratchOrder, scratchUsed, slotInfo.groups)
      for (let i = 0; i < n; i += 1) {
        if (scratchUsed[i]) starterScore += scratchScores[i]
      }
      starterScore *= lineupEfficiency
    } else {
      const preGameCandidates = players.map((pw, idx) => ({
        id: pw.id,
        player: pw.player,
        points: scratchExpected[idx],
      }))
      const chosen = new Set(selectOptimalLineup(preGameCandidates, slots).starterIds)
      for (let i = 0; i < n; i += 1) {
        if (chosen.has(players[i].id)) starterScore += scratchScores[i]
      }
      starterScore *= lineupEfficiency
    }

    if (!computeMaxPf) {
      return { starterScore, maxPfScore: 0 }
    }

    let maxPfScore = 0
    if (rw.canUseBitmaskGreedy) {
      maxPfScore = fastBitmaskOptimalTotal(players, scratchScores, scratchOrder, scratchUsed, slotInfo.groups)
    } else {
      const realizedCandidates = players.map((pw, idx) => ({
        id: pw.id,
        player: pw.player,
        points: scratchScores[idx],
      }))
      maxPfScore = selectOptimalLineup(realizedCandidates, slots).total
    }

    return { starterScore, maxPfScore }
  }

  const baseSeed = (Number(league.season) || 2026) * 100003 + data.currentWeek * 1009 + data.lastScoredWeek * 37

  for (const [modelIndex, model] of MODELS.entries()) {
    const rng = createRandomSource(baseSeed + modelIndex * 7919)
    const corrVar = model.teamCorrSd * model.teamCorrSd
    const fullIdioVarFactor = Math.max(0.45, (1 - 0.35 * corrVar) / (1 + corrVar))

    for (let run = 0; run < SIMULATIONS_PER_MODEL; run += 1) {
      const simulatedMaxPf = new Map<number, number>(baseMaxPfByRoster)
      const records = new Map(
        data.rosters.map((roster) => [
          roster.roster_id,
          {
            wins: num(roster.settings.wins),
            losses: num(roster.settings.losses),
            ties: num(roster.settings.ties),
            points: baseFptsByRoster.get(roster.roster_id) ?? 0,
          },
        ]),
      )

      for (let week = firstSimWeek; week <= regularEnd; week += 1) {
        const weekRosters = compiledWeeks.get(week)
        if (!weekRosters) continue

        rollNflTeamShocks(model.teamCorrSd, rng)
        const weekPoints = new Map<number, number>()

        for (let rIdx = 0; rIdx < count; rIdx += 1) {
          const roster = data.rosters[rIdx]
          const rw = weekRosters.get(roster.roster_id)
          if (!rw) {
            weekPoints.set(roster.roster_id, 0)
            medianScratch[rIdx] = 0
            continue
          }
          const { starterScore, maxPfScore } = simulateRosterForWeek(
            rw,
            roster.roster_id,
            model,
            fullIdioVarFactor,
            rng,
            true,
          )
          weekPoints.set(roster.roster_id, starterScore)
          medianScratch[rIdx] = starterScore
          simulatedMaxPf.set(
            roster.roster_id,
            (simulatedMaxPf.get(roster.roster_id) ?? 0) + maxPfScore,
          )
          records.get(roster.roster_id)!.points += starterScore
        }

        for (const [firstId, secondId] of weekPairs.get(week) ?? []) {
          const first = records.get(firstId)
          const second = records.get(secondId)
          if (!first || !second) continue
          const firstScore = weekPoints.get(firstId) ?? 0
          const secondScore = weekPoints.get(secondId) ?? 0
          if (Math.abs(firstScore - secondScore) < 0.01) {
            first.ties += 1
            second.ties += 1
          } else if (firstScore > secondScore) {
            first.wins += 1
            second.losses += 1
          } else {
            second.wins += 1
            first.losses += 1
          }
        }

        if (hasLeagueMedianMatch && count >= 2) {
          medianScratch.sort()
          const mid = count >>> 1
          const median = count % 2 === 0
            ? (medianScratch[mid - 1] + medianScratch[mid]) * 0.5
            : medianScratch[mid]
          for (let rIdx = 0; rIdx < count; rIdx += 1) {
            const rosterId = data.rosters[rIdx].roster_id
            const record = records.get(rosterId)!
            const teamPoints = weekPoints.get(rosterId) ?? 0
            if (Math.abs(teamPoints - median) < 0.005) record.ties += 1
            else if (teamPoints > median) record.wins += 1
            else record.losses += 1
          }
        }
      }

      for (const roster of data.rosters) {
        stats.get(roster.roster_id)!.sumSimulatedMaxPf += simulatedMaxPf.get(roster.roster_id) ?? 0
      }

      const seeded = [...data.rosters].sort((a, b) => {
        const first = records.get(a.roster_id)!
        const second = records.get(b.roster_id)!
        return (
          (second.wins + second.ties * 0.5) - (first.wins + first.ties * 0.5) ||
          second.points - first.points ||
          (simulatedMaxPf.get(b.roster_id) ?? 0) - (simulatedMaxPf.get(a.roster_id) ?? 0)
        )
      })

      const playoff = seeded.slice(0, playoffTeams)
      const seedRank = new Map(playoff.map((roster, idx) => [roster.roster_id, idx + 1]))

      const playoffWeekScores = new Map<number, Map<number, number>>()
      const getPlayoffScore = (rosterId: number, week: number): number => {
        let weekCache = playoffWeekScores.get(week)
        if (!weekCache) {
          weekCache = new Map<number, number>()
          playoffWeekScores.set(week, weekCache)
          rollNflTeamShocks(model.teamCorrSd, rng)
        }
        const existing = weekCache.get(rosterId)
        if (existing !== undefined) return existing
        const clampedWeek = Math.min(18, week)
        const rw = compiledWeeks.get(clampedWeek)?.get(rosterId)
        const score = rw
          ? simulateRosterForWeek(rw, rosterId, model, fullIdioVarFactor, rng, false).starterScore
          : 0
        weekCache.set(rosterId, score)
        return score
      }

      const playGame = (first: number, second: number, round: number): { winner: number; loser: number } => {
        const decided = findDecidedBracketMatch(data.winnersBracket, round, first, second)
        if (decided) return decided
        const week = playoffStart + round - 1
        const a = getPlayoffScore(first, week)
        const b = getPlayoffScore(second, week)
        if (Math.abs(a - b) < 0.01) {
          const firstBetter = (seedRank.get(first) ?? 99) < (seedRank.get(second) ?? 99)
          return firstBetter ? { winner: first, loser: second } : { winner: second, loser: first }
        }
        return a > b ? { winner: first, loser: second } : { winner: second, loser: first }
      }

      const playoffOrder: number[] = []
      const ids = playoff.map((roster) => roster.roster_id)

      if (ids.length === 6) {
        const wildOne = playGame(ids[2], ids[5], 1)
        const wildTwo = playGame(ids[3], ids[4], 1)
        let semiOneOpponent = wildTwo.winner
        let semiTwoOpponent = wildOne.winner
        if (reseedPlayoffs) {
          const winnersBySeed = [wildOne.winner, wildTwo.winner].sort(
            (a, b) => (seedRank.get(a) ?? 99) - (seedRank.get(b) ?? 99),
          )
          semiOneOpponent = winnersBySeed[1]
          semiTwoOpponent = winnersBySeed[0]
        }
        const semiOne = playGame(ids[0], semiOneOpponent, 2)
        const semiTwo = playGame(ids[1], semiTwoOpponent, 2)
        const fifth = playGame(wildOne.loser, wildTwo.loser, 2)
        const final = playGame(semiOne.winner, semiTwo.winner, 3)
        const third = playGame(semiOne.loser, semiTwo.loser, 3)
        playoffOrder.push(final.winner, final.loser, third.winner, third.loser, fifth.winner, fifth.loser)
      } else if (ids.length === 4) {
        const semiOne = playGame(ids[0], ids[3], 1)
        const semiTwo = playGame(ids[1], ids[2], 1)
        const final = playGame(semiOne.winner, semiTwo.winner, 2)
        const third = playGame(semiOne.loser, semiTwo.loser, 2)
        playoffOrder.push(final.winner, final.loser, third.winner, third.loser)
      } else if (ids.length === 8) {
        const q1 = playGame(ids[0], ids[7], 1)
        const q2 = playGame(ids[3], ids[4], 1)
        const q3 = playGame(ids[1], ids[6], 1)
        const q4 = playGame(ids[2], ids[5], 1)
        const s1 = playGame(q1.winner, q2.winner, 2)
        const s2 = playGame(q3.winner, q4.winner, 2)
        const final = playGame(s1.winner, s2.winner, 3)
        const third = playGame(s1.loser, s2.loser, 3)
        const qLosers = [q1.loser, q2.loser, q3.loser, q4.loser].sort(
          (a, b) => (simulatedMaxPf.get(b) ?? 0) - (simulatedMaxPf.get(a) ?? 0),
        )
        playoffOrder.push(final.winner, final.loser, third.winner, third.loser, ...qLosers)
      } else {
        playoffOrder.push(...ids)
      }

      playoffOrder.forEach((rosterId, index) => {
        const team = stats.get(rosterId)!
        const slot = count - index
        team.picks[slot] += 1
        team.modelPicks[model.key][slot] += 1
      })

      const playoffSet = new Set(ids)
      const eliminated = data.rosters
        .filter((roster) => !playoffSet.has(roster.roster_id))
        .sort((a, b) => (simulatedMaxPf.get(a.roster_id) ?? 0) - (simulatedMaxPf.get(b.roster_id) ?? 0))

      eliminated.forEach((roster, index) => {
        const team = stats.get(roster.roster_id)!
        const slot = index + 1
        team.picks[slot] += 1
        team.modelPicks[model.key][slot] += 1
      })
    }
  }

  const pickOwners = new Map<number, number>()
  for (const pick of data.tradedPicks) {
    if (Number(pick.season) === Number(league.season) + 1 && pick.round === 1) {
      pickOwners.set(pick.roster_id, pick.owner_id)
    }
  }

  const rawTeams = [...stats.values()].map((team) => {
    const modelProbabilities = MODELS.map((model) =>
      team.modelPicks[model.key].slice(1).map((value) => value / SIMULATIONS_PER_MODEL),
    )
    const probabilities = team.picks.slice(1).map((value) => value / TOTAL_SIMULATIONS)
    const probabilityRanges = probabilities.map((_, index) => ({
      low: Math.min(...modelProbabilities.map((model) => model[index] ?? 0)),
      high: Math.max(...modelProbabilities.map((model) => model[index] ?? 0)),
    }))
    const pickHolderId = pickOwners.get(team.roster.roster_id) ?? team.roster.roster_id
    const holder = data.rosters.find((roster) => roster.roster_id === pickHolderId)
    const wins = num(team.roster.settings.wins)
    const losses = num(team.roster.settings.losses)
    const ties = num(team.roster.settings.ties)
    return {
      roster: team.roster,
      name: team.name,
      record: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
      maxPf: team.sumSimulatedMaxPf / TOTAL_SIMULATIONS,
      currentMaxPf: baseMaxPfByRoster.get(team.roster.roster_id) ?? 0,
      pickHolder: holder ? teamName(data, holder) : `Team ${pickHolderId}`,
      pickHolderId,
      probabilities,
      probabilityRanges,
      modelNames: MODELS.map((model) => model.label),
      simulationCount: TOTAL_SIMULATIONS,
    }
  })

  return assignBijectiveDraftPicks(rawTeams, nonPlayoffCount)
    .map(({ expectedPick: _expectedPick, ...projectedPick }) => projectedPick)
    .sort((a, b) => a.pick - b.pick)
}
