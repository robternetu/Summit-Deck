import type { MatchDocument } from '@/models/Match'
import { computeMatchAnalytics } from './computeMatchAnalytics'

export interface TeamOverviewStats {
  totalMatches: number
  wins: number
  losses: number
  mapsPlayed: Record<string, number>
  attackWinRate: number
  defenseWinRate: number
  evidenceMatchCount: number
}

export function computeTeamOverview(matches: MatchDocument[]): TeamOverviewStats {
  const totalMatches = matches.length

  // Compute real wins/losses from round data
  let wins = 0
  let losses = 0

  // Aggregate attack/defense stats from evidence
  let totalAttackWins = 0
  let totalAttackPlayed = 0
  let totalDefenseWins = 0
  let totalDefensePlayed = 0
  let evidenceCount = 0

  // Fallback: legacy round data
  let totalAttackRoundsWon = 0
  let totalDefenseRoundsWon = 0
  let totalRoundsPlayed = 0

  for (const match of matches) {
    const roundsWon = match.teamRoundsWon ?? 0
    const roundsLost = match.teamRoundsLost ?? 0

    // Only count as win/loss if we have round data
    if (roundsWon > 0 || roundsLost > 0) {
      if (roundsWon > roundsLost) {
        wins++
      } else if (roundsLost > roundsWon) {
        losses++
      }
      // Ties (roundsWon === roundsLost) don't count as win or loss
    }

    // Try to compute analytics from evidence
    const analytics = computeMatchAnalytics(match)

    if (analytics.hasEvidence && analytics.roundStats) {
      // Use evidence-based stats
      totalAttackWins += analytics.roundStats.attackWins
      totalAttackPlayed += analytics.roundStats.attackTotal
      totalDefenseWins += analytics.roundStats.defenseWins
      totalDefensePlayed += analytics.roundStats.defenseTotal
      evidenceCount++
    } else {
      // Fallback to legacy round data
      totalRoundsPlayed += roundsWon + roundsLost
      totalAttackRoundsWon += match.attackRoundsWon ?? 0
      totalDefenseRoundsWon += match.defenseRoundsWon ?? 0
    }
  }

  // Map breakdown
  const mapsPlayed: Record<string, number> = {}
  for (const match of matches) {
    mapsPlayed[match.map] = (mapsPlayed[match.map] || 0) + 1
  }

  // Attack/Defense win rates
  let attackWinRate = 0
  let defenseWinRate = 0

  if (evidenceCount > 0) {
    // Use evidence-based stats if available
    attackWinRate = totalAttackPlayed > 0 ? totalAttackWins / totalAttackPlayed : 0
    defenseWinRate = totalDefensePlayed > 0 ? totalDefenseWins / totalDefensePlayed : 0
  } else {
    // Fallback to legacy estimation
    const estimatedAttackRounds = Math.floor(totalRoundsPlayed / 2)
    const estimatedDefenseRounds = totalRoundsPlayed - estimatedAttackRounds

    attackWinRate =
      estimatedAttackRounds > 0 ? totalAttackRoundsWon / estimatedAttackRounds : 0

    defenseWinRate =
      estimatedDefenseRounds > 0
        ? totalDefenseRoundsWon / estimatedDefenseRounds
        : 0
  }

  return {
    totalMatches,
    wins,
    losses,
    mapsPlayed,
    attackWinRate,
    defenseWinRate,
    evidenceMatchCount: evidenceCount,
  }
}
