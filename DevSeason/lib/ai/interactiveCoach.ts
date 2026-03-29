/**
 * Sprint 6: Interactive Coach Query Processor
 *
 * Enables coaches to ask natural language questions about match data
 * with AI-powered, evidence-based responses.
 */

import { EvidenceV1 } from '@/lib/types/evidence'
import { processWhatIfScenario, WhatIfQuery, WHAT_IF_EXAMPLES } from './whatIfHandler'

export interface CoachQueryInput {
  query: string
  queryType: 'general' | 'what_if' | 'player_focus' | 'comparison' | 'tactical'
  evidence: EvidenceV1
  context?: {
    playerNames?: string[]
    roundNumbers?: number[]
    sites?: string[]
    focusArea?: string
  }
}

export interface DataPoint {
  metric: string
  value: string | number
  context: string
}

export interface CoachQueryResponse {
  answer: string
  evidence: {
    dataPoints: DataPoint[]
    relevantRounds?: number[]
    relevantPlayers?: string[]
  }
  insight: string
  recommendations?: string[]
  confidence: 'high' | 'medium' | 'low'
  suggestedFollowUps?: string[]
}

/**
 * Process a coach query and generate evidence-based response
 */
export async function processCoachQuery(
  input: CoachQueryInput
): Promise<CoachQueryResponse> {
  const { query, queryType, evidence, context } = input

  // Handle what-if queries with specialized handler
  if (queryType === 'what_if') {
    return processWhatIfQuery(query, evidence, context)
  }

  // Extract relevant stats based on query type
  const relevantStats = extractRelevantStats(evidence, queryType, context)

  // Build the LLM prompt
  const prompt = buildInteractivePrompt(query, queryType, relevantStats, context)

  // Get LLM response (will be routed through existing coach.ts infrastructure)
  const response = await generateInteractiveResponse(prompt, evidence)

  return response
}

/**
 * Process what-if queries using the specialized handler
 */
async function processWhatIfQuery(
  query: string,
  evidence: EvidenceV1,
  context?: CoachQueryInput['context']
): Promise<CoachQueryResponse> {
  const whatIfQuery: WhatIfQuery = {
    query,
    roundNumber: context?.roundNumbers?.[0],
    context: {
      players: context?.playerNames,
      site: context?.sites?.[0]
    }
  }

  const result = await processWhatIfScenario(whatIfQuery, evidence)

  // Convert what-if response to CoachQueryResponse format
  const dataPoints: DataPoint[] = []
  const relevantRounds: number[] = []
  const relevantPlayers: string[] = context?.playerNames || []

  // Extract data points from scenarios
  for (const scenario of result.scenarios) {
    for (const data of scenario.supportingData) {
      dataPoints.push({
        metric: data.metric,
        value: data.value,
        context: data.relevance
      })
    }

    // Add scenario-specific rounds
    if (whatIfQuery.roundNumber) {
      relevantRounds.push(whatIfQuery.roundNumber)
    }
  }

  // Build answer from scenarios
  const primaryScenario = result.scenarios[0]
  let answer = result.summary + '\n\n'

  if (primaryScenario) {
    const probChange = primaryScenario.projectedOutcome.probabilityChange
    const changeDirection = probChange > 0 ? 'increase' : 'decrease'
    const changeAmount = Math.abs(probChange * 100).toFixed(1)

    answer += `**${primaryScenario.scenario}**: This would ${changeDirection} win probability by ${changeAmount}%. `
    answer += `Current projection: ${(primaryScenario.projectedOutcome.winProbability * 100).toFixed(0)}% win rate.`
  }

  // Build insight
  let insight = 'What-if analysis based on historical match data. '
  if (primaryScenario?.projectedOutcome.impactLevel === 'high') {
    insight += 'This change would have HIGH impact on round outcomes.'
  } else if (primaryScenario?.projectedOutcome.impactLevel === 'medium') {
    insight += 'This change would have moderate impact on outcomes.'
  } else {
    insight += 'Impact is relatively minor based on available data.'
  }

  // Build recommendations
  const recommendations = primaryScenario?.recommendations || [
    'Consider multiple scenarios before making strategic changes',
    'Review supporting data points for confidence level'
  ]

  return {
    answer,
    evidence: {
      dataPoints,
      relevantRounds: relevantRounds.length > 0 ? relevantRounds : undefined,
      relevantPlayers: relevantPlayers.length > 0 ? relevantPlayers : undefined
    },
    insight,
    recommendations,
    confidence: primaryScenario?.confidence || 'medium',
    suggestedFollowUps: result.relatedQueries
  }
}

/**
 * Extract stats relevant to the query type
 */
function extractRelevantStats(
  evidence: EvidenceV1,
  queryType: string,
  context?: CoachQueryInput['context']
): string {
  const sections: string[] = []
  const derived = evidence.derived

  // Always include match overview
  sections.push(formatMatchOverview(evidence))

  switch (queryType) {
    case 'what_if':
      sections.push(formatEconomyData(derived))
      sections.push(formatCriticalRounds(derived))
      sections.push(formatStreakData(derived))
      break

    case 'player_focus':
      sections.push(formatPlayerStats(derived, context?.playerNames))
      sections.push(formatClutchStats(derived, context?.playerNames))
      sections.push(formatDamageStats(derived, context?.playerNames))
      sections.push(formatOpeningDuels(derived, context?.playerNames))
      break

    case 'tactical':
      sections.push(formatExecutePatterns(derived))
      sections.push(formatSiteStats(derived))
      sections.push(formatTempoStats(derived))
      sections.push(formatEntryStats(derived))
      break

    case 'comparison':
      sections.push(formatTeamComparison(derived))
      sections.push(formatBenchmarks(derived))
      break

    default:
      // General - include key summaries
      sections.push(formatKeyMetrics(derived))
      sections.push(formatStrengthsWeaknesses(derived))
  }

  return sections.filter(s => s).join('\n\n')
}

/**
 * Format match overview
 */
function formatMatchOverview(evidence: EvidenceV1): string {
  const { games, rounds, derived } = evidence
  const totalRounds = rounds.length
  const mapsPlayed = games.length

  // Calculate team scores
  const teamScores: Record<string, number> = {}
  for (const round of rounds) {
    const winner = round.winnerTeamId
    if (winner) {
      teamScores[winner] = (teamScores[winner] || 0) + 1
    }
  }

  const teamNames = derived.mapsStats?.reduce((acc, m) => {
    acc[m.teamId] = m.teamName
    return acc
  }, {} as Record<string, string>) || {}

  const scores = Object.entries(teamScores)
    .map(([id, score]) => `${teamNames[id] || id}: ${score} rounds`)
    .join(' vs ')

  return `## Match Overview
- Maps played: ${mapsPlayed}
- Total rounds: ${totalRounds}
- Score: ${scores}
- Maps: ${games.map(g => g.mapName).join(', ')}`
}

/**
 * Format economy data for what-if analysis
 */
function formatEconomyData(derived: EvidenceV1['derived']): string {
  const ecoStats = derived.economyStats || []
  if (ecoStats.length === 0) return ''

  const lines = ['## Economy Analysis']
  for (const team of ecoStats) {
    // Get win rates from byTier if available
    const forceBuyWR = team.byTier?.half_buy?.winRate || 0
    const fullBuyWR = team.byTier?.full_buy?.winRate || 0
    const ecoWins = team.byTier?.eco?.wins || 0

    lines.push(`\n### ${team.teamName}`)
    lines.push(`- Force buy win rate: ${(forceBuyWR * 100).toFixed(1)}%`)
    lines.push(`- Full buy win rate: ${(fullBuyWR * 100).toFixed(1)}%`)
    lines.push(`- Eco rounds won: ${ecoWins}`)
  }
  return lines.join('\n')
}

/**
 * Format critical rounds
 */
function formatCriticalRounds(derived: EvidenceV1['derived']): string {
  const critical = derived.criticalRounds || []
  if (critical.length === 0) return ''

  const lines = ['## Critical Rounds']
  for (const cr of critical.slice(0, 3)) {
    const topRounds = cr.topReviewRounds || []
    for (const tr of topRounds.slice(0, 3)) {
      lines.push(`- Round ${tr.roundNumber}: ${tr.reason} (Focus: ${tr.coachingFocus})`)
    }
  }
  return lines.join('\n')
}

/**
 * Format streak/momentum data
 */
function formatStreakData(derived: EvidenceV1['derived']): string {
  const streaks = derived.streakStats || []
  if (streaks.length === 0) return ''

  const lines = ['## Momentum Analysis']
  for (const team of streaks) {
    lines.push(`\n### ${team.teamName}`)
    lines.push(`- Max win streak: ${team.winStreaks?.maxLength || 0} rounds`)
    lines.push(`- Max loss streak: ${team.lossStreaks?.maxLength || 0} rounds`)
    lines.push(`- Momentum score: ${team.momentumScore || 0}`)
    lines.push(`- Resilience score: ${team.resilienceScore || 0}`)
  }
  return lines.join('\n')
}

/**
 * Format player-specific stats
 */
function formatPlayerStats(
  derived: EvidenceV1['derived'],
  playerNames?: string[]
): string {
  const fbStats = derived.firstBloodStats || []
  const multiKill = derived.multiKillStats || []

  const lines = ['## Player Statistics']

  // First blood stats
  if (fbStats.length > 0) {
    lines.push('\n### First Blood Conversion')
    for (const fb of fbStats) {
      const convRate = ((fb.conversionRate || 0) * 100).toFixed(1)
      lines.push(`- ${fb.teamName}: ${fb.firstBloods} FBs, ${convRate}% conversion`)
    }
  }

  // Multi-kill stats
  if (multiKill.length > 0) {
    lines.push('\n### Multi-Kill Rounds')
    for (const mk of multiKill.slice(0, 5)) {
      const name = mk.playerName || mk.playerId
      if (!playerNames || playerNames.some(p => name.toLowerCase().includes(p.toLowerCase()))) {
        lines.push(`- ${name}: ${mk.twoKs || 0} 2K, ${mk.threeKs || 0} 3K, ${mk.fourKs || 0} 4K, ${mk.aces || 0} Ace`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Format clutch stats
 */
function formatClutchStats(
  derived: EvidenceV1['derived'],
  playerNames?: string[]
): string {
  const clutch = derived.clutchStats || []
  if (clutch.length === 0) return ''

  const lines = ['## Clutch Performance']

  for (const c of clutch.slice(0, 5)) {
    const name = c.playerName || c.playerId
    if (!playerNames || playerNames.some(p => name.toLowerCase().includes(p.toLowerCase()))) {
      const clutchRate = ((c.clutchRate || 0) * 100).toFixed(1)
      lines.push(`- ${name}: ${c.clutchWins}/${c.clutchAttempts} (${clutchRate}%)`)

      // Breakdown by situation
      if (c.breakdown) {
        const details = Object.entries(c.breakdown)
          .map(([sit, data]: [string, any]) => `${sit}: ${data.wins}/${data.attempts}`)
          .join(', ')
        lines.push(`  Breakdown: ${details}`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Format damage stats (Sprint 6)
 */
function formatDamageStats(
  derived: EvidenceV1['derived'],
  playerNames?: string[]
): string {
  const damageStats = (derived as any).playerDamageStats || []
  if (damageStats.length === 0) return ''

  const lines = ['## Damage Stats (Estimated)']

  for (const ps of damageStats.slice(0, 5)) {
    const name = ps.playerName || ps.playerId
    if (!playerNames || playerNames.some(p => name.toLowerCase().includes(p.toLowerCase()))) {
      lines.push(`- ${name}: ADR ${ps.adr}, Damage Ratio ${ps.damageRatio}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format opening duel stats
 */
function formatOpeningDuels(
  derived: EvidenceV1['derived'],
  playerNames?: string[]
): string {
  const duels = derived.openingDuelStats || []
  if (duels.length === 0) return ''

  const lines = ['## Opening Duels']

  for (const d of duels.slice(0, 5)) {
    const name = d.playerName || d.playerId
    if (!playerNames || playerNames.some(p => name.toLowerCase().includes(p.toLowerCase()))) {
      const wins = d.openingKills || 0
      const losses = d.openingDeaths || 0
      const total = wins + losses
      const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0'
      lines.push(`- ${name}: ${wins}W-${losses}L (${winRate}%)`)
    }
  }

  return lines.join('\n')
}

/**
 * Format execute patterns
 */
function formatExecutePatterns(derived: EvidenceV1['derived']): string {
  const execStats = derived.executePatternStats || []
  if (execStats.length === 0) return ''

  const lines = ['## Execute Patterns']

  for (const team of execStats) {
    lines.push(`\n### ${team.teamName}`)
    lines.push(`- Predictability score: ${team.predictabilityScore || 0}`)

    const prefs = team.preferredPatterns || {}
    lines.push(`- Preferred site: ${prefs.site || 'varied'}`)
    lines.push(`- Preferred timing: ${prefs.timing || 'varied'}`)
    lines.push(`- Entry method: ${prefs.entryMethod || 'varied'}`)

    // Coaching insights
    const insights = team.coachingInsights || []
    for (const insight of insights.slice(0, 2)) {
      lines.push(`- Insight: ${insight.description} (${insight.severity})`)
    }
  }

  return lines.join('\n')
}

/**
 * Format site stats
 */
function formatSiteStats(derived: EvidenceV1['derived']): string {
  const sites = derived.siteStats || []
  if (sites.length === 0) return ''

  const lines = ['## Site Statistics']

  for (const site of sites) {
    lines.push(`\n### ${site.site}`)

    // Attack stats
    if (site.attackStats) {
      for (const [teamId, stats] of Object.entries(site.attackStats)) {
        const s = stats as { teamName?: string; plants?: number; postPlantWinRate?: number }
        lines.push(`- ${s.teamName || teamId} attack: ${s.plants || 0} plants, ${((s.postPlantWinRate || 0) * 100).toFixed(0)}% win rate`)
      }
    }

    // Defense stats
    if (site.defenseStats) {
      for (const [teamId, stats] of Object.entries(site.defenseStats)) {
        const s = stats as { teamName?: string; defenseWinRate?: number }
        lines.push(`- ${s.teamName || teamId} defense: ${((s.defenseWinRate || 0) * 100).toFixed(0)}% hold rate`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Format tempo stats
 */
function formatTempoStats(derived: EvidenceV1['derived']): string {
  const tempo = derived.tempoStats || []
  if (tempo.length === 0) return ''

  const lines = ['## Tempo Analysis']

  for (const team of tempo) {
    const fastRounds = team.byTempo?.fast?.rounds || 0
    const standardRounds = team.byTempo?.standard?.rounds || 0
    const slowRounds = team.byTempo?.slow?.rounds || 0

    lines.push(`- ${team.teamName}: Avg time to plant ${team.attackStats?.avgTimeToPlant || 0}s`)
    lines.push(`  Fast executes: ${fastRounds}, Standard: ${standardRounds}, Slow: ${slowRounds}`)
  }

  return lines.join('\n')
}

/**
 * Format entry stats
 */
function formatEntryStats(derived: EvidenceV1['derived']): string {
  const entries = derived.entryStats || []
  if (entries.length === 0) return ''

  const lines = ['## Entry Statistics']

  for (const e of entries.slice(0, 5)) {
    const name = e.playerName || e.playerId
    const successRate = ((e.entrySuccessRate || 0) * 100).toFixed(1)
    lines.push(`- ${name}: ${e.entryAttempts || 0} attempts, ${successRate}% success`)
  }

  return lines.join('\n')
}

/**
 * Format team comparison
 */
function formatTeamComparison(derived: EvidenceV1['derived']): string {
  const lines = ['## Team Comparison']

  // First blood comparison
  const fb = derived.firstBloodStats || []
  if (fb.length >= 2) {
    lines.push('\n### First Blood')
    for (const team of fb) {
      lines.push(`- ${team.teamName}: ${team.firstBloods} FBs, ${((team.conversionRate || 0) * 100).toFixed(1)}% conversion`)
    }
  }

  // Plant stats comparison
  const plants = derived.plantStats || []
  if (plants.length >= 2) {
    lines.push('\n### Post-Plant')
    for (const team of plants) {
      lines.push(`- ${team.teamName}: ${team.plants} plants, ${((team.postPlantWinRate || 0) * 100).toFixed(1)}% win rate`)
    }
  }

  return lines.join('\n')
}

/**
 * Format benchmark stats
 */
function formatBenchmarks(derived: EvidenceV1['derived']): string {
  const benchmarks = (derived as any).benchmarkStats || []
  if (benchmarks.length === 0) return ''

  const lines = ['## Performance Benchmarks']

  for (const team of benchmarks) {
    lines.push(`\n### ${team.teamName}`)
    lines.push(`- Overall tier: ${team.teamBenchmarks?.overallTier || 'unknown'}`)
    lines.push(`- Percentile: ${team.teamBenchmarks?.overallPercentile || 50}`)

    if (team.areasAboveAverage?.length > 0) {
      lines.push(`- Strengths: ${team.areasAboveAverage.join(', ')}`)
    }
    if (team.areasForImprovement?.length > 0) {
      lines.push(`- Areas to improve: ${team.areasForImprovement.join(', ')}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format key metrics summary
 */
function formatKeyMetrics(derived: EvidenceV1['derived']): string {
  const lines = ['## Key Metrics Summary']

  // First blood
  const fb = derived.firstBloodStats || []
  for (const team of fb) {
    lines.push(`- ${team.teamName} FB conversion: ${((team.conversionRate || 0) * 100).toFixed(1)}%`)
  }

  // Clutch performance
  const clutch = derived.clutchStats || []
  const totalAttempts = clutch.reduce((sum, c) => sum + (c.clutchAttempts || 0), 0)
  const totalWins = clutch.reduce((sum, c) => sum + (c.clutchWins || 0), 0)
  if (totalAttempts > 0) {
    lines.push(`- Overall clutch rate: ${totalWins}/${totalAttempts} (${(totalWins / totalAttempts * 100).toFixed(1)}%)`)
  }

  // Trade efficiency
  const trades = derived.tradeStats || []
  for (const player of trades.slice(0, 2)) {
    const tradeRate = player.tradedRate || 0
    lines.push(`- ${player.playerName} trade rate: ${(tradeRate * 100).toFixed(1)}%`)
  }

  return lines.join('\n')
}

/**
 * Format strengths and weaknesses
 */
function formatStrengthsWeaknesses(derived: EvidenceV1['derived']): string {
  const recommendations = (derived as any).coachingRecommendations || []
  if (recommendations.length === 0) return ''

  const lines = ['## Strengths & Weaknesses']

  for (const team of recommendations) {
    lines.push(`\n### ${team.teamName}`)

    // Strengths
    const strengths = team.strengths || []
    if (strengths.length > 0) {
      lines.push('**Strengths:**')
      for (const s of strengths.slice(0, 3)) {
        lines.push(`- ${s.description}`)
      }
    }

    // Weaknesses
    const weaknesses = team.weaknesses || []
    if (weaknesses.length > 0) {
      lines.push('**Weaknesses:**')
      for (const w of weaknesses.slice(0, 3)) {
        lines.push(`- ${w.description} (${w.severity})`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Build the LLM prompt for interactive coaching
 */
function buildInteractivePrompt(
  query: string,
  queryType: string,
  relevantStats: string,
  context?: CoachQueryInput['context']
): string {
  const systemPrompt = `You are an expert Valorant coach assistant for the featured professional team tracked in this workspace.
You have access to detailed match analytics and must answer coaching questions using ONLY the data provided.

CRITICAL RULES:
1. ALWAYS cite specific numbers from the data
2. NEVER invent or assume statistics not in the data
3. Follow the Evidence → Insight → Recommendation format
4. If data is insufficient, say so clearly
5. For "what-if" scenarios, use historical data to project outcomes with confidence levels

Query Type: ${queryType.toUpperCase()}
${context?.focusArea ? `Focus Area: ${context.focusArea}` : ''}
${context?.playerNames?.length ? `Players of Interest: ${context.playerNames.join(', ')}` : ''}
${context?.roundNumbers?.length ? `Rounds of Interest: ${context.roundNumbers.join(', ')}` : ''}`

  const dataSection = `
## AVAILABLE MATCH DATA

${relevantStats}`

  const responseFormat = `
## COACH'S QUESTION

"${query}"

## RESPONSE FORMAT

Respond in this exact JSON structure:
{
  "answer": "Direct answer to the question with specific data citations",
  "evidence": {
    "dataPoints": [
      {"metric": "name", "value": "number or string", "context": "why this matters"}
    ],
    "relevantRounds": [round numbers if applicable],
    "relevantPlayers": ["player names if applicable"]
  },
  "insight": "What this data means tactically",
  "recommendations": ["Actionable recommendation 1", "Actionable recommendation 2"],
  "confidence": "high|medium|low based on data quality",
  "suggestedFollowUps": ["Follow-up question 1", "Follow-up question 2"]
}`

  return systemPrompt + dataSection + responseFormat
}

/**
 * Generate interactive response using LLM
 */
async function generateInteractiveResponse(
  prompt: string,
  evidence: EvidenceV1
): Promise<CoachQueryResponse> {
  // For now, generate a template response
  // In production, this would call the LLM

  // Parse the question to generate appropriate response
  const defaultResponse: CoachQueryResponse = {
    answer: "Based on the available match data, I can provide analysis once the LLM integration is complete.",
    evidence: {
      dataPoints: [],
      relevantRounds: [],
      relevantPlayers: []
    },
    insight: "Analysis pending LLM integration.",
    recommendations: [],
    confidence: 'low',
    suggestedFollowUps: [
      "What were our biggest weaknesses?",
      "Which player had the most impact?",
      "How did our economy decisions affect the outcome?"
    ]
  }

  // Try to extract basic stats for a minimal response
  const derived = evidence.derived

  // Add some data points from available stats
  if (derived.firstBloodStats?.length) {
    for (const fb of derived.firstBloodStats) {
      defaultResponse.evidence.dataPoints.push({
        metric: `${fb.teamName} First Blood Conversion`,
        value: `${((fb.conversionRate || 0) * 100).toFixed(1)}%`,
        context: `${fb.firstBloods} first bloods total`
      })
    }
  }

  if (derived.clutchStats?.length) {
    const totalClutch = derived.clutchStats.reduce((sum, c) => sum + (c.clutchAttempts || 0), 0)
    const wonClutch = derived.clutchStats.reduce((sum, c) => sum + (c.clutchWins || 0), 0)
    defaultResponse.evidence.dataPoints.push({
      metric: 'Overall Clutch Rate',
      value: `${wonClutch}/${totalClutch}`,
      context: `${(wonClutch / Math.max(totalClutch, 1) * 100).toFixed(1)}% success rate`
    })
  }

  return defaultResponse
}

/**
 * Suggested queries by category
 */
export const SUGGESTED_QUERIES = {
  general: [
    "What were our biggest weaknesses this match?",
    "Which player had the most impact?",
    "How did our economy management compare to the opponent?",
    "What patterns did the opponent exploit against us?"
  ],
  whatIf: [
    "What if we saved round 16 instead of forcing?",
    "What if we attacked B site on round 8 instead of A?",
    "What if we traded out the entry death on round 12?",
    "How did our force buy decisions impact the match?",
    "Should we have executed faster on overtime rounds?"
  ],
  playerFocus: [
    "How did our IGL perform in clutch situations?",
    "Which matchups were problematic for our entry fragger?",
    "What was each player's ADR and impact?",
    "When did our star player have the most impact?"
  ],
  tactical: [
    "Which execute patterns were most successful?",
    "How predictable were our attack strategies?",
    "What defensive setups worked best on each site?",
    "Where did we lose the most rounds and why?"
  ],
  comparison: [
    "How do we compare to pro teams in first blood rate?",
    "Is our clutch rate above or below average?",
    "How does our trading compare to elite teams?",
    "Are we performing at pro level on economy decisions?"
  ]
}

// Re-export what-if examples for API documentation
export { WHAT_IF_EXAMPLES }
