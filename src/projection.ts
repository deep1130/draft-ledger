import {
  normalizeNflTeam,
  playerFitsSlot,
  selectOptimalLineup,
  starterSlotsForLeague,
  upcomingRookieSeason,
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
  expectedPick: number
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
    rosOffenseSd: 0.10,
    rosPlayerScale: 1.0,
    attritionScale: 1.0,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 1.0,
    priorWeight: 1.35,
  },
  {
    key: 'boom-bust',
    label: 'Heavy-tail boom/bust',
    sampler: 'lognormal',
    teamCorrSd: 0.22,
    rosOffenseSd: 0.12,
    rosPlayerScale: 1.15,
    attritionScale: 1.0,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 1.0,
    priorWeight: 1.05,
  },
  {
    key: 'bootstrap',
    label: 'Empirical league bootstrap',
    sampler: 'bootstrap',
    teamCorrSd: 0.16,
    rosOffenseSd: 0.09,
    rosPlayerScale: 0.90,
    attritionScale: 0.95,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 1.0,
    priorWeight: 1.15,
  },
  {
    key: 'bayesian-form',
    label: 'Bayesian form & lineup efficiency',
    sampler: 'gamma',
    teamCorrSd: 0.18,
    rosOffenseSd: 0.10,
    rosPlayerScale: 0.95,
    attritionScale: 1.0,
    useStrongBayesianForm: true,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 1.0,
    priorWeight: 1.25,
  },
  {
    key: 'attrition-15',
    label: 'Elevated injury attrition (1.5x)',
    sampler: 'gamma',
    teamCorrSd: 0.20,
    rosOffenseSd: 0.11,
    rosPlayerScale: 1.10,
    attritionScale: 1.5,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 1.0,
    priorWeight: 0.70,
  },
  {
    key: 'attrition-20',
    label: 'Severe injury shock & crisis (2.0x)',
    sampler: 'gamma',
    teamCorrSd: 0.22,
    rosOffenseSd: 0.12,
    rosPlayerScale: 1.20,
    attritionScale: 2.0,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 1.0,
    priorWeight: 0.45,
  },
  {
    key: 'shootout-stacking',
    label: 'Game-script shootout & stacking',
    sampler: 'gamma',
    teamCorrSd: 0.32,
    rosOffenseSd: 0.16,
    rosPlayerScale: 1.05,
    attritionScale: 1.0,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 1.0,
    priorWeight: 0.90,
  },
  {
    key: 'youth-breakout',
    label: 'Dynasty youth & rookie breakout',
    sampler: 'gamma',
    teamCorrSd: 0.18,
    rosOffenseSd: 0.10,
    rosPlayerScale: 1.25,
    attritionScale: 1.0,
    useStrongBayesianForm: false,
    useYouthTrajectory: true,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 1.0,
    priorWeight: 0.90,
  },
  {
    key: 'conservative-floor',
    label: 'Conservative floor & tight median',
    sampler: 'gamma',
    teamCorrSd: 0.10,
    rosOffenseSd: 0.05,
    rosPlayerScale: 0.70,
    attritionScale: 0.75,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 0.75,
    priorWeight: 0.75,
  },
  {
    key: 'rebuilder-contender',
    label: 'Dynasty rebuilder vs contender management',
    sampler: 'gamma',
    teamCorrSd: 0.18,
    rosOffenseSd: 0.10,
    rosPlayerScale: 1.05,
    attritionScale: 1.05,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: true,
    useQbDomino: false,
    dispersionScale: 1.0,
    priorWeight: 1.00,
  },
  {
    key: 'fat-tail',
    label: 'Extreme volatility & fat-tail booms',
    sampler: 'fat-tail',
    teamCorrSd: 0.25,
    rosOffenseSd: 0.14,
    rosPlayerScale: 1.30,
    attritionScale: 1.15,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: false,
    dispersionScale: 1.25,
    priorWeight: 0.60,
  },
  {
    key: 'qb-domino',
    label: 'Starting QB injury domino & cascade',
    sampler: 'gamma',
    teamCorrSd: 0.24,
    rosOffenseSd: 0.12,
    rosPlayerScale: 1.15,
    attritionScale: 1.10,
    useStrongBayesianForm: false,
    useYouthTrajectory: false,
    useRebuilderContenderEfficiency: false,
    useQbDomino: true,
    dispersionScale: 1.0,
    priorWeight: 0.90,
  },
] as const

type ModelConfig = (typeof MODELS)[number]
type ModelKey = ModelConfig['key']

const TOTAL_SIMULATIONS = SIMULATIONS_PER_MODEL * MODELS.length
const ANALYTICAL_ENGINE_PRIOR_WEIGHT = 1.15

// Position-calibrated Empirical Bayes prior pseudocounts kappa_pos = sigma_pos^2 / tau_pos^2.
const POSITIONAL_EB_PRIOR_KAPPA: Record<string, number> = {
  QB: 4.5,
  RB: 6.0,
  WR: 7.5,
  TE: 8.5,
  K: 10.0,
  DEF: 9.0,
}

// Baseline 1-PPR single-game positional dispersion theta around pre-game projections (scaled dynamically by league scoring).
const BASE_POSITIONAL_THETA: Record<string, number> = {
  QB: 1.98,
  RB: 2.14,
  WR: 2.26,
  TE: 2.22,
  K: 1.75,
  DEF: 1.95,
}

// Weekly per-game new-injury hazard by position (evolves into multi-week Markov spells across simulated weeks).
const POSITIONAL_INJURY_HAZARD: Record<string, number> = {
  QB: 0.022,
  RB: 0.046,
  WR: 0.033,
  TE: 0.036,
  K: 0.010,
  DEF: 0.0,
}

function computeLeaguePositionalTheta(scoring: Record<string, number>): Record<string, number> {
  const passYd = scoring.pass_yd ?? 0.04
  const passTd = scoring.pass_td ?? 4
  const rushYd = scoring.rush_yd ?? 0.1
  const rushTd = scoring.rush_td ?? 6
  const rec = scoring.rec ?? 1
  const recYd = scoring.rec_yd ?? 0.1
  const recTd = scoring.rec_td ?? 6
  const teBonus = scoring.bonus_rec_te ?? 0

  const qbScale = Math.max(
    0.7,
    (245 * passYd + 1.65 * passTd + 18 * rushYd + 0.15 * rushTd) / (245 * 0.04 + 1.65 * 4 + 1.8 + 0.9),
  )
  const rbScale = Math.max(
    0.7,
    (62 * rushYd + 0.5 * rushTd + 2.8 * rec + 22 * recYd + 0.12 * recTd) / (6.2 + 3.0 + 2.8 + 2.2 + 0.72),
  )
  const wrScale = Math.max(
    0.7,
    (4.8 * rec + 62 * recYd + 0.42 * recTd) / (4.8 + 6.2 + 2.52),
  )
  const teScale = Math.max(
    0.7,
    (4.2 * (rec + teBonus) + 46 * recYd + 0.35 * recTd) / (4.2 + 4.6 + 2.1),
  )

  return {
    QB: BASE_POSITIONAL_THETA.QB * Math.sqrt(qbScale),
    RB: BASE_POSITIONAL_THETA.RB * Math.sqrt(rbScale),
    WR: BASE_POSITIONAL_THETA.WR * Math.sqrt(wrScale),
    TE: BASE_POSITIONAL_THETA.TE * Math.sqrt(teScale),
    K: BASE_POSITIONAL_THETA.K,
    DEF: BASE_POSITIONAL_THETA.DEF,
  }
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

const LANCZOS_COEFFS = [
  676.5203681218851,
  -1259.1392167224028,
  771.3234287776531,
  -176.6150291621406,
  12.507343278686905,
  -0.13857109526572012,
  9.984369578019572e-6,
  1.5056327351493116e-7,
]

function logGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  }
  const zm1 = z - 1
  let x = 0.9999999999998099
  for (let i = 0; i < LANCZOS_COEFFS.length; i += 1) {
    x += LANCZOS_COEFFS[i] / (zm1 + i + 1)
  }
  const t = zm1 + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x)
}

/**
 * Exact regularized upper incomplete Gamma integral:
 * P(X >= threshold) = 1 - gamma(k, threshold / theta) / Gamma(k)
 * where k = (mean / sd)^2 and theta = sd^2 / mean.
 */
function tailProbGamma(threshold: number, mean: number, sd: number): number {
  if (threshold <= 0) return 1
  if (mean <= 0 || sd <= 0) return mean >= threshold ? 1 : 0
  const k = (mean * mean) / (sd * sd)
  const theta = (sd * sd) / mean
  const x = threshold / theta
  if (x <= 0) return 1

  const lgk = logGamma(k)
  if (x < k + 1) {
    // Series representation for lower incomplete gamma P(k, x), then return 1 - P(k, x).
    let ap = k
    let term = 1 / k
    let sum = term
    for (let iter = 0; iter < 64; iter += 1) {
      ap += 1
      term *= x / ap
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break
    }
    const logPrefactor = -x + k * Math.log(x) - lgk
    if (logPrefactor < -700) return 1
    const pLower = Math.min(1, Math.max(0, sum * Math.exp(logPrefactor)))
    return Math.max(0, 1 - pLower)
  }

  // Modified Lentz continued fraction for upper incomplete gamma Q(k, x).
  const tiny = 1e-30
  let b = x + 1 - k
  let c = 1 / tiny
  let d = 1 / (Math.abs(b) < tiny ? tiny : b)
  let h = d
  for (let i = 1; i <= 64; i += 1) {
    const an = -i * (i - k)
    b += 2
    d = an * d + b
    if (Math.abs(d) < tiny) d = tiny
    c = b + an / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  const logPrefactor = -x + k * Math.log(x) - lgk
  if (logPrefactor < -700) return 0
  return Math.min(1, Math.max(0, h * Math.exp(logPrefactor)))
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
    const p200 = tailProbGamma(200, recYd, sd)
    const p100 = Math.max(0, tailProbGamma(100, recYd, sd) - p200)
    expected += p100 * num(scoring.bonus_rec_yd_100) + p200 * num(scoring.bonus_rec_yd_200)
  }
  if (rushYd > 15 && (scoring.bonus_rush_yd_100 || scoring.bonus_rush_yd_200)) {
    const sd = Math.max(12, 0.46 * rushYd + 10)
    const p200 = tailProbGamma(200, rushYd, sd)
    const p100 = Math.max(0, tailProbGamma(100, rushYd, sd) - p200)
    expected += p100 * num(scoring.bonus_rush_yd_100) + p200 * num(scoring.bonus_rush_yd_200)
  }
  const combinedYd = rushYd + recYd
  if (combinedYd > 20 && (scoring.bonus_rush_rec_yd_100 || scoring.bonus_rush_rec_yd_200)) {
    const sd = Math.max(14, 0.44 * combinedYd + 12)
    const p200 = tailProbGamma(200, combinedYd, sd)
    const p100 = Math.max(0, tailProbGamma(100, combinedYd, sd) - p200)
    expected += p100 * num(scoring.bonus_rush_rec_yd_100) + p200 * num(scoring.bonus_rush_rec_yd_200)
  }
  if (passYd > 80 && (scoring.bonus_pass_yd_300 || scoring.bonus_pass_yd_400)) {
    const sd = Math.max(35, 0.27 * passYd + 18)
    const p400 = tailProbGamma(400, passYd, sd)
    const p300 = Math.max(0, tailProbGamma(300, passYd, sd) - p400)
    expected += p300 * num(scoring.bonus_pass_yd_300) + p400 * num(scoring.bonus_pass_yd_400)
  }
  if (passCmp > 8 && scoring.bonus_pass_cmp_25) {
    const sd = Math.max(3.5, 0.24 * passCmp + 1.5)
    expected += tailProbGamma(25, passCmp, sd) * num(scoring.bonus_pass_cmp_25)
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

function liveInGamePlayProbability(tier: InjuryTier): number {
  switch (tier) {
    case 'ir':
    case 'out':
      return 0
    case 'doubtful':
      return 0.20
    case 'questionable':
      return 0.78
    case 'probable':
      return 0.94
    case 'healthy':
      return 1
  }
}

function drawInitialWeeksOut(
  tier: InjuryTier,
  activeGameCount: number,
  lastScoredWeek: number,
  injuredInLiveGame: boolean,
  rng: RandomSource,
): number {
  switch (tier) {
    case 'healthy':
      return 0
    case 'probable':
      if (injuredInLiveGame) return rng.next() < 0.05 ? 2 : 0
      return rng.next() < 0.06 ? 1 : 0
    case 'questionable': {
      if (injuredInLiveGame) return rng.next() < 0.16 ? 2 : 0
      if (rng.next() >= 0.22) return 0
      const u = rng.next()
      return u < 0.68 ? 1 : (u < 0.90 ? 2 : 3)
    }
    case 'doubtful': {
      if (rng.next() < 0.20 && !injuredInLiveGame) return 0
      const u = rng.next()
      const spell = u < 0.50 ? 1 : (u < 0.80 ? 2 + (rng.nextU32() & 1) : 4 + (rng.nextU32() % 3))
      return injuredInLiveGame ? spell + 1 : spell
    }
    case 'out': {
      const u = rng.next()
      const spell = u < 0.44
        ? 1
        : (u < 0.72 ? 2 : (u < 0.88 ? 3 + (rng.nextU32() & 1) : 5 + (rng.nextU32() % 4)))
      if (injuredInLiveGame) {
        return rng.next() < 0.60 ? spell + 1 : 1
      }
      return spell
    }
    case 'ir': {
      const u = rng.next()
      if (activeGameCount === 0 && lastScoredWeek >= 4) {
        return u < 0.48 ? 14 : (u < 0.78 ? 3 + (rng.nextU32() % 3) : 2)
      }
      const spell = u < 0.26
        ? 14
        : (u < 0.60 ? 3 + (rng.nextU32() % 3) : (u < 0.85 ? 2 : 1))
      return injuredInLiveGame ? spell + 1 : spell
    }
  }
}

function drawNewInjuryWeeks(rng: RandomSource): number {
  const u = rng.next()
  if (u < 0.48) return 1
  if (u < 0.78) return 2 + (rng.nextU32() & 1)
  return 4 + (rng.nextU32() % 5)
}

interface GlobalPlayerProfile {
  id: string
  injuryTier: InjuryTier
  injuryHazardBase: number
  activeGameCount: number
  injuredInLiveGame: boolean
  survivedLivePostHealthy: boolean
  byeWeekMask: number
  rosUncertSd: number
  ebStandardMult: number
  ebStrongFormMult: number
  youthTrajectoryMult: number
  primaryPos: string
  nflTeam: string | undefined
  calibratedMu: number
}

function buildGlobalPlayerProfiles(
  data: LeagueData,
  positionalTheta: Record<string, number>,
  scoring: Record<string, number>,
  hasMilestoneBonuses: boolean,
  firstSimWeek: number,
  regularEnd: number,
): { profiles: GlobalPlayerProfile[]; idToGlobalIndex: Map<string, number> } {
  const idToGlobalIndex = new Map<string, number>()
  const profiles: GlobalPlayerProfile[] = []

  const isLiveCurrentWeek = data.currentWeek > data.lastScoredWeek
  const liveFeed = isLiveCurrentWeek ? data.weeks[data.currentWeek] : undefined
  const liveByeSet = new Set(liveFeed?.byes ?? [])
  const livePointsByPlayer = new Map<string, number>()
  if (liveFeed) {
    for (const m of liveFeed.matchups) {
      for (const [pid, pts] of Object.entries(m.players_points ?? {})) {
        if (typeof pts === 'number' && Number.isFinite(pts)) {
          livePointsByPlayer.set(pid, pts)
        }
      }
    }
  }

  const byeMaskByNflTeam = new Map<string, number>()
  for (let w = firstSimWeek; w <= regularEnd; w += 1) {
    for (const abbr of data.weeks[w]?.byes ?? []) {
      const norm = normalizeNflTeam(abbr)
      if (norm) byeMaskByNflTeam.set(norm, (byeMaskByNflTeam.get(norm) ?? 0) | (1 << w))
    }
  }

  const allRosterPlayerIds = new Set<string>()
  for (const roster of data.rosters) {
    for (const id of roster.players ?? []) allRosterPlayerIds.add(id)
  }
  if (liveFeed) {
    for (const m of liveFeed.matchups) {
      for (const id of m.players ?? []) allRosterPlayerIds.add(id)
    }
  }

  const futureProjWeeks: number[] = []
  for (let w = Math.max(firstSimWeek, data.currentWeek + 1); w <= regularEnd; w += 1) {
    if (data.weeks[w]) futureProjWeeks.push(w)
  }

  for (const id of allRosterPlayerIds) {
    const player = data.players[id]
    const nflTeam = normalizeNflTeam(player?.team)
    const positions = player?.fantasy_positions?.length
      ? player.fantasy_positions
      : (player?.position ? [player.position] : [])
    const primaryPos = player?.position ?? positions[0] ?? 'WR'
    const injuryTier = classifyInjury(player)

    const histScores = data.historicalPlayerPoints[id] ?? []
    const histWeeks = data.historicalPlayerWeeks?.[id] ?? []
    const liveRawState = nflTeam && liveFeed ? liveFeed.gameStates[nflTeam] : undefined
    const liveOnBye = Boolean(nflTeam && liveByeSet.has(nflTeam))
    const livePts = livePointsByPlayer.get(id) ?? 0

    const includeLivePost = isLiveCurrentWeek && !liveOnBye && liveRawState === 'post'
    const observedScores = includeLivePost ? [...histScores, livePts] : histScores
    const observedWeeks = includeLivePost
      ? [...histWeeks, data.currentWeek]
      : (histWeeks.length === histScores.length ? histWeeks : histScores.map((_, idx) => idx + 1))

    const activeScores: number[] = []
    const activeWeeks: number[] = []
    for (let j = 0; j < observedScores.length; j += 1) {
      if (observedScores[j] > 0.5) {
        activeScores.push(observedScores[j])
        activeWeeks.push(observedWeeks[j] ?? (j + 1))
      }
    }
    const activeGameCount = activeScores.length

    const injuredInLiveGame =
      isLiveCurrentWeek &&
      !liveOnBye &&
      (liveRawState === 'post' || liveRawState === 'in') &&
      livePts > 0 &&
      (injuryTier === 'out' || injuryTier === 'ir' || injuryTier === 'doubtful' || injuryTier === 'questionable')

    const survivedLivePostHealthy =
      isLiveCurrentWeek && !liveOnBye && liveRawState === 'post' && injuryTier === 'healthy'

    // Calculate future average non-bye Sleeper projection.
    let futureProjSum = 0
    let futureProjCount = 0
    for (const w of futureProjWeeks) {
      const feed = data.weeks[w]
      if (!feed) continue
      if (nflTeam && feed.byes.includes(nflTeam)) continue
      const pStats = feed.projections[id]
      const mu =
        baseProjectionScore(pStats, scoring) +
        (hasMilestoneBonuses ? expectedMilestoneBonus(pStats, scoring) : 0)
      if (mu > 0.5) {
        futureProjSum += mu
        futureProjCount += 1
      }
    }
    const meanFutureProj = futureProjCount > 0 ? futureProjSum / futureProjCount : 0

    // Guard against boosting healthy players who recently lost their role (3 straight recorded <=0.5 weeks guarantees >=2 non-bye DNPs).
    const recentHealthyBenched =
      injuryTier === 'healthy' &&
      observedScores.length >= 3 &&
      observedScores[observedScores.length - 1] <= 0.5 &&
      observedScores[observedScores.length - 2] <= 0.5 &&
      observedScores[observedScores.length - 3] <= 0.5

    let ebStandardMult = 1
    let ebStrongFormMult = 1
    let recencyActiveMean = meanFutureProj

    if (activeGameCount >= 2 && meanFutureProj > 0.8) {
      const sortedActive = [...activeScores].sort((a, b) => a - b)
      const mid = sortedActive.length >>> 1
      const medianActive =
        sortedActive.length % 2 === 0
          ? (sortedActive[mid - 1] + sortedActive[mid]) * 0.5
          : sortedActive[mid]
      const theta = positionalTheta[primaryPos] ?? 2.15
      const winCap = medianActive + 2.1 * theta * Math.sqrt(Math.max(medianActive, 4))

      const refWeek = includeLivePost ? data.currentWeek : Math.max(1, data.lastScoredWeek)
      let wSum = 0
      let wSqSum = 0
      let valSum = 0
      for (let j = 0; j < activeGameCount; j += 1) {
        const weeksAgo = Math.max(0, refWeek - activeWeeks[j])
        // Exponential calendar-week recency weight with 4.5-week half-life.
        const w = Math.pow(0.5, weeksAgo / 4.5)
        wSum += w
        wSqSum += w * w
        valSum += w * Math.min(activeScores[j], winCap)
      }
      recencyActiveMean = wSum > 0 ? valSum / wSum : meanFutureProj

      if (!recentHealthyBenched || recencyActiveMean < meanFutureProj) {
        const maxUp = meanFutureProj >= 2.0 ? 2.65 : 1.75
        const maxUpStrong = meanFutureProj >= 2.0 ? 3.00 : 1.95
        // Kish's effective sample size n_eff = (sum w)^2 / sum(w^2) paired with position-calibrated kappa_pos = sigma_pos^2 / tau_pos^2.
        const nEff = wSqSum > 0 ? (wSum * wSum) / wSqSum : activeGameCount
        const kappaPos = POSITIONAL_EB_PRIOR_KAPPA[primaryPos] ?? 7.0
        const alphaStd = nEff / (nEff + kappaPos)
        const alphaStrong = nEff / (nEff + 0.5 * kappaPos)
        const blendedStd = (1 - alphaStd) * meanFutureProj + alphaStd * recencyActiveMean
        const blendedStrong = (1 - alphaStrong) * meanFutureProj + alphaStrong * recencyActiveMean
        ebStandardMult = Math.max(0.58, Math.min(maxUp, blendedStd / meanFutureProj))
        ebStrongFormMult = Math.max(0.50, Math.min(maxUpStrong, blendedStrong / meanFutureProj))
      }
    }

    const calibratedMu = meanFutureProj * ebStandardMult
    let rosUncertSd = 0.32
    if (primaryPos === 'QB' && calibratedMu >= 15 && activeGameCount >= 4) {
      rosUncertSd = 0.14
    } else if (calibratedMu >= 11 && activeGameCount >= 4) {
      rosUncertSd = 0.18
    } else if (calibratedMu >= 5 && activeGameCount >= 2) {
      rosUncertSd = 0.24
    }

    const baseHazard = POSITIONAL_INJURY_HAZARD[primaryPos] ?? 0.032
    const fragileMult = injuryTier === 'healthy' ? 1.0 : 1.25

    const exp = typeof player?.years_exp === 'number' && Number.isFinite(player.years_exp) ? player.years_exp : null
    const age = typeof player?.age === 'number' && Number.isFinite(player.age) ? player.age : null
    let youthTrajectoryMult = 1.0
    if (exp === 0 || (exp === null && age !== null && age <= 22)) {
      youthTrajectoryMult = 1.12
    } else if (exp === 1 || (exp === null && age !== null && age === 23)) {
      youthTrajectoryMult = 1.06
    } else if ((exp !== null && exp >= 7) || (age !== null && age >= 30)) {
      youthTrajectoryMult = 0.94
    }

    idToGlobalIndex.set(id, profiles.length)
    profiles.push({
      id,
      injuryTier,
      injuryHazardBase: baseHazard * fragileMult,
      activeGameCount,
      injuredInLiveGame,
      survivedLivePostHealthy,
      byeWeekMask: nflTeam ? (byeMaskByNflTeam.get(nflTeam) ?? 0) : 0,
      rosUncertSd,
      ebStandardMult,
      ebStrongFormMult,
      youthTrajectoryMult,
      primaryPos,
      nflTeam,
      calibratedMu,
    })
  }

  return { profiles, idToGlobalIndex }
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
  globalPlayerIndex: number
  player: SleeperPlayer | undefined
  posMask: number
  nflTeamIndex: number
  state: GameStateCode
  lockedPoints: number
  remBaseMu: number
  expectedBonus: number
  remFraction: number
  theta2: number
  stdScale: number
  strongFormScale: number
  youthScale: number
  rosWeight: number
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
  corrVar: number,
  dispersionScale: number,
  rng: RandomSource,
): number {
  const mu = pw.remBaseMu * formScale
  if (mu <= 0.02) return 0

  // Law of Total Variance: Var(G * T) = (1 + corrVar) * mu * scale + corrVar * mu^2 = theta^2 * dispersionScale * mu.
  const targetVarPerMu = pw.theta2 * dispersionScale
  const scale = Math.max(0.35 * targetVarPerMu, targetVarPerMu - corrVar * mu) / (1 + corrVar)

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
  } else if (sampler === 'fat-tail') {
    const u = rng.next()
    if (u < 0.05 && pw.state === 3) {
      multiplier = teamMult * (0.05 + 0.20 * rng.next())
    } else if (u > 0.94 && pw.state === 3) {
      const boom = 2.8 + Math.pow(Math.max(rng.next(), 0.001), -0.32) - 1
      multiplier = teamMult * Math.min(5.5, boom)
    } else {
      const shape = mu / scale
      const idioSample = sampleGamma(shape, rng) * scale
      // 0.896835 exactly balances the 5% bust (E=0.15) and 6% Pareto boom (E=3.23862) branches so E[multiplier] = 1.0000.
      const meanPreserveMult = pw.state === 3 ? 0.896835 : 1.0
      multiplier = (idioSample / mu) * teamMult * meanPreserveMult
    }
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

  // Decouple yardage multiplier from pure-TD fantasy point spikes while preserving E[yardMult] = formScale.
  const yardNoise = Math.max(0.25, 1 + 0.18 * rng.normal())
  const yardMult = Math.max(0, 0.74 * multiplier + 0.26 * yardNoise) * formScale
  const bonus = milestoneBonusFromYards(
    pw.projPassYd * yardMult,
    pw.projPassCmp * yardMult,
    pw.projRushYd * yardMult,
    pw.projRecYd * yardMult,
    milestoneWeights,
  )
  return baseSimulated + bonus
}

function calibrateLineupEfficiency(data: LeagueData): Map<number, number> {
  const result = new Map<number, number>()
  const completedWeeks = data.lastScoredWeek

  for (const roster of data.rosters) {
    const scoreHist = data.historicalTeamScores[roster.roster_id] ?? []
    const maxPfHist = data.historicalMaxPf[roster.roster_id] ?? []
    if (completedWeeks < 2 || scoreHist.length < 2) {
      result.set(roster.roster_id, 1)
      continue
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

    result.set(roster.roster_id, lineupEfficiency)
  }

  return result
}

function calibrateRebuilderContenderEfficiency(
  data: LeagueData,
  baseFptsByRoster: Map<number, number>,
): Map<number, number> {
  const result = new Map<number, number>()
  const count = data.rosters.length
  if (count === 0) return result

  const ranked = [...data.rosters].sort((a, b) => {
    const aWins = (a.settings.wins ?? 0) + (a.settings.ties ?? 0) * 0.5
    const bWins = (b.settings.wins ?? 0) + (b.settings.ties ?? 0) * 0.5
    const aPts = baseFptsByRoster.get(a.roster_id) ?? 0
    const bPts = baseFptsByRoster.get(b.roster_id) ?? 0
    return bWins - aWins || bPts - aPts
  })

  const contenderCutoff = Math.floor(count * 0.45)
  const rebuilderCutoff = Math.ceil(count * 0.55)

  for (let rank = 0; rank < count; rank += 1) {
    const rosterId = ranked[rank].roster_id
    if (rank < contenderCutoff) {
      result.set(rosterId, 1.02)
    } else if (rank >= rebuilderCutoff) {
      result.set(rosterId, 0.90)
    } else {
      result.set(rosterId, 0.96)
    }
  }

  return result
}

function teamName(data: LeagueData, roster: SleeperRoster): string {
  const user = data.users.find((item) => item.user_id === roster.owner_id)
  return user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`
}

function normalCdf(x: number): number {
  const a1 =  0.254829592
  const a2 = -0.284496736
  const a3 =  1.421413741
  const a4 = -1.453152027
  const a5 =  1.061405429
  const p  =  0.3275911

  const sign = x < 0 ? -1 : 1
  const absX = Math.abs(x) / Math.SQRT2
  const t = 1.0 / (1.0 + p * absX)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX)
  return 0.5 * (1.0 + sign * y)
}

function convolvePoissonBinomial(probs: number[]): Float64Array {
  let dist = new Float64Array([1])
  for (const p of probs) {
    const next = new Float64Array(dist.length + 1)
    const q = 1 - p
    for (let k = 0; k < dist.length; k += 1) {
      next[k] += dist[k] * q
      next[k + 1] += dist[k] * p
    }
    dist = next
  }
  return dist
}

function convolveDiscreteDistributions(dists: readonly Float64Array[]): Float64Array {
  let res = new Float64Array([1])
  for (const d of dists) {
    if (d.length === 0) continue
    const next = new Float64Array(res.length + d.length - 1)
    for (let i = 0; i < res.length; i += 1) {
      if (res[i] === 0) continue
      for (let j = 0; j < d.length; j += 1) {
        next[i + j] += res[i] * d[j]
      }
    }
    res = next
  }
  return res
}

function makeDoublyStochastic(matrix: number[][], maxIter = 50): number[][] {
  const n = matrix.length
  if (n <= 1) return matrix
  let res = matrix.map((row) => [...row])
  for (let iter = 0; iter < maxIter; iter += 1) {
    for (let r = 0; r < n; r += 1) {
      const sum = res[r].reduce((a, b) => a + b, 0)
      if (sum > 0) {
        for (let c = 0; c < n; c += 1) res[r][c] /= sum
      }
    }
    for (let c = 0; c < n; c += 1) {
      let sum = 0
      for (let r = 0; r < n; r += 1) sum += res[r][c]
      if (sum > 0) {
        for (let r = 0; r < n; r += 1) res[r][c] /= sum
      }
    }
  }
  for (let r = 0; r < n; r += 1) {
    const sum = res[r].reduce((a, b) => a + b, 0)
    if (sum > 0) {
      for (let c = 0; c < n; c += 1) res[r][c] /= sum
    }
  }
  return res
}

const GAUSS_HERMITE_Z = [-2.8569700138728056, -1.3556261799742659, 0, 1.3556261799742659, 2.8569700138728056]
const GAUSS_HERMITE_W = [0.011257411327720689, 0.2220759220056126, 0.5333333333333333, 0.2220759220056126, 0.011257411327720689]

function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)
}

function computeAnalyticalProbabilities(
  data: LeagueData,
  compiledWeeks: Map<number, Map<number, CompiledRosterWeek>>,
  weekPairs: Map<number, Array<[number, number]>>,
  firstSimWeek: number,
  regularEnd: number,
  baseFptsByRoster: Map<number, number>,
  baseMaxPfByRoster: Map<number, number>,
  slots: readonly string[],
  slotInfo: ReturnType<typeof compileSlotGroups>,
  globalProfiles: readonly GlobalPlayerProfile[],
  count: number,
  nonPlayoffCount: number,
  hasLeagueMedianMatch: boolean,
): Map<number, number[]> {
  const result = new Map<number, number[]>()
  for (const r of data.rosters) {
    result.set(r.roster_id, new Array(count).fill(0))
  }
  if (count <= 1) return result

  const baseWins = new Map<number, number>()
  const totalStarterMu = new Map<number, number>()
  const totalStarterVar = new Map<number, number>()
  const totalMaxPfMu = new Map<number, number>()
  const totalMaxPfVar = new Map<number, number>()
  const weeklyWinDistsByRoster = new Map<number, Float64Array[]>()

  for (const r of data.rosters) {
    baseWins.set(r.roster_id, num(r.settings.wins) + num(r.settings.ties) * 0.5)
    totalStarterMu.set(r.roster_id, baseFptsByRoster.get(r.roster_id) ?? 0)
    totalStarterVar.set(r.roster_id, 0)
    totalMaxPfMu.set(r.roster_id, baseMaxPfByRoster.get(r.roster_id) ?? 0)
    totalMaxPfVar.set(r.roster_id, 0)
    weeklyWinDistsByRoster.set(r.roster_id, [])
  }

  const teamCorrVar = 0.18 * 0.18

  for (let week = firstSimWeek; week <= regularEnd; week += 1) {
    const weekRosters = compiledWeeks.get(week)
    if (!weekRosters) continue
    const weeksAhead = Math.max(0, week - data.currentWeek)

    const weekStarterMu = new Map<number, number>()
    const weekStarterSd = new Map<number, number>()
    const teamRemSumByRoster = new Map<number, Map<number, number>>()

    for (const r of data.rosters) {
      const rw = weekRosters.get(r.roster_id)
      if (!rw || rw.players.length === 0) {
        weekStarterMu.set(r.roster_id, 0)
        weekStarterSd.set(r.roster_id, 10)
        continue
      }

      const players = rw.players
      const n = players.length
      const pMu = new Float64Array(n)
      const pRemMu = new Float64Array(n)
      const pVar = new Float64Array(n)

      for (let i = 0; i < n; i += 1) {
        const pw = players[i]
        if (pw.state === 0) continue
        if (pw.state === 1) {
          pMu[i] = pw.lockedPoints
          continue
        }
        if (pw.state === 2) {
          const rem = pw.remBaseMu + pw.expectedBonus
          pMu[i] = pw.lockedPoints + rem
          pRemMu[i] = rem
          pVar[i] = pw.remBaseMu * pw.theta2
          continue
        }

        const prof = pw.globalPlayerIndex >= 0 ? globalProfiles[pw.globalPlayerIndex] : undefined
        const p0 = prof ? liveInGamePlayProbability(prof.injuryTier) : 1
        const lambda = prof?.injuryHazardBase ?? 0.032
        const muRec = prof?.injuryTier === 'ir' ? 0.18 : 0.44
        const pInf = muRec / (lambda + muRec)
        const rhoMarkov = Math.max(0, 1 - lambda - muRec)
        const pAvail = weeksAhead === 0 ? p0 : pInf + (p0 - pInf) * Math.pow(rhoMarkov, weeksAhead)

        const activeMu = (pw.remBaseMu + pw.expectedBonus) * pw.stdScale
        const activeVar = (pw.remBaseMu * pw.stdScale) * pw.theta2
        pMu[i] = pAvail * activeMu
        pRemMu[i] = pMu[i]
        // Law of Total Variance for zero-inflated Gamma: E[Var(X|I)] + Var(E[X|I]).
        pVar[i] = pAvail * activeVar + pAvail * (1 - pAvail) * activeMu * activeMu
      }

      const isStarter = new Uint8Array(n)
      if (rw.hasActualStarters) {
        for (const sIdx of rw.actualStarterSlotPlayers) {
          if (sIdx >= 0) isStarter[sIdx] = 1
        }
        for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
          const pIdx = rw.actualStarterSlotPlayers[slotIdx]
          if (pIdx >= 0 && pMu[pIdx] > 0.05) continue
          const slotMask = SLOT_MASK[slots[slotIdx]] ?? 0
          const slotName = slots[slotIdx]
          let bestSub = -1
          let bestExp = 0
          for (let i = 0; i < n; i += 1) {
            if (
              !isStarter[i] &&
              players[i].state === 3 &&
              pMu[i] > bestExp &&
              (slotMask ? (players[i].posMask & slotMask) !== 0 : playerFitsSlot(players[i].player, slotName))
            ) {
              bestExp = pMu[i]
              bestSub = i
            }
          }
          if (bestSub >= 0) {
            if (pIdx >= 0) isStarter[pIdx] = 0
            isStarter[bestSub] = 1
          }
        }
      } else if (rw.canUseBitmaskGreedy) {
        const orderScratch = new Int32Array(n)
        fastBitmaskSelectStarters(players, pMu, orderScratch, isStarter, slotInfo.groups)
      } else {
        const candidates = players.map((pw, idx) => ({
          id: pw.id,
          player: pw.player,
          points: pMu[idx],
        }))
        const chosen = new Set(selectOptimalLineup(candidates, slots).starterIds)
        for (let i = 0; i < n; i += 1) {
          if (chosen.has(players[i].id)) isStarter[i] = 1
        }
      }

      let sMu = 0
      let sVar = 0
      const teamRemSum = new Map<number, number>()
      const teamRemSqSum = new Map<number, number>()
      const starterIndices: number[] = []

      for (let i = 0; i < n; i += 1) {
        if (!isStarter[i]) continue
        starterIndices.push(i)
        sMu += pMu[i]
        sVar += pVar[i]
        const tIdx = players[i].nflTeamIndex
        if (tIdx >= 0 && pRemMu[i] > 0) {
          teamRemSum.set(tIdx, (teamRemSum.get(tIdx) ?? 0) + pRemMu[i])
          teamRemSqSum.set(tIdx, (teamRemSqSum.get(tIdx) ?? 0) + pRemMu[i] * pRemMu[i])
        }
      }

      // Add bilinear offensive stack covariance: sum_{i != j in same NFL team} tau^2 * mu_i * mu_j.
      for (const [tIdx, sumRem] of teamRemSum.entries()) {
        const sqSum = teamRemSqSum.get(tIdx) ?? 0
        sVar += teamCorrVar * Math.max(0, sumRem * sumRem - sqSum)
      }

      // Compute position-aware analytical Max PF option surplus over starters using Clark's Gaussian max formula.
      let mMu = sMu
      let mVar = sVar
      const benchIndices: number[] = []
      for (let i = 0; i < n; i += 1) {
        if (!isStarter[i] && pMu[i] > 0.5) benchIndices.push(i)
      }
      benchIndices.sort((a, b) => pMu[b] - pMu[a])

      for (let bRank = 0; bRank < benchIndices.length; bRank += 1) {
        const bIdx = benchIndices[bRank]
        const bMask = players[bIdx].posMask
        let minStarterIdx = -1
        let minStarterMu = Infinity
        for (const sIdx of starterIndices) {
          const sharesEligibility =
            (bMask & players[sIdx].posMask) !== 0 ||
            ((bMask & (2 | 4 | 8)) !== 0 && (players[sIdx].posMask & (2 | 4 | 8)) !== 0)
          if (sharesEligibility && pMu[sIdx] < minStarterMu) {
            minStarterMu = pMu[sIdx]
            minStarterIdx = sIdx
          }
        }
        if (minStarterIdx >= 0) {
          const delta = pMu[bIdx] - minStarterMu
          const sdDiff = Math.sqrt(Math.max(4, pVar[bIdx] + pVar[minStarterIdx]))
          const z = delta / sdDiff
          const optionGain = delta * normalCdf(z) + sdDiff * normalPdf(z)
          const attenuation = 0.55 / (1 + 0.38 * bRank)
          mMu += optionGain * attenuation
          mVar += pVar[bIdx] * normalCdf(z) * attenuation * 0.45
        }
      }

      weekStarterMu.set(r.roster_id, sMu)
      weekStarterSd.set(r.roster_id, Math.sqrt(Math.max(1, sVar)))
      teamRemSumByRoster.set(r.roster_id, teamRemSum)

      totalStarterMu.set(r.roster_id, (totalStarterMu.get(r.roster_id) ?? 0) + sMu)
      totalStarterVar.set(r.roster_id, (totalStarterVar.get(r.roster_id) ?? 0) + sVar)
      totalMaxPfMu.set(r.roster_id, (totalMaxPfMu.get(r.roster_id) ?? 0) + mMu)
      totalMaxPfVar.set(r.roster_id, (totalMaxPfVar.get(r.roster_id) ?? 0) + mVar)
    }

    let medMu = 0
    let medVar = 14 * 14
    if (hasLeagueMedianMatch && count >= 2) {
      const allMeans = [...weekStarterMu.values()].sort((a, b) => a - b)
      const mid = count >>> 1
      medMu = count % 2 === 0 ? (allMeans[mid - 1] + allMeans[mid]) * 0.5 : allMeans[mid]
      const avgVar = [...weekStarterSd.values()].reduce((acc, s) => acc + s * s, 0) / count
      // Order-statistic variance of sample median for N teams: pi / (2N) * sigma^2.
      medVar = (Math.PI / (2 * count)) * avgVar
    }

    const processedRosters = new Set<number>()

    for (const [firstId, secondId] of weekPairs.get(week) ?? []) {
      processedRosters.add(firstId)
      processedRosters.add(secondId)

      const mu1 = weekStarterMu.get(firstId) ?? 0
      const sd1 = weekStarterSd.get(firstId) ?? 15
      const mu2 = weekStarterMu.get(secondId) ?? 0
      const sd2 = weekStarterSd.get(secondId) ?? 15

      // Cross-roster matchup covariance from shared NFL team players: -2Cov(S_A, S_B)
      let cov12 = 0
      const rem1 = teamRemSumByRoster.get(firstId)
      const rem2 = teamRemSumByRoster.get(secondId)
      if (rem1 && rem2) {
        for (const [tIdx, s1] of rem1.entries()) {
          const s2 = rem2.get(tIdx)
          if (s2) cov12 += teamCorrVar * s1 * s2
        }
      }

      const diffVar = Math.max(1, sd1 * sd1 + sd2 * sd2 - 2 * cov12)
      const diffSd = Math.sqrt(diffVar)

      if (hasLeagueMedianMatch && count >= 2) {
        // Exact trinomial joint distribution over {0, 1, 2} wins integrating over team's score s_q:
        // P(s > S_opp) and P(s > M) are conditionally independent given s.
        let p2_1 = 0
        let p0_1 = 0
        const condSd2_given1 = Math.max(1, Math.sqrt(Math.max(1, sd2 * sd2 - (cov12 * cov12) / (sd1 * sd1))))
        const condSdMed_given1 = Math.max(1, Math.sqrt(Math.max(1, medVar - (sd1 * sd1) / (count * count))))

        for (let q = 0; q < GAUSS_HERMITE_Z.length; q += 1) {
          const wQ = GAUSS_HERMITE_W[q]
          const zQ = GAUSS_HERMITE_Z[q]
          const s1 = mu1 + sd1 * zQ
          const condMu2 = mu2 + (cov12 / (sd1 * sd1)) * (s1 - mu1)
          const condMuMed = medMu + (1 / count) * (s1 - mu1)

          const pBeat2 = normalCdf((s1 - condMu2) / condSd2_given1)
          const pBeatMed = normalCdf((s1 - condMuMed) / condSdMed_given1)

          p2_1 += wQ * (pBeat2 * pBeatMed)
          p0_1 += wQ * ((1 - pBeat2) * (1 - pBeatMed))
        }
        let p1_1 = Math.max(0, 1 - p2_1 - p0_1)
        const sum1 = p0_1 + p1_1 + p2_1
        if (sum1 > 0) {
          p0_1 /= sum1
          p1_1 /= sum1
          p2_1 /= sum1
        }
        weeklyWinDistsByRoster.get(firstId)?.push(new Float64Array([p0_1, p1_1, p2_1]))

        // Symmetrically for second team
        let p2_2 = 0
        let p0_2 = 0
        const condSd1_given2 = Math.max(1, Math.sqrt(Math.max(1, sd1 * sd1 - (cov12 * cov12) / (sd2 * sd2))))
        const condSdMed_given2 = Math.max(1, Math.sqrt(Math.max(1, medVar - (sd2 * sd2) / (count * count))))

        for (let q = 0; q < GAUSS_HERMITE_Z.length; q += 1) {
          const wQ = GAUSS_HERMITE_W[q]
          const zQ = GAUSS_HERMITE_Z[q]
          const s2 = mu2 + sd2 * zQ
          const condMu1 = mu1 + (cov12 / (sd2 * sd2)) * (s2 - mu2)
          const condMuMed = medMu + (1 / count) * (s2 - mu2)

          const pBeat1 = normalCdf((s2 - condMu1) / condSd1_given2)
          const pBeatMed = normalCdf((s2 - condMuMed) / condSdMed_given2)

          p2_2 += wQ * (pBeat1 * pBeatMed)
          p0_2 += wQ * ((1 - pBeat1) * (1 - pBeatMed))
        }
        let p1_2 = Math.max(0, 1 - p2_2 - p0_2)
        const sum2 = p0_2 + p1_2 + p2_2
        if (sum2 > 0) {
          p0_2 /= sum2
          p1_2 /= sum2
          p2_2 /= sum2
        }
        weeklyWinDistsByRoster.get(secondId)?.push(new Float64Array([p0_2, p1_2, p2_2]))
      } else {
        const p1 = normalCdf((mu1 - mu2) / diffSd)
        weeklyWinDistsByRoster.get(firstId)?.push(new Float64Array([1 - p1, p1]))
        weeklyWinDistsByRoster.get(secondId)?.push(new Float64Array([p1, 1 - p1]))
      }
    }

    // Process any unpaired teams (e.g. bye weeks)
    for (const r of data.rosters) {
      if (!processedRosters.has(r.roster_id)) {
        if (hasLeagueMedianMatch && count >= 2) {
          const mu = weekStarterMu.get(r.roster_id) ?? 0
          const sd = weekStarterSd.get(r.roster_id) ?? 15
          const pooledSd = Math.sqrt(Math.max(1, sd * sd + medVar - (2 * sd * sd) / count))
          const pMed = normalCdf((mu - medMu) / pooledSd)
          weeklyWinDistsByRoster.get(r.roster_id)?.push(new Float64Array([1 - pMed, pMed]))
        } else {
          weeklyWinDistsByRoster.get(r.roster_id)?.push(new Float64Array([1]))
        }
      }
    }
  }

  const fullWinDists = new Map<number, Float64Array>()
  const winMeanByRoster = new Map<number, number>()
  const winSdByRoster = new Map<number, number>()

  for (const r of data.rosters) {
    const weeklyDists = weeklyWinDistsByRoster.get(r.roster_id) ?? []
    const remDist = convolveDiscreteDistributions(weeklyDists)
    const bW = Math.round(baseWins.get(r.roster_id) ?? 0)
    const fullDist = new Float64Array(bW + remDist.length)

    let meanW = bW
    let varW = 0
    for (const d of weeklyDists) {
      let e1 = 0
      let e2 = 0
      for (let k = 0; k < d.length; k += 1) {
        e1 += k * d[k]
        e2 += k * k * d[k]
      }
      meanW += e1
      varW += Math.max(0, e2 - e1 * e1)
    }

    for (let k = 0; k < remDist.length; k += 1) {
      fullDist[bW + k] = remDist[k]
    }
    fullWinDists.set(r.roster_id, fullDist)
    winMeanByRoster.set(r.roster_id, meanW)
    winSdByRoster.set(r.roster_id, Math.sqrt(Math.max(0.25, varW)))
  }

  const playoffCount = count - nonPlayoffCount
  const rhoWinScore = 0.65
  const condScoreFactor = Math.sqrt(1 - rhoWinScore * rhoWinScore)
  const lotteryProbByRoster = new Map<number, number>()
  const lotteryMeanZByRoster = new Map<number, number>()

  // Conditional Gauss-Hermite quadrature over Team i's (Wins = w, Points = s_q) so opponent comparisons are conditionally independent.
  for (const r of data.rosters) {
    const rId = r.roster_id
    const distI = fullWinDists.get(rId)!
    const muW_i = winMeanByRoster.get(rId) ?? 0
    const sdW_i = winSdByRoster.get(rId) ?? 1
    const muS_i = totalStarterMu.get(rId) ?? 0
    const sdS_i = Math.sqrt(Math.max(1, totalStarterVar.get(rId) ?? 100))

    const picks = new Array(count).fill(0)
    let lotProbSum = 0
    let lotWeightedZ = 0

    for (let w = 0; w < distI.length; w += 1) {
      const pW = distI[w]
      if (pW <= 1e-7) continue
      const zW = (w - muW_i) / sdW_i
      const condMuS_i = muS_i + rhoWinScore * sdS_i * zW
      const condSdS_i = Math.max(1, sdS_i * condScoreFactor)

      for (let q = 0; q < GAUSS_HERMITE_Z.length; q += 1) {
        const weight = pW * GAUSS_HERMITE_W[q]
        if (weight <= 1e-8) continue
        const sRealized = condMuS_i + GAUSS_HERMITE_Z[q] * condSdS_i
        const zTotal = 0.75 * zW + 0.25 * GAUSS_HERMITE_Z[q]

        const oppBeatsProbs: number[] = []
        for (const other of data.rosters) {
          const oId = other.roster_id
          if (oId === rId) continue
          const distJ = fullWinDists.get(oId)!
          let pStrictlyMoreWins = 0
          for (let wJ = w + 1; wJ < distJ.length; wJ += 1) {
            pStrictlyMoreWins += distJ[wJ]
          }
          const pSameWins = w < distJ.length ? distJ[w] : 0
          let pTiebreakBeat = 0
          if (pSameWins > 1e-8) {
            const zW_j = (w - (winMeanByRoster.get(oId) ?? 0)) / (winSdByRoster.get(oId) ?? 1)
            const muS_j = totalStarterMu.get(oId) ?? 0
            const sdS_j = Math.sqrt(Math.max(1, totalStarterVar.get(oId) ?? 100))
            const condMuS_j = muS_j + rhoWinScore * sdS_j * zW_j
            const condSdS_j = Math.max(1, sdS_j * condScoreFactor)
            pTiebreakBeat = 1 - normalCdf((sRealized - condMuS_j) / condSdS_j)
          }
          oppBeatsProbs.push(Math.min(1, Math.max(0, pStrictlyMoreWins + pSameWins * pTiebreakBeat)))
        }

        const aheadDist = convolvePoissonBinomial(oppBeatsProbs)
        for (let kAhead = 0; kAhead < aheadDist.length; kAhead += 1) {
          const pK = aheadDist[kAhead]
          if (pK <= 1e-9) continue
          const seed = kAhead + 1
          const mass = weight * pK
          if (seed <= playoffCount) {
            const pickSlot = count - seed + 1
            picks[pickSlot - 1] += mass
          } else {
            lotProbSum += mass
            lotWeightedZ += mass * zTotal
          }
        }
      }
    }

    lotteryProbByRoster.set(rId, lotProbSum)
    lotteryMeanZByRoster.set(rId, lotProbSum > 1e-6 ? lotWeightedZ / lotProbSum : -0.5)
    result.set(rId, picks)
  }

  // Conditional Max PF order statistics among the nonPlayoffCount eliminated lottery teams.
  if (nonPlayoffCount > 0) {
    const condLotMu = new Map<number, number>()
    const condLotSd = new Map<number, number>()
    const rhoWinMaxPf = 0.58

    for (const r of data.rosters) {
      const rId = r.roster_id
      const muM = totalMaxPfMu.get(rId) ?? 0
      const sdM = Math.sqrt(Math.max(1, totalMaxPfVar.get(rId) ?? 100))
      const meanZ = lotteryMeanZByRoster.get(rId) ?? -0.5
      condLotMu.set(rId, muM + rhoWinMaxPf * sdM * meanZ)
      condLotSd.set(rId, Math.max(1, sdM * Math.sqrt(1 - 0.5 * rhoWinMaxPf * rhoWinMaxPf)))
    }

    for (const r of data.rosters) {
      const rId = r.roster_id
      const pLot_i = lotteryProbByRoster.get(rId) ?? 0
      if (pLot_i <= 1e-8) continue
      const picks = result.get(rId)!
      const muM_i = condLotMu.get(rId)!
      const sdM_i = condLotSd.get(rId)!

      let otherLotSum = 0
      for (const other of data.rosters) {
        if (other.roster_id !== rId) {
          otherLotSum += lotteryProbByRoster.get(other.roster_id) ?? 0
        }
      }
      const targetOtherLot = Math.max(0, nonPlayoffCount - 1)
      const lotDistribution = new Float64Array(nonPlayoffCount)

      for (let q = 0; q < GAUSS_HERMITE_Z.length; q += 1) {
        const wQ = GAUSS_HERMITE_W[q]
        const mRealized = muM_i + GAUSS_HERMITE_Z[q] * sdM_i

        // Select or weight the other teams by their conditional probability of accompanying Team i in the lottery.
        const oppLowerMaxPfProbs: number[] = []
        for (const other of data.rosters) {
          const oId = other.roster_id
          if (oId === rId) continue
          const pLot_j = lotteryProbByRoster.get(oId) ?? 0
          const condInLot_j = otherLotSum > 1e-6
            ? Math.min(1, pLot_j * (targetOtherLot / otherLotSum))
            : 0
          if (condInLot_j <= 1e-6) continue
          const pLower = normalCdf((mRealized - condLotMu.get(oId)!) / condLotSd.get(oId)!)
          oppLowerMaxPfProbs.push(condInLot_j * pLower)
        }

        const lowerDist = convolvePoissonBinomial(oppLowerMaxPfProbs)
        for (let k = 0; k < lowerDist.length; k += 1) {
          const slotIdx = Math.min(nonPlayoffCount - 1, k)
          lotDistribution[slotIdx] += wQ * lowerDist[k]
        }
      }

      const lotSum = lotDistribution.reduce((a, b) => a + b, 0)
      if (lotSum > 0) {
        for (let lotIdx = 0; lotIdx < nonPlayoffCount; lotIdx += 1) {
          picks[lotIdx] += pLot_i * (lotDistribution[lotIdx] / lotSum)
        }
      }
    }
  }

  for (const r of data.rosters) {
    const picks = result.get(r.roster_id)!
    const sum = picks.reduce((a, b) => a + b, 0)
    if (sum > 0) {
      for (let i = 0; i < count; i += 1) picks[i] /= sum
    }
  }

  const rosterIds = data.rosters.map((r) => r.roster_id)
  const analyticalMatrix = rosterIds.map((rId) => result.get(rId) ?? new Array(count).fill(0))
  const doublyStochastic = makeDoublyStochastic(analyticalMatrix)
  rosterIds.forEach((rId, idx) => {
    result.set(rId, doublyStochastic[idx])
  })

  return result
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

  // By the Rearrangement Inequality, sorting by expectedPick ascending minimizes sum_i (pick_i - E[Pick_i])^2
  // across all N! permutations and guarantees monotonically non-decreasing xPick down the board.
  const ordered = [...enriched].sort(
    (a, b) =>
      a.expectedPick - b.expectedPick ||
      b.lotteryProb - a.lotteryProb ||
      a.team.maxPf - b.team.maxPf,
  )

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
  const hasLeagueMedianMatch = Number(league.settings.league_average_match) === 1

  const regularEnd = Math.min(18, Math.max(1, playoffStart - 1))
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

  const positionalTheta = computeLeaguePositionalTheta(scoring)
  const { profiles: globalProfiles, idToGlobalIndex } = buildGlobalPlayerProfiles(
    data,
    positionalTheta,
    scoring,
    hasMilestoneBonuses,
    firstSimWeek,
    regularEnd,
  )

  const bootstrapPools = buildEmpiricalBootstrapPools(data)
  const compiledWeeks = new Map<number, Map<number, CompiledRosterWeek>>()
  let maxCompiledPlayers = slots.length

  for (let week = firstSimWeek; week <= regularEnd; week += 1) {
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
            : (activeInGame ? liveInGamePlayProbability(injuryTier) : 0)

          // In-game conjugate Gamma-Poisson rate update: E[rate | y, p] = (mu_0 + eta * y) / (1 + eta * p)
          const eta = 0.35
          const updatedRate = (baseMu + eta * lockedPoints) / (1 + eta * progress)
          const clampedRate = Math.max(0.20 * baseMu, Math.min(2.50 * baseMu, updatedRate))

          remBaseMu = clampedRate * remFraction * liveAvail
          const bonusRateScale = baseMu > 0.1 ? clampedRate / baseMu : 1
          expectedBonus = expBonus * bonusRateScale * remFraction * liveAvail
        }

        const canEverPlayThisWeek = !(weeksAhead === 0 && (injuryTier === 'ir' || injuryTier === 'out'))
        const isActualStarter = actualStarterSet.has(id)

        const neverScores =
          !isActualStarter &&
          lockedPoints <= 0 &&
          (remBaseMu <= 0.02 || !canEverPlayThisWeek)
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

        const globalPlayerIndex = idToGlobalIndex.get(id) ?? -1
        const profile = globalPlayerIndex >= 0 ? globalProfiles[globalPlayerIndex] : undefined
        const ebStd = profile?.ebStandardMult ?? 1
        const ebStrong = profile?.ebStrongFormMult ?? 1
        const ebYouth = ebStd * (profile?.youthTrajectoryMult ?? 1)
        const stdScale = state === 3 ? (weeksAhead > 0 ? ebStd : 1 + 0.5 * (ebStd - 1)) : 1
        const strongFormScale = state === 3 ? (weeksAhead > 0 ? ebStrong : 1 + 0.5 * (ebStrong - 1)) : 1
        const youthScale = state === 3 ? (weeksAhead > 0 ? ebYouth : 1 + 0.5 * (ebYouth - 1)) : 1
        const rosWeight = state === 3 ? (weeksAhead > 0 ? 1 : 0.35) : 0

        const theta = positionalTheta[primaryPos] ?? 2.15
        const tier = remBaseMu * stdScale >= 10 ? 'high' : 'low'
        const bootstrapPool = bootstrapPools.byKey[`${primaryPos}:${tier}`] ?? bootstrapPools.fallback
        idToIndex.set(id, compiledPlayers.length)
        compiledPlayers.push({
          id,
          globalPlayerIndex,
          player,
          posMask: effectiveMask,
          nflTeamIndex: getNflTeamId(nflTeam),
          state,
          lockedPoints,
          remBaseMu,
          expectedBonus,
          remFraction,
          theta2: theta * theta,
          stdScale,
          strongFormScale,
          youthScale,
          rosWeight,
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

  const lineupEfficiencyByRoster = calibrateLineupEfficiency(data)

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
  const rebuilderEfficiencyByRoster = calibrateRebuilderContenderEfficiency(data, baseFptsByRoster)

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
  const numGlobalPlayers = globalProfiles.length
  const nflTeamShocks = new Float64Array(numNflTeams)
  const nflTeamRosMult = new Float64Array(numNflTeams)
  const playerRosMult = new Float64Array(Math.max(1, numGlobalPlayers))
  const playerWeeksOut = new Int16Array(Math.max(1, numGlobalPlayers))
  const bufLen = Math.max(maxCompiledPlayers, 1)
  const scratchScores = new Float64Array(bufLen)
  const scratchExpected = new Float64Array(bufLen)
  const scratchAvailable = new Uint8Array(bufLen)
  const scratchOrder = new Int32Array(bufLen)
  const scratchUsed = new Uint8Array(bufLen)
  const medianScratch = new Float64Array(count)
  const qbDown = new Uint8Array(numNflTeams)
  const startingQbByNflTeam = new Int32Array(numNflTeams).fill(-1)
  const startingQbMuByNflTeam = new Float64Array(numNflTeams)

  for (let g = 0; g < globalProfiles.length; g += 1) {
    const prof = globalProfiles[g]
    if (prof.primaryPos === 'QB' && prof.nflTeam) {
      const tId = getNflTeamId(prof.nflTeam)
      if (tId >= 0 && prof.calibratedMu > startingQbMuByNflTeam[tId]) {
        startingQbMuByNflTeam[tId] = prof.calibratedMu
        startingQbByNflTeam[tId] = g
      }
    }
  }

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

  function initSeasonLatentState(model: ModelConfig, rng: RandomSource): void {
    if (model.rosOffenseSd <= 0) {
      nflTeamRosMult.fill(1)
    } else {
      const offVar = model.rosOffenseSd * model.rosOffenseSd
      const offShape = 1 / offVar
      for (let t = 0; t < numNflTeams; t += 1) {
        nflTeamRosMult[t] = sampleGamma(offShape, rng) * offVar
      }
    }

    for (let g = 0; g < numGlobalPlayers; g += 1) {
      const prof = globalProfiles[g]
      const pSd = prof.rosUncertSd * model.rosPlayerScale
      if (pSd <= 0) {
        playerRosMult[g] = 1
      } else {
        const pVar = pSd * pSd
        playerRosMult[g] = sampleGamma(1 / pVar, rng) * pVar
      }
      playerWeeksOut[g] = drawInitialWeeksOut(
        prof.injuryTier,
        prof.activeGameCount,
        data.lastScoredWeek,
        prof.injuredInLiveGame,
        rng,
      )
    }
  }

  function advanceMarkovInjuriesOneWeek(
    completedWeek: number,
    attritionScale: number,
    rng: RandomSource,
  ): void {
    for (let g = 0; g < numGlobalPlayers; g += 1) {
      if (playerWeeksOut[g] > 0) {
        playerWeeksOut[g] -= 1
        continue
      }
      const prof = globalProfiles[g]
      if (((prof.byeWeekMask >>> completedWeek) & 1) !== 0) continue
      if (completedWeek === data.currentWeek && prof.survivedLivePostHealthy) continue
      const hazard = prof.injuryHazardBase * attritionScale
      if (hazard > 0 && rng.next() < hazard) {
        playerWeeksOut[g] = drawNewInjuryWeeks(rng)
      }
    }
  }

  function simulateRosterForWeek(
    rw: CompiledRosterWeek,
    rosterId: number,
    model: ModelConfig,
    corrVar: number,
    rng: RandomSource,
    computeMaxPf: boolean,
  ): { starterScore: number; maxPfScore: number } {
    const players = rw.players
    const n = players.length
    const lineupEfficiency = model.useStrongBayesianForm
      ? (lineupEfficiencyByRoster.get(rosterId) ?? 1)
      : (model.useRebuilderContenderEfficiency ? (rebuilderEfficiencyByRoster.get(rosterId) ?? 1) : 1)

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
        const rawTeamShock = pw.nflTeamIndex >= 0 ? nflTeamShocks[pw.nflTeamIndex] : 1
        const teamMult = 1 + Math.sqrt(pw.remFraction) * (rawTeamShock - 1)
        const inCorrVar = corrVar * pw.remFraction
        const remSim = samplePlayerRemainingPoints(
          pw,
          teamMult,
          1,
          model.sampler,
          milestoneWeights,
          inCorrVar,
          model.dispersionScale,
          rng,
        )
        scratchExpected[i] = pw.lockedPoints + pw.remBaseMu + pw.expectedBonus
        scratchScores[i] = pw.lockedPoints + remSim
        continue
      }

      const gIdx = pw.globalPlayerIndex
      if (gIdx >= 0 && playerWeeksOut[gIdx] > 0) {
        scratchAvailable[i] = 0
        scratchExpected[i] = 0
        scratchScores[i] = 0
        continue
      }

      const baseScale = model.useStrongBayesianForm
        ? pw.strongFormScale
        : (model.useYouthTrajectory ? pw.youthScale : pw.stdScale)
      const qbCascadeMult =
        model.useQbDomino && pw.nflTeamIndex >= 0 && qbDown[pw.nflTeamIndex] === 1
          ? ((pw.posMask & 12) !== 0 ? 0.78 : (pw.posMask & 2) !== 0 ? 0.92 : 1)
          : 1
      const rawRos =
        (gIdx >= 0 ? playerRosMult[gIdx] : 1) *
        (pw.nflTeamIndex >= 0 ? nflTeamRosMult[pw.nflTeamIndex] : 1)
      const effectiveScale = baseScale * qbCascadeMult * (pw.rosWeight > 0 ? 1 + pw.rosWeight * (rawRos - 1) : 1)

      scratchAvailable[i] = 1
      scratchExpected[i] = (pw.remBaseMu + pw.expectedBonus) * effectiveScale
      const teamMult = pw.nflTeamIndex >= 0 ? nflTeamShocks[pw.nflTeamIndex] : 1
      scratchScores[i] = samplePlayerRemainingPoints(
        pw,
        teamMult,
        effectiveScale,
        model.sampler,
        milestoneWeights,
        corrVar,
        model.dispersionScale,
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
  let totalWeightedSimulations = 0

  for (const [modelIndex, model] of MODELS.entries()) {
    const rng = createRandomSource(baseSeed + modelIndex * 7919)
    const corrVar = model.teamCorrSd * model.teamCorrSd
    totalWeightedSimulations += SIMULATIONS_PER_MODEL * model.priorWeight

    for (let run = 0; run < SIMULATIONS_PER_MODEL; run += 1) {
      initSeasonLatentState(model, rng)
      let markovCurrentWeek = Math.min(firstSimWeek, data.currentWeek)

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
        while (markovCurrentWeek < week) {
          advanceMarkovInjuriesOneWeek(markovCurrentWeek, model.attritionScale, rng)
          markovCurrentWeek += 1
        }

        const weekRosters = compiledWeeks.get(week)
        if (!weekRosters) continue

        rollNflTeamShocks(model.teamCorrSd, rng)
        if (model.useQbDomino) {
          qbDown.fill(0)
          for (let t = 0; t < numNflTeams; t += 1) {
            const qbIdx = startingQbByNflTeam[t]
            if (qbIdx >= 0 && playerWeeksOut[qbIdx] > 0) {
              qbDown[t] = 1
            }
          }
        }
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
            corrVar,
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
        stats.get(roster.roster_id)!.sumSimulatedMaxPf +=
          (simulatedMaxPf.get(roster.roster_id) ?? 0) * model.priorWeight
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
      const playoffSet = new Set(playoff.map((roster) => roster.roster_id))

      // Playoff teams get draft picks based on regular season seed (not playoff tournament games):
      // Seed 1 (top seed, index 0) -> Pick count (12)
      // Seed 6 (last seed, index playoffTeams - 1) -> Pick 7
      playoff.forEach((roster, index) => {
        const team = stats.get(roster.roster_id)!
        const slot = count - index
        team.picks[slot] += 1
        team.modelPicks[model.key][slot] += 1
      })

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

  const targetRookieSeason = upcomingRookieSeason(league)
  const pickOwners = new Map<number, number>()
  for (const pick of data.tradedPicks) {
    if (Number(pick.season) === targetRookieSeason && pick.round === 1) {
      pickOwners.set(pick.roster_id, pick.owner_id)
    }
  }

  const allEngineLabels = [
    ...MODELS.map((model) => model.label),
    'Analytical Gaussian convolution',
  ]

  // If the regular season is already completed (firstSimWeek > regularEnd), draft order is locked deterministically.
  if (firstSimWeek > regularEnd) {
    const seeded = [...data.rosters].sort((a, b) => {
      const aWins = num(a.settings.wins) + num(a.settings.ties) * 0.5
      const bWins = num(b.settings.wins) + num(b.settings.ties) * 0.5
      const aPts = baseFptsByRoster.get(a.roster_id) ?? 0
      const bPts = baseFptsByRoster.get(b.roster_id) ?? 0
      const aMax = baseMaxPfByRoster.get(a.roster_id) ?? 0
      const bMax = baseMaxPfByRoster.get(b.roster_id) ?? 0
      return bWins - aWins || bPts - aPts || bMax - aMax
    })

    const playoff = seeded.slice(0, playoffTeams)
    const playoffSet = new Set(playoff.map((r) => r.roster_id))
    const eliminated = data.rosters
      .filter((r) => !playoffSet.has(r.roster_id))
      .sort((a, b) => (baseMaxPfByRoster.get(a.roster_id) ?? 0) - (baseMaxPfByRoster.get(b.roster_id) ?? 0))

    const lockedSlotByRoster = new Map<number, number>()
    playoff.forEach((r, idx) => lockedSlotByRoster.set(r.roster_id, count - idx))
    eliminated.forEach((r, idx) => lockedSlotByRoster.set(r.roster_id, idx + 1))

    return data.rosters
      .map((roster) => {
        const slot = lockedSlotByRoster.get(roster.roster_id) ?? 1
        const probabilities = new Array(count).fill(0)
        probabilities[slot - 1] = 1
        const probabilityRanges = probabilities.map((p) => ({ low: p, high: p }))
        const pickHolderId = pickOwners.get(roster.roster_id) ?? roster.roster_id
        const holder = data.rosters.find((item) => item.roster_id === pickHolderId)
        const wins = num(roster.settings.wins)
        const losses = num(roster.settings.losses)
        const ties = num(roster.settings.ties)
        const currMax = baseMaxPfByRoster.get(roster.roster_id) ?? 0
        return {
          roster,
          name: teamName(data, roster),
          record: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
          maxPf: currMax,
          currentMaxPf: currMax,
          pick: slot,
          expectedPick: slot,
          pickHolder: holder ? teamName(data, holder) : `Team ${pickHolderId}`,
          pickHolderId,
          probabilities,
          probabilityRanges,
          modelNames: allEngineLabels,
          simulationCount: TOTAL_SIMULATIONS,
        }
      })
      .sort((a, b) => a.pick - b.pick)
  }

  const analyticalProbabilities = computeAnalyticalProbabilities(
    data,
    compiledWeeks,
    weekPairs,
    firstSimWeek,
    regularEnd,
    baseFptsByRoster,
    baseMaxPfByRoster,
    slots,
    slotInfo,
    globalProfiles,
    count,
    nonPlayoffCount,
    hasLeagueMedianMatch,
  )

  const enginePriorWeights = [
    ...MODELS.map((model) => model.priorWeight),
    ANALYTICAL_ENGINE_PRIOR_WEIGHT,
  ]
  const totalEngineWeight = enginePriorWeights.reduce((sum, w) => sum + w, 0)

  const rawTeams = [...stats.values()].map((team) => {
    const modelProbabilities = MODELS.map((model) =>
      team.modelPicks[model.key].slice(1).map((value) => value / SIMULATIONS_PER_MODEL),
    )
    const analyticalProbs = analyticalProbabilities.get(team.roster.roster_id) ?? new Array(count).fill(0)
    const allEngineProbabilities = [...modelProbabilities, analyticalProbs]

    const probabilities = new Array(count).fill(0).map((_, pickIdx) => {
      let weightedSum = 0
      for (let engIdx = 0; engIdx < allEngineProbabilities.length; engIdx += 1) {
        weightedSum += (allEngineProbabilities[engIdx][pickIdx] ?? 0) * enginePriorWeights[engIdx]
      }
      return weightedSum / totalEngineWeight
    })

    const probabilityRanges = probabilities.map((_, index) => ({
      low: Math.min(...allEngineProbabilities.map((engine) => engine[index] ?? 0)),
      high: Math.max(...allEngineProbabilities.map((engine) => engine[index] ?? 0)),
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
      maxPf: team.sumSimulatedMaxPf / Math.max(1, totalWeightedSimulations),
      currentMaxPf: baseMaxPfByRoster.get(team.roster.roster_id) ?? 0,
      pickHolder: holder ? teamName(data, holder) : `Team ${pickHolderId}`,
      pickHolderId,
      probabilities,
      probabilityRanges,
      modelNames: allEngineLabels,
      simulationCount: TOTAL_SIMULATIONS,
    }
  })

  const rawMatrix = rawTeams.map((team) => team.probabilities)
  const normalizedMatrix = makeDoublyStochastic(rawMatrix)
  rawTeams.forEach((team, idx) => {
    const probs = normalizedMatrix[idx]
    team.probabilities = probs
    team.probabilityRanges = team.probabilityRanges.map((range, pickIdx) => {
      const p = probs[pickIdx] ?? 0
      return {
        low: Math.min(range.low, p),
        high: Math.max(range.high, p),
      }
    })
  })

  return assignBijectiveDraftPicks(rawTeams, nonPlayoffCount)
    .sort((a, b) => a.pick - b.pick)
}
