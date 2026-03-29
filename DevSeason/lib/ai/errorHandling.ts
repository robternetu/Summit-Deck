/**
 * Sprint 6: Error Handling and Fallbacks
 *
 * Provides graceful degradation when LLM calls fail or data is unavailable.
 * Generates fallback responses using rule-based analysis.
 */

import { EvidenceV1 } from '@/lib/types/evidence'
import type { CoachQueryResponse, DataPoint } from './interactiveCoach'

// =============================================================================
// Types
// =============================================================================

export interface ErrorContext {
  errorType: 'llm_unavailable' | 'timeout' | 'rate_limit' | 'invalid_response' | 'missing_data' | 'unknown'
  originalError?: Error
  queryType?: string
  retryCount?: number
}

export interface FallbackOptions {
  useRuleBasedAnalysis?: boolean
  includePlaceholders?: boolean
  verbosity?: 'minimal' | 'standard' | 'detailed'
}

export interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
}

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Classify an error into a known type
 */
export function classifyError(error: unknown): ErrorContext {
  if (!error) {
    return { errorType: 'unknown' }
  }

  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  // Rate limit errors
  if (errorMessage.includes('rate limit') || errorMessage.includes('429') || errorMessage.includes('too many requests')) {
    return {
      errorType: 'rate_limit',
      originalError: error instanceof Error ? error : new Error(String(error))
    }
  }

  // Timeout errors
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorMessage.includes('etimedout')) {
    return {
      errorType: 'timeout',
      originalError: error instanceof Error ? error : new Error(String(error))
    }
  }

  // LLM unavailable
  if (errorMessage.includes('service unavailable') || errorMessage.includes('503') || errorMessage.includes('anthropic') || errorMessage.includes('openai')) {
    return {
      errorType: 'llm_unavailable',
      originalError: error instanceof Error ? error : new Error(String(error))
    }
  }

  // Invalid response
  if (errorMessage.includes('invalid') || errorMessage.includes('parse') || errorMessage.includes('json')) {
    return {
      errorType: 'invalid_response',
      originalError: error instanceof Error ? error : new Error(String(error))
    }
  }

  // Missing data
  if (errorMessage.includes('not found') || errorMessage.includes('missing') || errorMessage.includes('undefined')) {
    return {
      errorType: 'missing_data',
      originalError: error instanceof Error ? error : new Error(String(error))
    }
  }

  return {
    errorType: 'unknown',
    originalError: error instanceof Error ? error : new Error(String(error))
  }
}

// =============================================================================
// Retry Logic
// =============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, backoffMultiplier } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const context = classifyError(error)

      // Don't retry on certain error types
      if (context.errorType === 'missing_data' || context.errorType === 'invalid_response') {
        throw lastError
      }

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs)

        // Add jitter
        const jitter = delay * 0.1 * Math.random()

        await new Promise(resolve => setTimeout(resolve, delay + jitter))
      }
    }
  }

  throw lastError
}

// =============================================================================
// Fallback Response Generation
// =============================================================================

/**
 * Generate a fallback coach response when LLM is unavailable
 */
export function generateFallbackResponse(
  query: string,
  queryType: string,
  evidence: EvidenceV1,
  errorContext: ErrorContext,
  options: FallbackOptions = {}
): CoachQueryResponse {
  const { verbosity = 'standard' } = options

  // Extract basic stats for rule-based analysis
  const dataPoints = extractKeyDataPoints(evidence)
  const insight = generateRuleBasedInsight(queryType, evidence)
  const recommendations = generateRuleBasedRecommendations(queryType, evidence)

  // Build answer based on query type
  let answer = ''

  switch (queryType) {
    case 'general':
      answer = generateGeneralFallback(evidence, dataPoints, verbosity)
      break
    case 'what_if':
      answer = generateWhatIfFallback(evidence, dataPoints, verbosity)
      break
    case 'player_focus':
      answer = generatePlayerFallback(evidence, dataPoints, verbosity)
      break
    case 'tactical':
      answer = generateTacticalFallback(evidence, dataPoints, verbosity)
      break
    case 'comparison':
      answer = generateComparisonFallback(evidence, dataPoints, verbosity)
      break
    default:
      answer = generateGeneralFallback(evidence, dataPoints, verbosity)
  }

  // Add error context note
  const errorNote = getErrorNote(errorContext)

  return {
    answer: answer + (errorNote ? `\n\n*${errorNote}*` : ''),
    evidence: {
      dataPoints,
      relevantRounds: extractRelevantRounds(evidence, queryType),
      relevantPlayers: extractRelevantPlayers(evidence, queryType)
    },
    insight,
    recommendations,
    confidence: 'low',
    suggestedFollowUps: getDefaultFollowUps(queryType)
  }
}

/**
 * Extract key data points from evidence for fallback response
 */
function extractKeyDataPoints(evidence: EvidenceV1): DataPoint[] {
  const dataPoints: DataPoint[] = []
  const derived = evidence.derived

  // First blood stats
  if (derived.firstBloodStats?.length) {
    for (const fb of derived.firstBloodStats) {
      dataPoints.push({
        metric: `${fb.teamName} First Blood Rate`,
        value: `${((fb.firstBloodRate || 0) * 100).toFixed(1)}%`,
        context: `${fb.firstBloods} first bloods total`
      })
    }
  }

  // Clutch performance
  const clutchStats = derived.clutchStats || []
  const totalClutchAttempts = clutchStats.reduce((sum, c) => sum + (c.clutchAttempts || 0), 0)
  const totalClutchWins = clutchStats.reduce((sum, c) => sum + (c.clutchWins || 0), 0)

  if (totalClutchAttempts > 0) {
    dataPoints.push({
      metric: 'Overall Clutch Rate',
      value: `${totalClutchWins}/${totalClutchAttempts}`,
      context: `${((totalClutchWins / totalClutchAttempts) * 100).toFixed(1)}% success rate`
    })
  }

  // Trade stats
  const tradeStats = derived.tradeStats || []
  if (tradeStats.length > 0) {
    const avgTradeRate = tradeStats.reduce((sum, t) => sum + (t.tradedRate || 0), 0) / tradeStats.length
    dataPoints.push({
      metric: 'Average Trade Rate',
      value: `${(avgTradeRate * 100).toFixed(1)}%`,
      context: 'Deaths that were traded'
    })
  }

  // Round totals
  const rounds = evidence.rounds || []
  const totalRounds = rounds.length

  if (totalRounds > 0) {
    dataPoints.push({
      metric: 'Total Rounds Played',
      value: totalRounds,
      context: 'Across all games in the series'
    })
  }

  return dataPoints
}

/**
 * Generate general fallback answer
 */
function generateGeneralFallback(
  evidence: EvidenceV1,
  dataPoints: DataPoint[],
  verbosity: 'minimal' | 'standard' | 'detailed'
): string {
  const derived = evidence.derived
  const rounds = evidence.rounds || []

  let answer = '**Match Analysis (Rule-Based)**\n\n'

  if (verbosity === 'minimal') {
    answer += `Analyzed ${rounds.length} rounds. Key stats extracted from match data.\n`
  } else {
    answer += `Based on analysis of ${rounds.length} rounds across ${evidence.games?.length || 1} game(s):\n\n`

    // First blood summary
    if (derived.firstBloodStats?.length) {
      const bestFB = derived.firstBloodStats.reduce((best, curr) =>
        (curr.conversionRate || 0) > (best.conversionRate || 0) ? curr : best
      )
      answer += `- **First Blood**: ${bestFB.teamName} had better FB conversion at ${((bestFB.conversionRate || 0) * 100).toFixed(1)}%\n`
    }

    // Clutch summary
    if (derived.clutchStats?.length) {
      const bestClutcher = derived.clutchStats.reduce((best, curr) =>
        (curr.clutchWins || 0) > (best.clutchWins || 0) ? curr : best
      )
      if (bestClutcher.clutchWins > 0) {
        answer += `- **Clutch King**: ${bestClutcher.playerName} with ${bestClutcher.clutchWins} clutch wins\n`
      }
    }

    if (verbosity === 'detailed') {
      // Add more detail
      if (derived.tradeStats?.length) {
        const bestTrader = derived.tradeStats.reduce((best, curr) =>
          (curr.tradesGotten || 0) > (best.tradesGotten || 0) ? curr : best
        )
        if (bestTrader.tradesGotten > 0) {
          answer += `- **Best Refrag**: ${bestTrader.playerName} with ${bestTrader.tradesGotten} trades\n`
        }
      }
    }
  }

  return answer
}

/**
 * Generate what-if fallback answer
 */
function generateWhatIfFallback(
  evidence: EvidenceV1,
  dataPoints: DataPoint[],
  verbosity: 'minimal' | 'standard' | 'detailed'
): string {
  const derived = evidence.derived

  let answer = '**Scenario Analysis (Rule-Based)**\n\n'
  answer += 'Unable to run full AI scenario analysis. Here are key economic metrics:\n\n'

  // Economy stats
  if (derived.economyStats?.length) {
    for (const eco of derived.economyStats) {
      const forceBuyWR = eco.byTier?.half_buy?.winRate || 0
      const fullBuyWR = eco.byTier?.full_buy?.winRate || 0

      answer += `- **${eco.teamName}**: Force buy WR ${(forceBuyWR * 100).toFixed(0)}%, Full buy WR ${(fullBuyWR * 100).toFixed(0)}%\n`
    }
  }

  answer += '\n*For detailed scenario projections, try again when the AI service is available.*'

  return answer
}

/**
 * Generate player-focused fallback answer
 */
function generatePlayerFallback(
  evidence: EvidenceV1,
  dataPoints: DataPoint[],
  verbosity: 'minimal' | 'standard' | 'detailed'
): string {
  const players = evidence.players || []

  let answer = '**Player Performance (Rule-Based)**\n\n'

  // Sort by K/D
  const sortedPlayers = [...players].sort((a, b) => (b.kd || 0) - (a.kd || 0))

  for (const player of sortedPlayers.slice(0, 5)) {
    answer += `- **${player.playerName || player.playerId}**: ${player.kills}K/${player.deaths}D (${player.kd?.toFixed(2) || 'N/A'} K/D), ${player.firstBloods} FBs\n`
  }

  return answer
}

/**
 * Generate tactical fallback answer
 */
function generateTacticalFallback(
  evidence: EvidenceV1,
  dataPoints: DataPoint[],
  verbosity: 'minimal' | 'standard' | 'detailed'
): string {
  const derived = evidence.derived

  let answer = '**Tactical Analysis (Rule-Based)**\n\n'

  // Site stats
  if (derived.siteStats?.length) {
    answer += '**Site Performance:**\n'
    for (const site of derived.siteStats) {
      let attackWR = 0
      let defenseWR = 0

      if (site.attackStats) {
        const values = Object.values(site.attackStats)
        if (values.length > 0) {
          attackWR = values.reduce((sum, s) => sum + (s.postPlantWinRate || 0), 0) / values.length
        }
      }

      if (site.defenseStats) {
        const values = Object.values(site.defenseStats)
        if (values.length > 0) {
          defenseWR = values.reduce((sum, s) => sum + (s.defenseWinRate || 0), 0) / values.length
        }
      }

      answer += `- **${site.site}**: Attack ${(attackWR * 100).toFixed(0)}%, Defense ${(defenseWR * 100).toFixed(0)}%\n`
    }
  }

  // Execute patterns
  if (derived.executePatternStats?.length) {
    answer += '\n**Execute Patterns:**\n'
    for (const pattern of derived.executePatternStats) {
      answer += `- ${pattern.teamName}: Predictability ${(pattern.predictabilityScore || 0).toFixed(0)}%\n`
    }
  }

  return answer
}

/**
 * Generate comparison fallback answer
 */
function generateComparisonFallback(
  evidence: EvidenceV1,
  dataPoints: DataPoint[],
  verbosity: 'minimal' | 'standard' | 'detailed'
): string {
  const derived = evidence.derived

  let answer = '**Performance Comparison (Rule-Based)**\n\n'

  // Benchmark stats if available
  if (derived.benchmarkStats?.length) {
    for (const bench of derived.benchmarkStats) {
      answer += `**${bench.teamName}:**\n`
      answer += `- Overall Tier: ${bench.teamBenchmarks?.overallTier || 'Unknown'}\n`

      if (bench.areasAboveAverage?.length) {
        answer += `- Strengths: ${bench.areasAboveAverage.slice(0, 3).join(', ')}\n`
      }
      if (bench.areasForImprovement?.length) {
        answer += `- Improve: ${bench.areasForImprovement.slice(0, 3).join(', ')}\n`
      }
    }
  } else {
    answer += 'Benchmark comparison data not available for this match.\n'
    answer += 'Run the full evidence pipeline to generate benchmarks.'
  }

  return answer
}

/**
 * Generate rule-based insight
 */
function generateRuleBasedInsight(queryType: string, evidence: EvidenceV1): string {
  const derived = evidence.derived

  // Find standout metrics
  const insights: string[] = []

  // Check first blood conversion
  if (derived.firstBloodStats?.length) {
    for (const fb of derived.firstBloodStats) {
      if ((fb.conversionRate || 0) > 0.75) {
        insights.push(`${fb.teamName} excellently converted first bloods into round wins.`)
      } else if ((fb.conversionRate || 0) < 0.45) {
        insights.push(`${fb.teamName} struggled to close out rounds after getting first blood.`)
      }
    }
  }

  // Check clutch performance
  const clutchStats = derived.clutchStats || []
  const totalClutchRate = clutchStats.length > 0
    ? clutchStats.reduce((sum, c) => sum + (c.clutchRate || 0), 0) / clutchStats.length
    : 0

  if (totalClutchRate > 0.35) {
    insights.push('Strong clutch performance indicates good individual skill under pressure.')
  } else if (totalClutchRate < 0.15 && clutchStats.length > 0) {
    insights.push('Low clutch success suggests need to improve late-round decision-making.')
  }

  return insights.length > 0
    ? insights.join(' ')
    : 'Based on available data, no major outliers detected. Consider reviewing round-by-round play.'
}

/**
 * Generate rule-based recommendations
 */
function generateRuleBasedRecommendations(queryType: string, evidence: EvidenceV1): string[] {
  const derived = evidence.derived
  const recommendations: string[] = []

  // First blood recommendations
  if (derived.firstBloodStats?.length) {
    const lowConversion = derived.firstBloodStats.find(fb => (fb.conversionRate || 0) < 0.5)
    if (lowConversion) {
      recommendations.push(`Focus on post-FB setups to improve ${lowConversion.teamName}'s conversion rate`)
    }
  }

  // Trade recommendations
  if (derived.tradeStats?.length) {
    const avgTradeRate = derived.tradeStats.reduce((sum, t) => sum + (t.tradedRate || 0), 0) / derived.tradeStats.length
    if (avgTradeRate < 0.5) {
      recommendations.push('Improve positioning for trade opportunities - many deaths went untraded')
    }
  }

  // Default recommendations
  if (recommendations.length === 0) {
    recommendations.push('Review highlight rounds for specific improvement areas')
    recommendations.push('Analyze opponent patterns for counter-strategy development')
  }

  return recommendations.slice(0, 3)
}

/**
 * Extract relevant rounds for the query type
 */
function extractRelevantRounds(evidence: EvidenceV1, queryType: string): number[] {
  const rounds: number[] = []
  const derived = evidence.derived

  // Get critical rounds
  if (derived.criticalRounds?.length) {
    for (const cr of derived.criticalRounds) {
      for (const tr of (cr.topReviewRounds || []).slice(0, 3)) {
        rounds.push(tr.roundNumber)
      }
    }
  }

  return [...new Set(rounds)].slice(0, 5)
}

/**
 * Extract relevant players for the query type
 */
function extractRelevantPlayers(evidence: EvidenceV1, queryType: string): string[] {
  const players = evidence.players || []

  // Sort by kills and return top performers
  return [...players]
    .sort((a, b) => (b.kills || 0) - (a.kills || 0))
    .slice(0, 3)
    .map(p => p.playerName || p.playerId)
}

/**
 * Get error-specific note
 */
function getErrorNote(context: ErrorContext): string {
  const notes: Record<ErrorContext['errorType'], string> = {
    llm_unavailable: 'AI service temporarily unavailable. Showing rule-based analysis.',
    timeout: 'Request timed out. Showing cached/rule-based analysis.',
    rate_limit: 'Rate limit reached. Please try again in a few minutes.',
    invalid_response: 'Unable to parse AI response. Showing fallback analysis.',
    missing_data: 'Some data was unavailable. Analysis may be incomplete.',
    unknown: 'An unexpected error occurred. Showing fallback analysis.'
  }

  return notes[context.errorType] || notes.unknown
}

/**
 * Get default follow-up questions
 */
function getDefaultFollowUps(queryType: string): string[] {
  const followUps: Record<string, string[]> = {
    general: [
      'What were our biggest weaknesses?',
      'Which rounds should we review?',
      'How did individual players perform?'
    ],
    what_if: [
      'What if we changed our economy approach?',
      'How did site choices affect us?',
      'What rounds were pivotal?'
    ],
    player_focus: [
      'Who had the best opening duels?',
      'Which player clutched most?',
      'Who needs to improve trading?'
    ],
    tactical: [
      'Were our executes predictable?',
      'Which site worked best?',
      'How was our tempo?'
    ],
    comparison: [
      'How do we compare on first bloods?',
      'Is our economy management pro level?',
      'Where do we rank on clutches?'
    ]
  }

  return followUps[queryType] || followUps.general
}
