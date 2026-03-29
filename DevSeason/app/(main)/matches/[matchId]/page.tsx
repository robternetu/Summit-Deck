import Link from 'next/link'
import { requireAuth } from '@/lib/auth'
import { connectToDB } from '@/lib/db'
import { Match, type MatchDocument } from '@/models/Match'
import { MatchDetailClient } from './MatchDetailClient'
import { getMapsStats, PRIMARY_TEAM_ID } from '@/lib/types/evidence'
import { normalizeTeamName } from '@/lib/teamUtils'

// Tournament name mapping based on series ID ranges
function getTournamentName(seriesId: string): string {
  const seriesNum = parseInt(seriesId)
  
  if (seriesNum >= 2843060 && seriesNum <= 2843071) return 'VCT 2025 Americas Split 2'
  if (seriesNum >= 2819676 && seriesNum <= 2819705) return 'VCT 2025 Americas Stage 2'
  if (seriesNum >= 2775953 && seriesNum <= 2789396) return 'VCT 2025 Americas Stage 1'
  if (seriesNum >= 2748743 && seriesNum <= 2748766) return 'VCT 2025 Americas Kickoff'
  if (seriesNum >= 2681809 && seriesNum <= 2681847) return 'VCT 2024 Americas Playoffs'
  if (seriesNum >= 2653969 && seriesNum <= 2654052) return 'VCT 2024 Americas Stage 2'
  if (seriesNum >= 2648624 && seriesNum <= 2648639) return 'VCT 2024 Americas Stage 1'
  if (seriesNum >= 2637961 && seriesNum <= 2637963) return 'VCT 2024 Americas Stage 1'
  if (seriesNum >= 2629390 && seriesNum <= 2629407) return 'VCT 2024 Americas Kickoff'
  
  return 'VCT Americas'
}

// Estimate match date from series ID (VCT schedule approximation)
function estimateMatchDate(seriesId: string): string {
  const seriesNum = parseInt(seriesId)
  
  if (seriesNum >= 2843060) return 'Dec 2025'
  if (seriesNum >= 2819676) return 'Nov 2025'
  if (seriesNum >= 2775953) return 'Sep 2025'
  if (seriesNum >= 2748743) return 'Feb 2025'
  if (seriesNum >= 2681809) return 'Aug 2024'
  if (seriesNum >= 2653969) return 'Jun 2024'
  if (seriesNum >= 2648624) return 'Apr 2024'
  if (seriesNum >= 2637961) return 'Mar 2024'
  if (seriesNum >= 2629390) return 'Feb 2024'
  
  return '2024'
}

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ matchId: string }> }

export default async function MatchDetailPage({ params }: Props) {
  // await requireAuth()
  const { matchId } = await params
  await connectToDB()

  const match = (await Match.findById(matchId).lean()) as unknown as MatchDocument | null

  if (!match) {
    return (
      <div className="min-h-screen pt-24 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="card p-8 text-center">
            <p className="text-gray-400 text-lg">Match not found.</p>
            <Link href="/matches" className="text-[#ffffff] hover:text-[#e5e7eb] mt-4 inline-block">
              ← Back to matches
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const evidence = match.analytics?.evidence_v1
  if (!evidence) {
    return (
      <div className="min-h-screen pt-24 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="card p-8 text-center">
            <p className="text-gray-400 text-lg">No evidence data available for this match.</p>
            <Link href="/matches" className="text-[#ffffff] hover:text-[#e5e7eb] mt-4 inline-block">
              ← Back to matches
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Extract series data
  const games = evidence.games || []
  const players = evidence.players || []
  const mapsStats = getMapsStats(evidence)

  // Find opponent name and normalize it (removes "(1)" suffixes)
  let opponentName = match.opponentName || 'Unknown'
  for (const stat of mapsStats) {
    if (stat.teamId !== PRIMARY_TEAM_ID && stat.teamName) {
      opponentName = normalizeTeamName(stat.teamName)
      break
    }
  }

  // Build game data with scores
  const gameStats = new Map<string, { c9: number; opp: number }>()
  for (const stat of mapsStats) {
    const gameId = stat.gameId
    if (!gameStats.has(gameId)) {
      gameStats.set(gameId, { c9: 0, opp: 0 })
    }
    if (stat.teamId === PRIMARY_TEAM_ID) {
      gameStats.get(gameId)!.c9 = stat.roundsWon
    } else {
      gameStats.get(gameId)!.opp = stat.roundsWon
    }
  }

  const gamesWithScores = games.map((game) => {
    const stats = gameStats.get(game.gameId) || { c9: 0, opp: 0 }
    return {
      gameId: game.gameId,
      mapName: game.mapName,
      sequenceNumber: game.sequenceNumber,
      c9Rounds: stats.c9,
      opponentRounds: stats.opp,
      c9Won: stats.c9 > stats.opp,
    }
  }).sort((a, b) => a.sequenceNumber - b.sequenceNumber)

  // Calculate series score
  const c9MapsWon = gamesWithScores.filter((g) => g.c9Won).length
  const opponentMapsWon = gamesWithScores.filter((g) => !g.c9Won).length
  const seriesWon = c9MapsWon > opponentMapsWon

  // Get player stats per game - compute from kills array
  const kills = evidence.kills || []
  const playerStatsByGame: Record<string, Array<{
    playerId: string
    playerName: string
    teamId: string
    kills: number
    deaths: number
    kd: number
  }>> = {}

  for (const game of games) {
    const gameKills = kills.filter((k) => k.gameId === game.gameId)

    // Build per-map stats from kills
    const playerStatsMap = new Map<string, { playerId: string, playerName: string, teamId: string, kills: number, deaths: number }>()

    for (const kill of gameKills) {
      // Count kills for killer
      if (kill.killerId && kill.killerTeamId === PRIMARY_TEAM_ID) {
        if (!playerStatsMap.has(kill.killerId)) {
          playerStatsMap.set(kill.killerId, { playerId: kill.killerId, playerName: '', teamId: kill.killerTeamId, kills: 0, deaths: 0 })
        }
        playerStatsMap.get(kill.killerId)!.kills++
      }
      // Count deaths for victim
      if (kill.victimId && kill.victimTeamId === PRIMARY_TEAM_ID) {
        if (!playerStatsMap.has(kill.victimId)) {
          playerStatsMap.set(kill.victimId, { playerId: kill.victimId, playerName: '', teamId: kill.victimTeamId, kills: 0, deaths: 0 })
        }
        playerStatsMap.get(kill.victimId)!.deaths++
      }
    }

    // Populate player names from evidence.players
    playerStatsMap.forEach((stats, playerId) => {
      const p = players.find((pl) => pl.playerId === playerId)
      if (p) stats.playerName = p.playerName || `Player ${playerId}`
    })

    playerStatsByGame[game.gameId] = Array.from(playerStatsMap.values())
      .map(s => ({ ...s, kd: s.deaths > 0 ? s.kills / s.deaths : s.kills }))
  }

  // Serialize the data for client component
  const seriesId = match.gridSeriesId || ''
  const seriesData = {
    matchId: String(match._id),
    seriesId,
    opponentName,
    tournamentName: getTournamentName(seriesId),
    matchDate: estimateMatchDate(seriesId),
    c9MapsWon,
    opponentMapsWon,
    seriesWon,
    games: gamesWithScores,
    playerStatsByGame,
    // Pass evidence-derived stats for each game
    derivedStats: evidence.derived || {},
  }

  return <MatchDetailClient seriesData={seriesData} />
}
