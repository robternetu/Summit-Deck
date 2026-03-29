/**
 * Shared types for GRID evidence data structures.
 * Single source of truth for all evidence-related types across the codebase.
 * 
 * These types mirror the data extracted from GRID events.jsonl files
 * and stored in MongoDB under match.analytics.evidence_v1
 */

// =============================================================================
// Core Evidence Types
// =============================================================================

export interface MapStat {
  gameId: string
  teamId: string
  teamName: string
  roundsWon: number
  roundsLost?: number
  attackRoundsWon?: number
  defenseRoundsWon?: number
}

export interface GameInfo {
  gameId: string
  mapName: string
  sequenceNumber: number
}

export interface RoundInfo {
  gameId: string
  roundNumber: number
  winnerTeamId: string
  winType?: string
  winnerSide?: 'attack' | 'defense'
  firstBlood?: {
    killerId: string
    victimId: string
    killerTeamId: string
    timestamp: string
  }
  hadPlant: boolean
  hadDefuse: boolean
}

export interface KillEvent {
  gameId: string
  roundNumber: number
  timestamp: string
  killerId: string
  killerTeamId: string
  victimId: string
  victimTeamId: string
  weapon?: string
  weaponCategory?: string  // Sprint 1: rifle, smg, sniper, etc.
  isHeadshot?: boolean
  assistIds?: string[]
  isIsolated?: boolean
  isFirstBlood?: boolean
  nearestTeammateDistance?: number | null
  killerPosition?: Position
  victimPosition?: Position
  // Sprint 1: Engagement analysis
  killDistance?: number | null
  engagementRange?: string  // close, medium, long
}

export interface PlantEvent {
  gameId: string
  roundNumber: number
  timestamp: string
  planterId: string
  planterTeamId: string
  site: string
  position?: Position
}

export interface DefuseEvent {
  gameId: string
  roundNumber: number
  timestamp: string
  defuserId: string
  defuserTeamId: string
  site: string
}

export interface Position {
  x: number
  y: number
  z?: number
}

// =============================================================================
// Player Stats Types
// =============================================================================

export interface PlayerInfo {
  playerId: string
  playerName?: string
  teamId: string
  firstBloods: number
  firstDeaths: number
  kills: number
  deaths: number
  kd: number
  isolatedDeathsCount: number
}

export interface ClutchSituation {
  gameId: string
  roundNumber: number
  playerId: string
  playerName?: string
  teamId: string
  situation: string // e.g., "1v1", "1v2", "1v3"
  opponentsAlive: number
  won: boolean
}

export interface AbilityUse {
  gameId: string
  roundNumber: number
  timestamp: string
  playerId: string
  teamId: string
  agent: string
  abilityId: string
  abilityName: string
  position?: Position
}

export interface AgentComposition {
  playerId: string
  playerName?: string
  teamId: string
  agent: string
}

// =============================================================================
// Economy Types
// =============================================================================

export type EconomyTier = 'full_buy' | 'half_buy' | 'eco' | 'save'

export interface EconomyRound {
  gameId: string
  roundNumber: number
  teamId: string
  teamName: string
  avgLoadoutValue: number
  totalLoadoutValue: number
  economyTier: EconomyTier
  previousRoundWon: boolean | null
  roundWon: boolean
  playerLoadouts?: Array<{
    playerId: string
    loadoutValue: number
  }>
}

// =============================================================================
// Derived Stats Types
// =============================================================================

export interface FirstBloodStat {
  teamId: string
  teamName: string
  firstBloods: number
  firstDeaths: number
  firstBloodRate: number
  conversionRate: number // Win rate when getting first blood
}

export interface PlantStat {
  teamId: string
  teamName: string
  plants: number
  postPlantWins: number
  postPlantWinRate: number
}

export interface SiteStat {
  site: string
  attackStats: {
    [teamId: string]: {
      teamId: string
      teamName: string
      plants: number
      postPlantWins: number
      postPlantWinRate: number
    }
  }
  defenseStats: {
    [teamId: string]: {
      teamId: string
      teamName: string
      defenseAttempts: number
      defenseWins: number
      defenseWinRate: number
    }
  }
}

export interface ClutchStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  clutchAttempts: number
  clutchWins: number
  clutchRate: number
  breakdown: {
    [situation: string]: {
      attempts: number
      wins: number
    }
  }
}

export interface EconomyStat {
  teamId: string
  teamName: string
  byTier: {
    [tier: string]: {
      rounds: number
      wins: number
      winRate: number
    }
  }
  afterLoss: {
    [tier: string]: {
      rounds: number
      wins: number
      winRate: number
    }
  }
  afterWin: {
    [tier: string]: {
      rounds: number
      wins: number
      winRate: number
    }
  }
  forceAfterPistolLoss?: {
    attempts: number
    wins: number
    winRate: number
  }
}

export interface AbilityStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  totalAbilityUses: number
  roundsPlayed: number
  abilitiesPerRound: number
  agentBreakdown: Array<{
    agent: string
    totalUses: number
    abilities: Array<{
      name: string
      uses: number
    }>
  }>
}

export interface TradeKill {
  gameId: string
  roundNumber: number
  originalKillTimestamp: string
  tradeTimestamp: string
  timeDelta: number
  originalVictimId: string
  originalKillerId: string
  traderId: string
  traderTeamId: string
}

export interface TradeStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  deaths: number
  deathsTraded: number
  untradedDeaths: number
  tradedRate: number
  tradesGotten: number
}

export interface OpeningDuelStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  openingKills: number
  openingDeaths: number
  openingDuels: number
  openingDuelWinRate: number
  attackOpeningKills: number
  attackOpeningDeaths: number
  attackOpeningDuels: number
  attackOpeningWinRate: number
  defenseOpeningKills: number
  defenseOpeningDeaths: number
  defenseOpeningDuels: number
  defenseOpeningWinRate: number
  openingKillConversion: number
  openingDeathSurvival: number
}

export type MultiKillType = '2k' | '3k' | '4k' | 'ace'

export interface MultiKillRound {
  gameId: string
  roundNumber: number
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  kills: number
  type: MultiKillType
}

export interface MultiKillStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  twoKs: number
  threeKs: number
  fourKs: number
  aces: number
  totalMultiKills: number
  impactScore: number
}

// =============================================================================
// Sprint 1: New Analytics Types
// =============================================================================

export interface WeaponStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  totalKills: number
  byWeapon: {
    [weapon: string]: {
      kills: number
      percentage: number
    }
  }
  byCategory: {
    [category: string]: {
      kills: number
      percentage: number
    }
  }
  operatorKills: number
  operatorOpeningKills: number
}

export interface EngagementStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  byRange: {
    [range: string]: {
      kills: number
      deaths: number
      winRate: number
    }
  }
  preferredRange: string
  avgKillDistance: number
}

export interface TempoStat {
  teamId: string
  teamName: string
  attackStats: {
    avgTimeToPlant: number
    latePlantRate: number
    latePlantWinRate: number
    fastExecuteWinRate: number
  }
  defenseStats: {
    avgTimeToFirstKill: number
    earlyAggressionRate: number
  }
  byTempo: {
    [tempo: string]: {
      rounds: number
      wins: number
      winRate: number
    }
  }
}

export interface SaveRoundStat {
  teamId: string
  teamName: string
  saveRounds: number
  exitFragsAttempted: number
  saveRoundWins: number
  disciplineScore: number
}

export interface AntiEcoStat {
  teamId: string
  teamName: string
  antiEcoRounds: number
  antiEcoWins: number
  antiEcoWinRate: number
  deathsToEco: number
  deathsToForce: number
  problematicWeapons: Array<{
    weapon: string
    deaths: number
  }>
}

export interface HalfStat {
  teamId: string
  teamName: string
  gameId: string
  firstHalf: {
    side: 'attack' | 'defense' | null
    roundsWon: number
    roundsLost: number
    winRate: number
    pistolWon: boolean | null
  }
  secondHalf: {
    side: 'attack' | 'defense' | null
    roundsWon: number
    roundsLost: number
    winRate: number
    pistolWon: boolean | null
  }
  adaptation: {
    improved: boolean
    delta: number
  }
}

// =============================================================================
// Sprint 2: Tactical Depth & Ability Analytics Types
// =============================================================================

export interface AbilityCorrelation {
  gameId: string
  roundNumber: number
  abilityTimestamp: string
  killTimestamp: string
  timeDelta: number
  abilityUserId: string
  abilityUserName: string
  abilityId: string
  abilityName: string
  abilityCategory: 'flash' | 'smoke' | 'damage' | 'recon' | 'mobility' | 'other'
  killerId: string
  killerName: string
  victimId: string
  isSamePlayer: boolean
  isTeammateKill: boolean
}

export interface AbilityImpactStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  totalAbilityUses: number
  flashAssists: number
  flashAssistRate: number
  selfKillsAfterAbility: number
  teammateKillsAfterAbility: number
  utilityKillSetups: number
  abilityBreakdown: {
    [abilityId: string]: {
      uses: number
      correlatedKills: number
      effectiveness: number
    }
  }
}

export interface TeamUtilityStat {
  teamId: string
  teamName: string
  totalAbilityUses: number
  correlatedKills: number
  utilityCoordinationScore: number
  flashUses: number
  flashAssists: number
  topFlashPlayer: string | null
  mostEffectiveUtility: string | null
}

export interface PostPlantSiteStat {
  mapName: string
  site: string
  postPlantKills: number
  postPlantDeaths: number
  kdRatio: number
}

export interface PostPlantPlayerStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  postPlantKills: number
  postPlantDeaths: number
  postPlantKD: number
  avgKillPosition: { avgX: number; avgY: number } | null
  avgDeathPosition: { avgX: number; avgY: number } | null
}

export interface PostPlantStats {
  siteStats: PostPlantSiteStat[]
  playerStats: PostPlantPlayerStat[]
}

export interface MatchupEntry {
  kills: number
  deaths: number
  differential: number
}

export interface MatchupDetail {
  opponentId: string
  opponentName: string
  kills: number
  deaths: number
  differential: number
}

export interface MatchupPlayerSummary {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  favorableMatchups: MatchupDetail[]
  unfavorableMatchups: MatchupDetail[]
  nemesis: string | null
  nemesisDifferential: number
  victim: string | null
  victimDifferential: number
}

export interface MatchupStats {
  matrix: {
    [playerId: string]: {
      [opponentId: string]: MatchupEntry
    }
  }
  playerSummary: MatchupPlayerSummary[]
}

export interface MapControlStat {
  teamId: string
  teamName: string
  aggressiveOpenings: number
  aggressiveOpeningWins: number
  aggressiveOpeningWinRate: number
  earlyKills: number
  earlyDeaths: number
  earlyKillDifferential: number
}

// =============================================================================
// Sprint 3: Strategic Situational Analytics Types
// =============================================================================

export interface PistolStat {
  teamId: string
  teamName: string
  pistolRounds: {
    played: number
    won: number
    winRate: number
    firstHalfWinRate: number
    secondHalfWinRate: number
    attackPistolWinRate: number
    defensePistolWinRate: number
  }
  bonusConversion: {
    bonusRoundsPlayed: number
    bonusRoundsWon: number
    bonusConversionRate: number
    lostToForceRate: number
  }
  antiBonus: {
    forceAttempts: number
    forceWins: number
    forceWinRate: number
  }
  pistolTopFragger: {
    playerId: string
    playerName: string
    pistolKills: number
    pistolDeaths: number
    pistolKD: number
  } | null
}

export interface ManAdvantageStat {
  teamId: string
  teamName: string
  byAdvantage: {
    [situation: string]: {
      total: number
      wins: number
      losses: number
      winRate: number
    }
  }
  throwStats: {
    totalThrows: number
    throwRate: number
    worstThrow: string | null
    throwRounds: Array<{
      gameId: string
      roundNumber: number
      situation: string
    }>
  }
  comebackStats: {
    totalComebacks: number
    bestComeback: string | null
    comebackRounds: Array<{
      gameId: string
      roundNumber: number
      situation: string
    }>
  }
  situationMatrix: {
    [situation: string]: {
      total: number
      wins: number
      winRate: number
    }
  }
}

export interface RetakeStat {
  teamId: string
  teamName: string
  totalRetakeAttempts: number
  retakeSuccesses: number
  retakeWinRate: number
  bySite: {
    [site: string]: {
      attempts: number
      successes: number
      winRate: number
    }
  }
  bySituation: {
    [situation: string]: {
      attempts: number
      successes: number
      winRate: number
    }
  }
  topDefuser: {
    playerId: string
    playerName: string
    clutchDefuses: number
  } | null
}

export interface EntryStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  entryAttempts: number
  entryKills: number
  entryDeaths: number
  entryKillRate: number
  entrySuccessRate: number
  deathsTraded: number
  deathsUntraded: number
  tradeRate: number
  entriesWithFlash: number
  entriesWithoutFlash: number
  flashSupportedWinRate: number
  dryEntryWinRate: number
}

export interface SpikeCarrierStat {
  teamId: string
  teamName: string
  totalAttackRounds: number
  successfulPlants: number
  carrierDeathsBeforePlant: number
  plantRate: number
  carrierDeathRate: number
  spikeDrops: number
  byPlayer: {
    [playerId: string]: {
      playerId: string
      playerName: string
      roundsAsCarrier: number
      successfulPlants: number
      deathsBeforePlant: number
      plantRate: number
    }
  }
}

// =============================================================================
// Sprint 4: Pattern Recognition & Predictive Analytics
// =============================================================================

export interface StreakRecord {
  gameId: string
  teamId: string
  streakType: 'win' | 'loss'
  length: number
  startRound: number
  endRound: number
  crossedHalves: boolean
  trigger: string
  breaker: string
}

export interface StreakInfo {
  count: number
  avgLength: number
  maxLength: number
  maxStreakGame: string
  maxStreakRounds: string
}

export interface TriggerInfo {
  count: number
  avgStreakLength: number
}

export interface MomentumStat {
  teamId: string
  teamName: string
  winStreaks: StreakInfo
  lossStreaks: StreakInfo
  triggerDistribution: {
    [trigger: string]: TriggerInfo
  }
  momentumScore: number
  resilienceScore: number
  keyMomentumRounds: {
    round: number
    gameId: string
    type: string
    impact: string
  }[]
}

export interface RoundImportance {
  gameId: string
  roundNumber: number
  importanceScore: number
  factors: {
    scoreCloseness: number
    matchPoint: boolean
    clutchPresent: boolean
    economyPivot: boolean
    streakRelevance: number
  }
}

export interface CriticalRound {
  gameId: string
  roundNumber: number
  importanceScore: number
  winnerTeamId: string
  criticalFactors: string[]
  learningOpportunity: string
}

export interface CriticalRoundStat {
  gameId: string
  totalCriticalRounds: number
  byPriority: {
    critical: number
    high: number
    medium: number
  }
  categoryBreakdown: {
    [category: string]: {
      count: number
      rounds: number[]
    }
  }
  topReviewRounds: {
    roundNumber: number
    reason: string
    coachingFocus: string
  }[]
  reviewTimeEstimate: number
}

export interface ExecuteSignature {
  gameId: string
  roundNumber: number
  teamId: string
  site: string
  executeTiming: 'early' | 'mid' | 'late' | 'unknown'
  entryMethod: string
  utilityCount: number
  prePlantKills: number
  roundWon: boolean
  signature: string
}

export interface ExecutePatternStat {
  teamId: string
  teamName: string
  executeBreakdown: {
    sitePreferences: {
      [site: string]: {
        count: number
        wins: number
        winRate: number
        avgPrePlantKills: number
      }
    }
    timingPreferences: {
      [timing: string]: {
        count: number
        wins: number
        winRate: number
      }
    }
    entryMethods: {
      [method: string]: {
        count: number
        wins: number
        winRate: number
      }
    }
    recurringPatterns: {
      [signature: string]: {
        count: number
        wins: number
        winRate: number
        rounds: number[]
      }
    }
  }
  preferredPatterns: {
    site: string
    timing: string
    entryMethod: string
  }
  mostSuccessfulPatterns: {
    site: string | null
    siteWinRate: number
    entryMethod: string | null
    entryWinRate: number
  }
  predictabilityScore: number
  coachingInsights: {
    type: string
    description: string
    severity: 'low' | 'medium' | 'high' | 'positive'
  }[]
}

export interface PerformanceTrendStat {
  teamId: string
  teamName: string
  gameId: string
  trendProfile: {
    headshotDirection: 'improving' | 'stable' | 'declining'
    phaseDistribution: {
      [phase: string]: number
    }
    dominantPhases: number
    strugglingPhases: number
  }
  fatigueIndicators: {
    lateGameDropoff: boolean
    lateGameKdDiff: number
    earlyGameKdDiff: number
  }
  coachingFlags: {
    flag: string
    description: string
    severity: 'low' | 'medium' | 'high'
  }[]
}

export interface CompositionStat {
  teamId: string
  teamName: string
  compositionFrequency: {
    [composition: string]: {
      count: number
      winRate: number
      maps: string[]
    }
  }
  agentEffectiveness: {
    [agent: string]: {
      gamesPlayed: number
      winRate: number
      player: string | null
    }
  }
  mapCompositions: {
    [mapName: string]: {
      preferredComp: string[]
      compWinRate: number
      gamesPlayed: number
    }
  }
  flexibilityScore: number
  uniqueCompositions: number
  totalGames: number
}

export interface OpponentTendency {
  opponentTeamId: string
  mapName: string
  gameId: string
  seriesId: string
  attackStats: {
    attackRounds: number
    attackWins: number
    sitePreference: {
      [site: string]: number
    }
  }
  economyDecisions: {
    forceBuyRounds: number[]
    saveRounds: number[]
    fullBuyRounds: number[]
    forceRate: number
  }
  playerPerformance: {
    [playerId: string]: {
      kills: number
      deaths: number
      firstBloods: number
    }
  }
  notableRounds: number[]
}

// =============================================================================
// Sprint 5: Advanced Intelligence & Coaching Automation
// =============================================================================

// Task 1: Win Probability Model
export interface WinProbabilityFactor {
  teamId: string
  roundNumber: number
  winProbability: number
  factors: {
    baseProbability: number
    economyAdjustment: number
    streakAdjustment: number
  }
  confidence: 'high' | 'medium' | 'low'
}

export interface SwingRound {
  roundNumber: number
  probability: number
  won: boolean
  impact: 'positive' | 'negative'
}

export interface WinProbabilityStat {
  teamId: string
  teamName: string
  modelAccuracy: number
  probabilityFactors: {
    economyImpact: {
      advantageWinRate: number
      disadvantageWinRate: number
      evenWinRate: number
      samples: {
        advantage: number
        disadvantage: number
        even: number
      }
    }
    streakImpact: {
      positiveStreakWinRate: number
      negativeStreakWinRate: number
      neutralWinRate: number
      samples: {
        positive: number
        negative: number
        neutral: number
      }
    }
  }
  swingRounds: SwingRound[]
  avgWinProbability: number
}

// Task 2: What-If Scenario Engine
export interface WhatIfScenario {
  scenario: string
  impact: {
    originalProbability: number
    modifiedProbability: number
    probabilityChange: number
    modification: {
      type: string
      value: unknown
      description: string
    }
    impactLevel: 'high' | 'medium' | 'low'
  }
}

export interface ScenarioRound {
  roundNumber: number
  gameId: string
  actualOutcome: 'win' | 'loss'
  scenarios: WhatIfScenario[]
}

export interface ScenarioAnalysis {
  teamId: string
  teamName: string
  scenarioCount: number
  keyScenarios: ScenarioRound[]
}

// Task 3: Automated Coaching Recommendations
export interface TeamWeakness {
  area: string
  severity: 'high' | 'medium' | 'low'
  description: string
  recommendation: string
}

export interface TeamStrength {
  area: string
  level: 'elite' | 'strong' | 'good'
  description: string
  leverage: string
}

export interface CoachingRecommendation {
  priority: 'critical' | 'high' | 'medium' | 'low'
  type: 'improvement' | 'leverage'
  area: string
  title: string
  details: string
  action: string
  expectedImpact: string
}

export interface CoachingRecommendationStat {
  teamId: string
  teamName: string
  weaknessCount: number
  strengthCount: number
  weaknesses: TeamWeakness[]
  strengths: TeamStrength[]
  recommendations: CoachingRecommendation[]
  topPriority: CoachingRecommendation | null
}

// Task 4: Scouting Report Generator
export interface ScoutingProfile {
  teamId: string
  teamName: string
  playstyle: {
    primary: 'aggressive' | 'methodical' | 'balanced'
    avgRoundDuration: number
    preferredTiming: string
  }
  keyPlayers: Array<{
    playerId: string
    playerName: string
    role: 'entry' | 'support'
  }>
  sitePreferences: {
    [site: string]: {
      plants: number
      wins: number
    }
  }
  predictability: {
    score: number
    level: 'high' | 'medium' | 'low'
    exploitable: boolean
  }
  economyTendencies: {
    forceRate: number
  }
}

export interface CounterStrategy {
  target: string
  strategy: string
  details: string
  priority: 'high' | 'medium' | 'low'
}

export interface ScoutingReport {
  teamId: string
  teamName: string
  profile: ScoutingProfile
  counterStrategies: CounterStrategy[]
  keyTakeaways: string[]
}

// Task 5: Performance Benchmarking
export interface PerformanceBenchmark {
  value: number
  percentile: number
  tier: 'elite' | 'above_average' | 'average' | 'below_average' | 'unknown'
  benchmarks: {
    elite: number
    good: number
    average: number
  }
}

export interface PlayerBenchmark {
  playerId: string
  playerName: string
  metrics: {
    [metricName: string]: PerformanceBenchmark
  }
  overallPercentile: number
}

export interface TeamBenchmarks {
  metrics: {
    [metricName: string]: PerformanceBenchmark
  }
  overallPercentile: number
  overallTier: 'elite' | 'above_average' | 'average' | 'below_average'
}

export interface BenchmarkStat {
  teamId: string
  teamName: string
  teamBenchmarks: TeamBenchmarks
  playerBenchmarks: PlayerBenchmark[]
  areasAboveAverage: string[]
  areasForImprovement: string[]
}

// Task 6: Coaching Report Composer
export interface ExecutiveSummary {
  teamName: string
  seriesResult: string
  roundRecord: string
  roundWinRate: number
  mapsPlayed: number
  outcome: 'win' | 'loss'
}

export interface KeyMoment {
  type: 'critical_round' | 'swing_round'
  roundNumber: number
  reason?: string
  coachingFocus?: string
  probability?: number
  impact?: string
}

export interface ActionItem {
  priority: string
  action: string
  area: string
  expectedImpact: string
}

export interface CoachingReport {
  teamId: string
  teamName: string
  reportVersion: string
  sections: {
    executiveSummary: ExecutiveSummary
    keyMoments: KeyMoment[]
    strengthsAndWeaknesses: {
      strengths: TeamStrength[]
      weaknesses: TeamWeakness[]
    }
    benchmarks: TeamBenchmarks
    playerPerformance: PlayerBenchmark[]
    opponentScouting: ScoutingReport | null
    actionItems: ActionItem[]
  }
  generatedAt: string | null
}

// =============================================================================
// Sprint 6: Polish, ADR & Interactive Coaching
// =============================================================================

// Task A1: Damage/ADR Estimation
export interface PlayerDamageStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  estimatedDamage: number
  rounds: number
  adr: number
  kills: number
  damageRatio: number
  confidence: 'high' | 'medium' | 'low'
}

// Task A1: KAST Statistics
export interface KASTStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  rounds: number
  killRounds: number
  assistRounds: number
  survivedRounds: number
  tradedRounds: number
  kastRounds: number
  kastPercentage: number
}

// Task A1: ACS (Average Combat Score) Estimation
export interface ACSStat {
  playerId: string
  playerName: string
  teamId: string
  teamName: string
  estimatedACS: number
  components: {
    damageScore: number
    firstBloodScore: number
    multiKillScore: number
    clutchScore: number
  }
  rounds: number
  confidence: 'high' | 'medium' | 'low'
}

// Task A3: Item Event Tracking
export interface ItemEventStat {
  teamId: string
  teamName: string
  spikeDrops: number
  spikeDropsBeforePlant: number
  roundsWithSpikeDrop: number
  spikeRecoveryRate: number
}

// Task C1: Stat Significance
export interface SignificanceFilter {
  metricName: string
  minSampleSize: number
  currentSampleSize: number
  isSignificant: boolean
  confidence: 'high' | 'medium' | 'low'
}

// Task C2: Highlight Round
export interface HighlightRound {
  gameId: string
  roundNumber: number
  score: number
  factors: {
    ace: boolean
    fourK: boolean
    threeK: boolean
    clutchWin: boolean
    clutchAttempt: boolean
    econWin: boolean
    antiEcoLoss: boolean
    momentumShift: boolean
    matchPoint: boolean
  }
  primaryReason: string
  involvedPlayers: string[]
  recommendedForReview: boolean
}

export interface HighlightStats {
  topHighlights: HighlightRound[]
  totalHighlightRounds: number
  byCategory: {
    [category: string]: number
  }
}

// =============================================================================
// Main Evidence Structure
// =============================================================================

export interface EvidenceDerived {
  mapsStats: MapStat[]
  firstBloodStats: FirstBloodStat[]
  plantStats: PlantStat[]
  siteStats?: SiteStat[]
  clutchStats?: ClutchStat[]
  economyStats?: EconomyStat[]
  abilityStats?: AbilityStat[]
  tradeKills?: TradeKill[]
  tradeStats?: TradeStat[]
  openingDuelStats?: OpeningDuelStat[]
  multiKillRounds?: MultiKillRound[]
  multiKillStats?: MultiKillStat[]
  // Sprint 1: New analytics
  weaponStats?: WeaponStat[]
  engagementStats?: EngagementStat[]
  tempoStats?: TempoStat[]
  saveRoundStats?: SaveRoundStat[]
  antiEcoStats?: AntiEcoStat[]
  halfStats?: HalfStat[]
  // Sprint 2: Tactical Depth & Ability Analytics
  abilityCorrelations?: AbilityCorrelation[]
  abilityImpactStats?: AbilityImpactStat[]
  teamUtilityStats?: TeamUtilityStat[]
  postPlantStats?: PostPlantStats
  matchupStats?: MatchupStats
  mapControlStats?: MapControlStat[]
  // Sprint 3: Strategic Situational Analytics
  pistolStats?: PistolStat[]
  manAdvantageStats?: ManAdvantageStat[]
  retakeStats?: RetakeStat[]
  entryStats?: EntryStat[]
  spikeCarrierStats?: SpikeCarrierStat[]
  // Sprint 4: Pattern Recognition & Predictive Analytics
  streakStats?: MomentumStat[]
  criticalRounds?: CriticalRoundStat[]
  executePatternStats?: ExecutePatternStat[]
  performanceTrendStats?: PerformanceTrendStat[]
  compositionStats?: CompositionStat[]
  // Sprint 5: Advanced Intelligence & Coaching Automation
  winProbabilityStats?: WinProbabilityStat[]
  scenarioAnalysis?: ScenarioAnalysis[]
  coachingRecommendations?: CoachingRecommendationStat[]
  scoutingReports?: ScoutingReport[]
  benchmarkStats?: BenchmarkStat[]
  coachingReports?: CoachingReport[]
  // Sprint 6: Polish, ADR & Interactive Coaching
  playerDamageStats?: PlayerDamageStat[]
  kastStats?: KASTStat[]
  acsStats?: ACSStat[]
  itemEventStats?: ItemEventStat[]
  highlightStats?: HighlightStats
  significanceFilters?: SignificanceFilter[]
}

export interface EvidenceV1 {
  meta: {
    seriesId: string
    extractedAt: string
    version: string
    maxLinesProcessed?: number
    isoThreshold?: number
    filteredForGame?: string
    mapName?: string
  }
  games: GameInfo[]
  rounds: RoundInfo[]
  kills: KillEvent[]
  plants: PlantEvent[]
  defuses: DefuseEvent[]
  clutchSituations?: ClutchSituation[]
  economyRounds?: EconomyRound[]
  abilityUses?: AbilityUse[]
  players: PlayerInfo[]
  agentCompositions?: {
    [gameId: string]: AgentComposition[]
  }
  derived: EvidenceDerived
}

export interface EvidenceV1Meta {
  extractedAt: string
  version: string
  extractor?: string
}

// =============================================================================
// Utility Types
// =============================================================================

/** Helper to extract mapsStats with proper typing */
export function getMapsStats(evidence: EvidenceV1 | undefined | null): MapStat[] {
  return evidence?.derived?.mapsStats ?? []
}

import { PRIMARY_TEAM_ID, isPrimaryTeamId } from '@/lib/branding'

export { PRIMARY_TEAM_ID }

/** Check if a team ID belongs to the featured squad */
export function isPrimaryTeam(teamId: string): boolean {
  return isPrimaryTeamId(teamId)
}
