import type { MatchDocument } from '@/models/Match'
import type { DashboardStatsDocument } from '@/models/DashboardStats'
import { getMapsStats, PRIMARY_TEAM_ID } from '@/lib/types/evidence'
import { normalizeTeamName } from '@/lib/teamUtils'

type DashboardStatsInputMatch = {
  gridSeriesId?: string
  opponentName?: string
  analytics?: MatchDocument['analytics']
}

interface OpponentRecordInternal {
  displayName: string
  seriesIds: Set<string>
  seriesWins: number
  seriesLosses: number
  mapsWon: number
  mapsLost: number
}

/**
 * Compute dashboard statistics from match data for storage in DashboardStats collection
 * This is the same logic as the original computeDashboardStats but returns data in storage format
 */
export function computeDashboardStatsForStorage(
  matches: DashboardStatsInputMatch[]
): Omit<DashboardStatsDocument, '_id' | 'createdAt' | 'updatedAt'> {
  // Filter matches with featured-team participation
  const c9Matches = matches.filter((match) => {
    const mapsStats = getMapsStats(match.analytics?.evidence_v1)
    if (mapsStats.length === 0) return false
    return mapsStats.some((stat) => stat.teamId === PRIMARY_TEAM_ID)
  })

  // Build series map for deduplication
  const seriesMap = new Map<string, DashboardStatsInputMatch>()
  for (const match of c9Matches) {
    const seriesId = match.gridSeriesId
    if (seriesId && !seriesMap.has(seriesId)) {
      seriesMap.set(seriesId, match)
    }
  }

  const seriesResults: Array<{
    seriesId: string
    opponent: string
    c9MapsWon: number
    opponentMapsWon: number
    isWin: boolean
    games: Array<{
      mapName: string
      c9Rounds: number
      opponentRounds: number
    }>
  }> = []

  const mapsPlayed: Record<string, number> = {}
  const opponentRecords = new Map<string, OpponentRecordInternal>()
  let totalAttackWins = 0
  let totalAttackRounds = 0
  let totalDefenseWins = 0
  let totalDefenseRounds = 0

  // Process each series
  for (const [seriesId, match] of seriesMap) {
    const evidence = match.analytics?.evidence_v1
    if (!evidence) continue

    const mapsStats = getMapsStats(evidence)
    const games = evidence.games || []

    // Build game stats map
    const gameStats = new Map<
      string,
      { c9: { teamId: string; roundsWon: number }; opponent: { teamId: string; teamName: string; roundsWon: number } | null }
    >()

    for (const stat of mapsStats) {
      const gameId = stat.gameId
      if (!gameStats.has(gameId)) {
        gameStats.set(gameId, { c9: { teamId: '', roundsWon: 0 }, opponent: null })
      }
      if (stat.teamId === PRIMARY_TEAM_ID) {
        gameStats.get(gameId)!.c9 = { teamId: stat.teamId, roundsWon: stat.roundsWon }
      } else {
        gameStats.get(gameId)!.opponent = {
          teamId: stat.teamId,
          teamName: stat.teamName,
          roundsWon: stat.roundsWon,
        }
      }
    }

    let c9MapsWon = 0
    let opponentMapsWon = 0
    let opponentName = match.opponentName || 'Unknown'
    const gameResults: Array<{ mapName: string; c9Rounds: number; opponentRounds: number }> = []

    for (const game of games) {
      const stats = gameStats.get(game.gameId)
      if (!stats?.c9 || !stats?.opponent) continue

      const mapName = game.mapName
      mapsPlayed[mapName] = (mapsPlayed[mapName] || 0) + 1

      const c9Rounds = stats.c9.roundsWon
      const oppRounds = stats.opponent.roundsWon
      opponentName = normalizeTeamName(stats.opponent.teamName)

      gameResults.push({ mapName, c9Rounds, opponentRounds: oppRounds })

      if (c9Rounds > oppRounds) c9MapsWon++
      else if (oppRounds > c9Rounds) opponentMapsWon++
    }

    const isWin = c9MapsWon > opponentMapsWon

    // Only count series with a definitive winner
    if (c9MapsWon !== opponentMapsWon) {
      // Track opponent records
      if (!opponentRecords.has(opponentName)) {
        opponentRecords.set(opponentName, {
          displayName: opponentName,
          seriesIds: new Set([seriesId]),
          seriesWins: isWin ? 1 : 0,
          seriesLosses: isWin ? 0 : 1,
          mapsWon: c9MapsWon,
          mapsLost: opponentMapsWon,
        })
      } else {
        const record = opponentRecords.get(opponentName)!
        record.seriesIds.add(seriesId)
        if (isWin) record.seriesWins++
        else record.seriesLosses++
        record.mapsWon += c9MapsWon
        record.mapsLost += opponentMapsWon
      }
    }

    seriesResults.push({ seriesId, opponent: opponentName, c9MapsWon, opponentMapsWon, isWin, games: gameResults })

    // Calculate attack/defense win rates
    const rounds = evidence.rounds || []
    for (const round of rounds) {
      const winnerSide = round.winnerSide
      const winnerTeamId = round.winnerTeamId
      if (winnerSide === 'attack') {
        totalAttackRounds++
        if (winnerTeamId === PRIMARY_TEAM_ID) totalAttackWins++
      } else if (winnerSide === 'defense') {
        totalDefenseRounds++
        if (winnerTeamId === PRIMARY_TEAM_ID) totalDefenseWins++
      }
    }
  }

  // Calculate struggling opponents (teams C9 has lost more against)
  const strugglingAgainst = Array.from(opponentRecords.values())
    .filter((record) => record.seriesLosses > record.seriesWins)
    .sort((a, b) => b.seriesLosses - a.seriesLosses)
    .slice(0, 5)
    .map((record) => ({
      name: record.displayName,
      seriesWins: record.seriesWins,
      seriesLosses: record.seriesLosses,
      mapsWon: record.mapsWon,
      mapsLost: record.mapsLost,
    }))

  // Calculate totals
  const totalSeries = seriesMap.size
  const seriesWins = seriesResults.filter((s) => s.isWin).length
  const seriesLosses = seriesResults.filter((s) => !s.isWin).length

  return {
    totalSeries,
    seriesWins,
    seriesLosses,
    mapsPlayed: new Map(Object.entries(mapsPlayed)),
    attackWinRate: totalAttackRounds > 0 ? totalAttackWins / totalAttackRounds : 0,
    defenseWinRate: totalDefenseRounds > 0 ? totalDefenseWins / totalDefenseRounds : 0,
    recentSeries: seriesResults.slice(0, 10),
    strugglingAgainst,
    lastUpdated: new Date(),
    matchesProcessed: c9Matches.length,
  }
}
