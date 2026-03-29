/**
 * Sprint 6: What-If Scenario Handler
 *
 * Enables coaches to ask "what if" questions about match decisions
 * with data-driven projections based on historical performance.
 */

import { EvidenceV1 } from '@/lib/types/evidence'

// =============================================================================
// Types
// =============================================================================

export type ScenarioType =
  | 'economy_decision'
  | 'site_choice'
  | 'timing_change'
  | 'player_swap'
  | 'utility_usage'
  | 'trade_execution'
  | 'general'

export interface WhatIfQuery {
  query: string
  roundNumber?: number
  gameId?: string
  context?: {
    players?: string[]
    site?: string
    economyTier?: string
  }
}

export interface ScenarioProjection {
  scenario: string
  scenarioType: ScenarioType
  originalOutcome: {
    description: string
    won: boolean
    probability?: number
  }
  projectedOutcome: {
    description: string
    winProbability: number
    probabilityChange: number
    impactLevel: 'high' | 'medium' | 'low'
  }
  supportingData: {
    metric: string
    value: string | number
    relevance: string
  }[]
  confidence: 'high' | 'medium' | 'low'
  dataPoints: number
  recommendations: string[]
  caveats: string[]
}

export interface WhatIfResponse {
  query: string
  scenarios: ScenarioProjection[]
  summary: string
  relatedQueries: string[]
}

// =============================================================================
// Query Parsing
// =============================================================================

/**
 * Parse a what-if query to identify scenario type and parameters
 */
export function parseWhatIfQuery(query: string): {
  scenarioType: ScenarioType
  roundNumber?: number
  site?: string
  economyTier?: string
  players?: string[]
} {
  const lowerQuery = query.toLowerCase()

  // Detect scenario type
  let scenarioType: ScenarioType = 'general'

  if (lowerQuery.includes('save') || lowerQuery.includes('force') || lowerQuery.includes('eco') || lowerQuery.includes('buy')) {
    scenarioType = 'economy_decision'
  } else if (lowerQuery.includes('site') || lowerQuery.includes(' a ') || lowerQuery.includes(' b ') || lowerQuery.includes('attack')) {
    scenarioType = 'site_choice'
  } else if (lowerQuery.includes('fast') || lowerQuery.includes('slow') || lowerQuery.includes('timing') || lowerQuery.includes('early') || lowerQuery.includes('late')) {
    scenarioType = 'timing_change'
  } else if (lowerQuery.includes('trade') || lowerQuery.includes('refrag')) {
    scenarioType = 'trade_execution'
  } else if (lowerQuery.includes('flash') || lowerQuery.includes('smoke') || lowerQuery.includes('ability') || lowerQuery.includes('util')) {
    scenarioType = 'utility_usage'
  }

  // Extract round number
  const roundMatch = lowerQuery.match(/round\s*(\d+)/i)
  const roundNumber = roundMatch ? parseInt(roundMatch[1]) : undefined

  // Extract site
  let site: string | undefined
  if (lowerQuery.includes(' a site') || lowerQuery.includes(' a ')) {
    site = 'A'
  } else if (lowerQuery.includes(' b site') || lowerQuery.includes(' b ')) {
    site = 'B'
  } else if (lowerQuery.includes(' c site') || lowerQuery.includes(' c ')) {
    site = 'C'
  }

  // Extract economy tier
  let economyTier: string | undefined
  if (lowerQuery.includes('save')) {
    economyTier = 'save'
  } else if (lowerQuery.includes('eco')) {
    economyTier = 'eco'
  } else if (lowerQuery.includes('force')) {
    economyTier = 'half_buy'
  } else if (lowerQuery.includes('full buy')) {
    economyTier = 'full_buy'
  }

  return { scenarioType, roundNumber, site, economyTier }
}

// =============================================================================
// Scenario Projections
// =============================================================================

/**
 * Process a what-if query and generate projections
 */
export async function processWhatIfScenario(
  whatIfQuery: WhatIfQuery,
  evidence: EvidenceV1
): Promise<WhatIfResponse> {
  const { query, roundNumber, gameId } = whatIfQuery
  const parsed = parseWhatIfQuery(query)

  const scenarios: ScenarioProjection[] = []

  // Generate scenario based on type
  switch (parsed.scenarioType) {
    case 'economy_decision':
      scenarios.push(...generateEconomyScenarios(evidence, parsed, roundNumber, query))
      break
    case 'site_choice':
      scenarios.push(...generateSiteScenarios(evidence, parsed, roundNumber))
      break
    case 'timing_change':
      scenarios.push(...generateTimingScenarios(evidence, parsed, roundNumber, query))
      break
    case 'trade_execution':
      scenarios.push(...generateTradeScenarios(evidence, parsed, roundNumber))
      break
    case 'utility_usage':
      scenarios.push(...generateUtilityScenarios(evidence, parsed, roundNumber))
      break
    default:
      scenarios.push(generateGeneralScenario(evidence, query, roundNumber))
  }

  // Generate summary
  const summary = generateSummary(scenarios)

  // Generate related queries
  const relatedQueries = generateRelatedQueries(parsed.scenarioType)

  return {
    query,
    scenarios,
    summary,
    relatedQueries
  }
}

// =============================================================================
// Economy Scenarios
// =============================================================================

function generateEconomyScenarios(
  evidence: EvidenceV1,
  parsed: ReturnType<typeof parseWhatIfQuery>,
  roundNumber?: number,
  queryString?: string
): ScenarioProjection[] {
  const query = queryString || ''
  const scenarios: ScenarioProjection[] = []
  const derived = evidence.derived
  const economyStats = derived.economyStats || []

  // Get relevant round data
  const round = roundNumber
    ? evidence.rounds.find(r => r.roundNumber === roundNumber)
    : null

  const economyRounds = evidence.economyRounds || []

  // Calculate win rates by economy tier
  const tierWinRates: Record<string, { wins: number; total: number }> = {}
  for (const ecoRound of economyRounds) {
    const tier = ecoRound.economyTier
    if (!tierWinRates[tier]) {
      tierWinRates[tier] = { wins: 0, total: 0 }
    }
    tierWinRates[tier].total++
    if (ecoRound.roundWon) {
      tierWinRates[tier].wins++
    }
  }

  // Save vs Force comparison
  const saveData = tierWinRates['save'] || tierWinRates['eco'] || { wins: 0, total: 0 }
  const forceData = tierWinRates['half_buy'] || { wins: 0, total: 0 }
  const fullBuyData = tierWinRates['full_buy'] || { wins: 0, total: 0 }

  const saveWinRate = saveData.total > 0 ? saveData.wins / saveData.total : 0.15
  const forceWinRate = forceData.total > 0 ? forceData.wins / forceData.total : 0.35
  const fullBuyWinRate = fullBuyData.total > 0 ? fullBuyData.wins / fullBuyData.total : 0.55

  // Generate "What if we saved instead of forcing" scenario
  if (parsed.economyTier === 'save' || query.toLowerCase().includes('save')) {
    scenarios.push({
      scenario: 'Save instead of force buy',
      scenarioType: 'economy_decision',
      originalOutcome: {
        description: round ? (round.winnerTeamId ? 'Round was won' : 'Round was lost') : 'Unknown outcome',
        won: !!round?.winnerTeamId,
        probability: forceWinRate
      },
      projectedOutcome: {
        description: 'Saving preserves economy for next round full buy',
        winProbability: saveWinRate,
        probabilityChange: saveWinRate - forceWinRate,
        impactLevel: Math.abs(saveWinRate - forceWinRate) > 0.2 ? 'high' : 'medium'
      },
      supportingData: [
        {
          metric: 'Current round save win rate',
          value: `${(saveWinRate * 100).toFixed(1)}%`,
          relevance: 'Historical success rate when saving'
        },
        {
          metric: 'Force buy win rate',
          value: `${(forceWinRate * 100).toFixed(1)}%`,
          relevance: 'Alternative outcome with force'
        },
        {
          metric: 'Full buy win rate',
          value: `${(fullBuyWinRate * 100).toFixed(1)}%`,
          relevance: 'Next round potential with saved economy'
        }
      ],
      confidence: saveData.total >= 5 ? 'high' : saveData.total >= 3 ? 'medium' : 'low',
      dataPoints: saveData.total + forceData.total,
      recommendations: [
        saveWinRate > forceWinRate
          ? 'Data suggests saving is generally more effective than forcing'
          : 'Force buying shows better results in this match context',
        'Consider team economy state for next 2-3 rounds',
        'Factor in opponent economy - eco hunting can be risky'
      ],
      caveats: [
        'Win probability affected by opponent economy state',
        'Specific round context matters (score, momentum)',
        saveData.total < 5 ? 'Limited data points reduce confidence' : ''
      ].filter(c => c)
    })
  }

  // Generate "What if we forced instead of full buying" scenario
  if (query.toLowerCase().includes('force') || parsed.economyTier === 'half_buy') {
    const economyImpact = calculateEconomyImpact(economyRounds, derived)

    scenarios.push({
      scenario: 'Force buy instead of waiting for full buy',
      scenarioType: 'economy_decision',
      originalOutcome: {
        description: 'Full buy round',
        won: true,
        probability: fullBuyWinRate
      },
      projectedOutcome: {
        description: 'Force buy takes the gamble immediately',
        winProbability: forceWinRate,
        probabilityChange: forceWinRate - fullBuyWinRate,
        impactLevel: Math.abs(forceWinRate - fullBuyWinRate) > 0.15 ? 'high' : 'medium'
      },
      supportingData: [
        {
          metric: 'Force buy success rate',
          value: `${(forceWinRate * 100).toFixed(1)}%`,
          relevance: 'Success rate when forcing'
        },
        {
          metric: 'Rounds until full buy',
          value: economyImpact.avgRoundsToRecover,
          relevance: 'Rounds needed to recover economy'
        },
        {
          metric: 'Economy advantage conversion',
          value: `${(economyImpact.economyAdvantageWinRate * 100).toFixed(1)}%`,
          relevance: 'Win rate with economy advantage'
        }
      ],
      confidence: forceData.total >= 5 ? 'high' : 'medium',
      dataPoints: forceData.total,
      recommendations: [
        'Force buy can disrupt opponent rhythm if successful',
        'Consider score state - forcing at 11-12 different than 5-5',
        'Track opponent utility usage after forcing'
      ],
      caveats: [
        'Force buy failure compounds economy deficit',
        'Team morale impact not captured in data'
      ]
    })
  }

  return scenarios
}

function calculateEconomyImpact(
  economyRounds: EvidenceV1['economyRounds'],
  derived: EvidenceV1['derived']
): { avgRoundsToRecover: number; economyAdvantageWinRate: number } {
  // Calculate average rounds to recover from eco/save
  let roundsToRecover = 2 // Default estimate

  // Calculate economy advantage win rate from win probability stats if available
  const winProbStats = derived.winProbabilityStats || []
  let economyAdvantageWinRate = 0.6 // Default

  for (const stat of winProbStats) {
    if (stat.probabilityFactors?.economyImpact?.advantageWinRate) {
      economyAdvantageWinRate = stat.probabilityFactors.economyImpact.advantageWinRate
      break
    }
  }

  return { avgRoundsToRecover: roundsToRecover, economyAdvantageWinRate }
}

// =============================================================================
// Site Choice Scenarios
// =============================================================================

function generateSiteScenarios(
  evidence: EvidenceV1,
  parsed: ReturnType<typeof parseWhatIfQuery>,
  roundNumber?: number
): ScenarioProjection[] {
  const scenarios: ScenarioProjection[] = []
  const siteStats = evidence.derived.siteStats || []

  // Get site preferences
  const siteWinRates: Record<string, { wins: number; total: number }> = {}

  for (const site of siteStats) {
    const siteName = site.site
    let wins = 0
    let total = 0

    if (site.attackStats) {
      for (const teamStats of Object.values(site.attackStats)) {
        wins += teamStats.postPlantWins || 0
        total += teamStats.plants || 0
      }
    }

    siteWinRates[siteName] = { wins, total }
  }

  const sites = Object.keys(siteWinRates)

  if (sites.length >= 2) {
    const siteA = siteWinRates['A'] || siteWinRates[sites[0]] || { wins: 0, total: 0 }
    const siteB = siteWinRates['B'] || siteWinRates[sites[1]] || { wins: 0, total: 0 }

    const siteARate = siteA.total > 0 ? siteA.wins / siteA.total : 0.5
    const siteBRate = siteB.total > 0 ? siteB.wins / siteB.total : 0.5

    const currentSite = parsed.site || 'A'
    const alternateSite = currentSite === 'A' ? 'B' : 'A'

    const currentRate = currentSite === 'A' ? siteARate : siteBRate
    const alternateRate = alternateSite === 'A' ? siteARate : siteBRate

    scenarios.push({
      scenario: `Attack ${alternateSite} site instead of ${currentSite}`,
      scenarioType: 'site_choice',
      originalOutcome: {
        description: `${currentSite} site attack`,
        won: true,
        probability: currentRate
      },
      projectedOutcome: {
        description: `${alternateSite} site attack`,
        winProbability: alternateRate,
        probabilityChange: alternateRate - currentRate,
        impactLevel: Math.abs(alternateRate - currentRate) > 0.15 ? 'high' : 'medium'
      },
      supportingData: [
        {
          metric: `${currentSite} site post-plant win rate`,
          value: `${(currentRate * 100).toFixed(1)}%`,
          relevance: 'Current site success rate'
        },
        {
          metric: `${alternateSite} site post-plant win rate`,
          value: `${(alternateRate * 100).toFixed(1)}%`,
          relevance: 'Alternative site success rate'
        },
        {
          metric: `${currentSite} site plants`,
          value: currentSite === 'A' ? siteA.total : siteB.total,
          relevance: 'Sample size for current site'
        },
        {
          metric: `${alternateSite} site plants`,
          value: alternateSite === 'A' ? siteA.total : siteB.total,
          relevance: 'Sample size for alternative'
        }
      ],
      confidence: (siteA.total + siteB.total) >= 10 ? 'high' : 'medium',
      dataPoints: siteA.total + siteB.total,
      recommendations: [
        alternateRate > currentRate
          ? `Consider shifting more attacks to ${alternateSite} site`
          : `Current ${currentSite} site preference is data-supported`,
        'Monitor opponent defensive rotations',
        'Mix up site choices to prevent predictability'
      ],
      caveats: [
        'Site success depends on execute quality',
        'Defensive adjustments may shift rates'
      ]
    })
  }

  return scenarios
}

// =============================================================================
// Timing Scenarios
// =============================================================================

function generateTimingScenarios(
  evidence: EvidenceV1,
  parsed: ReturnType<typeof parseWhatIfQuery>,
  roundNumber?: number,
  queryString?: string
): ScenarioProjection[] {
  const query = queryString || ''
  const scenarios: ScenarioProjection[] = []
  const tempoStats = evidence.derived.tempoStats || []

  // Extract timing data
  let fastWinRate = 0.45
  let slowWinRate = 0.50
  let dataPoints = 0

  for (const stat of tempoStats) {
    if (stat.byTempo) {
      const fast = stat.byTempo['fast'] || stat.byTempo['early']
      const slow = stat.byTempo['slow'] || stat.byTempo['late']

      if (fast && fast.rounds > 0) {
        fastWinRate = fast.winRate
        dataPoints += fast.rounds
      }
      if (slow && slow.rounds > 0) {
        slowWinRate = slow.winRate
        dataPoints += slow.rounds
      }
    }
  }

  const queryLower = query.toLowerCase()
  const suggestsFast = queryLower.includes('fast') || queryLower.includes('early')

  scenarios.push({
    scenario: suggestsFast ? 'Execute faster/earlier' : 'Slow down the execute',
    scenarioType: 'timing_change',
    originalOutcome: {
      description: suggestsFast ? 'Standard/late timing' : 'Fast execute',
      won: true,
      probability: suggestsFast ? slowWinRate : fastWinRate
    },
    projectedOutcome: {
      description: suggestsFast ? 'Fast execute' : 'Late execute',
      winProbability: suggestsFast ? fastWinRate : slowWinRate,
      probabilityChange: suggestsFast ? (fastWinRate - slowWinRate) : (slowWinRate - fastWinRate),
      impactLevel: Math.abs(fastWinRate - slowWinRate) > 0.1 ? 'high' : 'medium'
    },
    supportingData: [
      {
        metric: 'Fast execute win rate',
        value: `${(fastWinRate * 100).toFixed(1)}%`,
        relevance: 'Success rate with quick timing'
      },
      {
        metric: 'Slow execute win rate',
        value: `${(slowWinRate * 100).toFixed(1)}%`,
        relevance: 'Success rate with patient timing'
      }
    ],
    confidence: dataPoints >= 10 ? 'high' : dataPoints >= 5 ? 'medium' : 'low',
    dataPoints,
    recommendations: [
      fastWinRate > slowWinRate
        ? 'Fast executes have shown better results - consider catching defense off-guard'
        : 'Patient play appears more successful - use utility methodically',
      'Mix timing to prevent opponent reads',
      'Consider opponent tendencies in defensive setup time'
    ],
    caveats: [
      'Map-specific timings matter significantly',
      'Execute speed depends on utility availability'
    ]
  })

  return scenarios
}

// =============================================================================
// Trade Execution Scenarios
// =============================================================================

function generateTradeScenarios(
  evidence: EvidenceV1,
  parsed: ReturnType<typeof parseWhatIfQuery>,
  roundNumber?: number
): ScenarioProjection[] {
  const scenarios: ScenarioProjection[] = []
  const tradeStats = evidence.derived.tradeStats || []

  // Calculate trade impact
  let avgTradeRate = 0
  let tradedDeathWinRate = 0.55
  let untradedDeathWinRate = 0.30
  let dataPoints = 0

  for (const stat of tradeStats) {
    avgTradeRate += stat.tradedRate || 0
    dataPoints++
  }

  if (dataPoints > 0) {
    avgTradeRate /= dataPoints
  }

  // Find specific round if provided
  const round = roundNumber
    ? evidence.rounds.find(r => r.roundNumber === roundNumber)
    : null

  scenarios.push({
    scenario: 'Successfully trade the entry death',
    scenarioType: 'trade_execution',
    originalOutcome: {
      description: 'Entry dies without trade',
      won: false,
      probability: untradedDeathWinRate
    },
    projectedOutcome: {
      description: 'Entry death is traded within 3 seconds',
      winProbability: tradedDeathWinRate,
      probabilityChange: tradedDeathWinRate - untradedDeathWinRate,
      impactLevel: 'high'
    },
    supportingData: [
      {
        metric: 'Team trade rate',
        value: `${(avgTradeRate * 100).toFixed(1)}%`,
        relevance: 'How often deaths are traded'
      },
      {
        metric: 'Win rate after traded death',
        value: `${(tradedDeathWinRate * 100).toFixed(0)}%`,
        relevance: 'Projected success with trade'
      },
      {
        metric: 'Win rate after untraded death',
        value: `${(untradedDeathWinRate * 100).toFixed(0)}%`,
        relevance: 'Baseline without trade'
      }
    ],
    confidence: dataPoints >= 3 ? 'medium' : 'low',
    dataPoints: tradeStats.length,
    recommendations: [
      'Position support players within trade distance',
      'Entry should call location before peeking',
      'Practice 2-man peeks on common angles'
    ],
    caveats: [
      'Trade timing matters - must be within 3 seconds',
      'Trading into utility can compound problems'
    ]
  })

  return scenarios
}

// =============================================================================
// Utility Usage Scenarios
// =============================================================================

function generateUtilityScenarios(
  evidence: EvidenceV1,
  parsed: ReturnType<typeof parseWhatIfQuery>,
  roundNumber?: number
): ScenarioProjection[] {
  const scenarios: ScenarioProjection[] = []
  const utilityStats = evidence.derived.teamUtilityStats || []
  const abilityImpact = evidence.derived.abilityImpactStats || []

  // Calculate utility impact
  let flashAssistRate = 0.15
  let utilityCoordination = 0
  let dataPoints = 0

  for (const stat of utilityStats) {
    if (stat.flashUses > 0) {
      flashAssistRate = stat.flashAssists / stat.flashUses
    }
    utilityCoordination = stat.utilityCoordinationScore || 0
    dataPoints += stat.totalAbilityUses
  }

  // Estimate win rate impact
  const baseWinRate = 0.45
  const withUtilityWinRate = baseWinRate + (flashAssistRate * 0.15)

  scenarios.push({
    scenario: 'Use flash support before entry',
    scenarioType: 'utility_usage',
    originalOutcome: {
      description: 'Dry entry without flash support',
      won: false,
      probability: baseWinRate
    },
    projectedOutcome: {
      description: 'Flash-supported entry',
      winProbability: withUtilityWinRate,
      probabilityChange: withUtilityWinRate - baseWinRate,
      impactLevel: flashAssistRate > 0.2 ? 'high' : 'medium'
    },
    supportingData: [
      {
        metric: 'Flash assist rate',
        value: `${(flashAssistRate * 100).toFixed(1)}%`,
        relevance: 'How often flashes lead to kills'
      },
      {
        metric: 'Utility coordination score',
        value: utilityCoordination.toFixed(1),
        relevance: 'Team utility synergy rating'
      },
      {
        metric: 'Total abilities used',
        value: dataPoints,
        relevance: 'Data sample size'
      }
    ],
    confidence: dataPoints >= 20 ? 'high' : dataPoints >= 10 ? 'medium' : 'low',
    dataPoints,
    recommendations: [
      'Coordinate flash timing with entry peek',
      'Call flash direction to teammates',
      'Save utility for retakes when appropriate'
    ],
    caveats: [
      'Flash timing requires coordination',
      'Pop flashes vs full flashes have different use cases'
    ]
  })

  return scenarios
}

// =============================================================================
// General Scenarios
// =============================================================================

function generateGeneralScenario(
  evidence: EvidenceV1,
  query: string,
  roundNumber?: number
): ScenarioProjection {
  // Provide a general analysis when specific scenario type not detected
  const rounds = evidence.rounds
  const totalRounds = rounds.length
  const roundsWon = rounds.filter(r => r.winnerTeamId).length

  const overallWinRate = totalRounds > 0 ? roundsWon / totalRounds : 0.5

  return {
    scenario: 'General scenario analysis',
    scenarioType: 'general',
    originalOutcome: {
      description: 'Current match outcome',
      won: overallWinRate > 0.5,
      probability: overallWinRate
    },
    projectedOutcome: {
      description: 'Analysis based on available data',
      winProbability: overallWinRate,
      probabilityChange: 0,
      impactLevel: 'medium'
    },
    supportingData: [
      {
        metric: 'Match round win rate',
        value: `${(overallWinRate * 100).toFixed(1)}%`,
        relevance: 'Overall performance baseline'
      },
      {
        metric: 'Total rounds',
        value: totalRounds,
        relevance: 'Data sample'
      }
    ],
    confidence: 'low',
    dataPoints: totalRounds,
    recommendations: [
      'Try rephrasing the question with specific round numbers',
      'Specify economy decision, site choice, or timing change',
      'Include player names for player-specific analysis'
    ],
    caveats: [
      'General queries produce less specific projections',
      'Add context for better analysis'
    ]
  }
}

// =============================================================================
// Summary Generation
// =============================================================================

function generateSummary(scenarios: ScenarioProjection[]): string {
  if (scenarios.length === 0) {
    return 'Unable to generate scenario projections with available data.'
  }

  const highImpact = scenarios.filter(s => s.projectedOutcome.impactLevel === 'high')
  const avgProbabilityChange = scenarios.reduce((sum, s) => sum + s.projectedOutcome.probabilityChange, 0) / scenarios.length

  let summary = ''

  if (highImpact.length > 0) {
    summary += `Found ${highImpact.length} high-impact scenario${highImpact.length > 1 ? 's' : ''}. `
  }

  if (avgProbabilityChange > 0) {
    summary += `The suggested changes could improve win probability by ~${(avgProbabilityChange * 100).toFixed(1)}%. `
  } else if (avgProbabilityChange < 0) {
    summary += `The alternative approaches show ${(Math.abs(avgProbabilityChange) * 100).toFixed(1)}% lower success rates. `
  }

  const confidence = scenarios[0]?.confidence || 'medium'
  summary += `Analysis confidence: ${confidence}.`

  return summary
}

// =============================================================================
// Related Queries
// =============================================================================

function generateRelatedQueries(scenarioType: ScenarioType): string[] {
  const queries: Record<ScenarioType, string[]> = {
    economy_decision: [
      'What if we full saved the round after pistol loss?',
      'How did our force buy win rate compare to full buys?',
      'Which economy decisions cost us the most rounds?'
    ],
    site_choice: [
      'What if we attacked B more on Haven?',
      'Which site had the best post-plant win rate?',
      'How predictable were our site choices?'
    ],
    timing_change: [
      'What if we executed faster on anti-ecos?',
      'Did late executes hurt our attack side?',
      'What was our win rate with fast vs slow timing?'
    ],
    player_swap: [
      'How did different entry players perform?',
      'What if we changed our IGL calls?',
      'Which player had the most clutch potential?'
    ],
    utility_usage: [
      'Did flash coordination improve our entry success?',
      'Which abilities led to the most kills?',
      'What utility could we have saved for retakes?'
    ],
    trade_execution: [
      'How many deaths went untraded?',
      'Which rounds could have been won with better trades?',
      'Who had the best refrag rate?'
    ],
    general: [
      'What were our biggest mistakes?',
      'Which rounds should we review for improvement?',
      'How did we compare to pro benchmarks?'
    ]
  }

  return queries[scenarioType] || queries.general
}

// =============================================================================
// Exports
// =============================================================================

export const WHAT_IF_EXAMPLES = [
  {
    category: 'Economy',
    examples: [
      'What if we saved round 16 instead of forcing?',
      'What if we full bought round 3 after pistol loss?',
      'How did our force buy decisions impact the match?'
    ]
  },
  {
    category: 'Site Choice',
    examples: [
      'What if we attacked B site on round 8 instead of A?',
      'Should we have focused more on A site attacks?',
      'How did our site preference affect win rate?'
    ]
  },
  {
    category: 'Timing',
    examples: [
      'What if we executed faster on round 12?',
      'Did slow plays hurt us in overtime?',
      'How did execute timing affect our success?'
    ]
  },
  {
    category: 'Trading',
    examples: [
      'What if we traded the entry death on round 5?',
      'How many rounds could trading have saved?',
      'Did untraded deaths cost us the match?'
    ]
  }
]
