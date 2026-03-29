import Link from 'next/link'
import { requireAuth } from '@/lib/auth'
import { connectToDB } from '@/lib/db'
import { Match, type MatchDocument } from '@/models/Match'
import { TeamLogo } from '@/components/ui/TeamLogo'
import { normalizeTeamName } from '@/lib/teamUtils'
import { getMapsStats, PRIMARY_TEAM_ID } from '@/lib/types/evidence'
import { ChevronLeft, TrendingUp, TrendingDown, Calendar, Trophy } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Tournament name mapping based on tournamentId patterns from manifest
// These IDs correspond to VCT events
const TOURNAMENT_NAMES: Record<string, string> = {
  '757073': 'VCT 2024 Americas Kickoff',
  '757074': 'VCT 2024 Americas Kickoff',
  '757101': 'VCT 2024 Americas Stage 1',
  '757234': 'VCT 2024 Americas Stage 1',
  '757235': 'VCT 2024 Americas Stage 1',
  '757321': 'VCT 2024 Americas Stage 1',
  '757628': 'VCT 2024 Americas Kickoff',
  '757629': 'VCT 2024 Americas Kickoff',
  '758114': 'VCT 2024 Americas Stage 2',
  '774784': 'VCT 2024 Americas Playoffs',
  '774785': 'VCT 2024 Americas Playoffs',
  '774787': 'VCT 2024 Americas Playoffs',
  '775518': 'VCT 2025 Americas Kickoff',
  '800677': 'VCT 2025 Americas Stage 1',
  '800678': 'VCT 2025 Americas Stage 1',
  '800680': 'VCT 2025 Americas Stage 1',
  '826662': 'VCT 2025 Americas Stage 2',
  '826663': 'VCT 2025 Americas Stage 2',
  '826992': 'VCT 2025 Americas Split 2',
}

function getTournamentName(seriesId: string): string {
  // Extract tournament ID from series patterns
  // Series IDs in the same tournament are close together numerically
  const seriesNum = parseInt(seriesId)
  
  // Map series ranges to tournaments based on manifest data
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

// Estimate match date from series ID patterns
// Higher series IDs = more recent matches
function estimateMatchDate(seriesId: string): string {
  const seriesNum = parseInt(seriesId)
  
  // These are rough date estimates based on VCT schedule
  if (seriesNum >= 2843060) return '2025-12' // Dec 2025
  if (seriesNum >= 2819676) return '2025-11' // Nov 2025
  if (seriesNum >= 2775953) return '2025-09' // Sep 2025
  if (seriesNum >= 2748743) return '2025-02' // Feb 2025
  if (seriesNum >= 2681809) return '2024-08' // Aug 2024
  if (seriesNum >= 2653969) return '2024-06' // Jun 2024
  if (seriesNum >= 2648624) return '2024-04' // Apr 2024
  if (seriesNum >= 2637961) return '2024-03' // Mar 2024
  if (seriesNum >= 2629390) return '2024-02' // Feb 2024
  
  return '2024'
}

interface SeriesData {
  seriesId: string
  matchId: string
  c9MapsWon: number
  opponentMapsWon: number
  isWin: boolean
  tournament: string
  estimatedDate: string
  games: Array<{
    gameId: string
    mapName: string
    c9Rounds: number
    opponentRounds: number
    c9Won: boolean
  }>
}

type Props = { params: Promise<{ opponentName: string }> }

export default async function OpponentDetailPage({ params }: Props) {
  // await requireAuth()
  const { opponentName } = await params
  const decodedName = decodeURIComponent(opponentName)
  
  // The URL might have the normalized name, so we need to match against both
  const normalizedSearchName = normalizeTeamName(decodedName)
  
  await connectToDB()

  const matches = (await Match.aggregate([
    { $match: { 'analytics.evidence_v1': { $exists: true } } },
    {
      $project: {
        _id: 1,
        gridSeriesId: 1,
        'analytics.evidence_v1.derived.mapsStats': 1,
        'analytics.evidence_v1.games': 1
      }
    },
    { $sort: { _id: -1 } }
  ])) as unknown as MatchDocument[]

  const seriesMap = new Map<string, SeriesData>()

  for (const match of matches) {
    const evidence = match.analytics?.evidence_v1
    if (!evidence) continue

    const mapsStats = getMapsStats(evidence)
    const games = evidence.games || []
    const seriesId = match.gridSeriesId

    const hasC9 = mapsStats.some(stat => stat.teamId === PRIMARY_TEAM_ID)
    if (!hasC9) continue

    let foundOpponent = ''
    for (const stat of mapsStats) {
      if (stat.teamId !== PRIMARY_TEAM_ID && stat.teamName) {
        foundOpponent = stat.teamName
        break
      }
    }

    // Match against normalized name
    const normalizedOpponent = normalizeTeamName(foundOpponent)
    if (normalizedOpponent !== normalizedSearchName) continue
    if (seriesId && seriesMap.has(seriesId)) continue

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

    const gameResults: SeriesData['games'] = []
    let c9MapsWon = 0
    let oppMapsWon = 0

    for (const game of games) {
      const stats = gameStats.get(game.gameId)
      if (!stats) continue

      const c9Won = stats.c9 > stats.opp
      if (c9Won) c9MapsWon++
      else if (stats.opp > stats.c9) oppMapsWon++

      gameResults.push({
        gameId: game.gameId,
        mapName: game.mapName,
        c9Rounds: stats.c9,
        opponentRounds: stats.opp,
        c9Won
      })
    }

    if (seriesId) {
      seriesMap.set(seriesId, {
        seriesId,
        matchId: String(match._id),
        c9MapsWon,
        opponentMapsWon: oppMapsWon,
        isWin: c9MapsWon > oppMapsWon,
        tournament: getTournamentName(seriesId),
        estimatedDate: estimateMatchDate(seriesId),
        games: gameResults
      })
    }
  }

  // Sort by seriesId descending (most recent first)
  const series = Array.from(seriesMap.values())
    .sort((a, b) => parseInt(b.seriesId) - parseInt(a.seriesId))
  
  const totalWins = series.filter(s => s.isWin).length
  const totalLosses = series.filter(s => !s.isWin).length
  const winRate = series.length > 0 ? ((totalWins / series.length) * 100).toFixed(0) : '0'

  return (
    <div className="min-h-screen pt-24 pb-12 px-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Back Button */}
        <Link 
          href="/matches" 
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors animate-fade-in"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to opponents
        </Link>

        {/* Header */}
        <header className="card p-6 animate-fade-in-up">
          <div className="flex items-center gap-6">
            <TeamLogo teamName={normalizedSearchName} size="xl" />
            <div>
              <h1 className="text-3xl font-bold text-white">vs {normalizedSearchName}</h1>
              <p className="text-gray-400 mt-1">
                {series.length} series • 
                <span className="text-green-400 font-semibold"> {totalWins}W</span> - 
                <span className="text-red-400 font-semibold"> {totalLosses}L</span>
                <span className="text-gray-500 ml-2">({winRate}% win rate)</span>
              </p>
            </div>
          </div>
        </header>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="card card-hover p-4 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <p className="text-gray-400 text-sm">Series Played</p>
            <p className="text-3xl font-bold text-[#ffffff]">{series.length}</p>
          </div>
          <div className="card card-hover p-4 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
            <p className="text-gray-400 text-sm">Series Won</p>
            <p className="text-3xl font-bold text-green-400">{totalWins}</p>
          </div>
          <div className="card card-hover p-4 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            <p className="text-gray-400 text-sm">Series Lost</p>
            <p className="text-3xl font-bold text-red-400">{totalLosses}</p>
          </div>
          <div className="card card-hover p-4 animate-fade-in-up" style={{ animationDelay: '250ms' }}>
            <p className="text-gray-400 text-sm">Win Rate</p>
            <p className={`text-3xl font-bold ${parseInt(winRate) >= 50 ? 'text-green-400' : 'text-red-400'}`}>{winRate}%</p>
          </div>
        </div>

        {/* Series List */}
        {series.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-gray-400 text-lg">No series found against {normalizedSearchName}.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Match History</h2>
            <p className="text-sm text-gray-500">Sorted by most recent first</p>
            {series.map((s, index) => (
              <Link
                key={s.seriesId}
                href={`/matches/${s.matchId}`}
                className={`card overflow-hidden animate-fade-in-up block group cursor-pointer hover:border-[#ffffff]/50 transition-all ${
                  s.isWin ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-red-500'
                }`}
                style={{ animationDelay: `${300 + index * 50}ms` }}
              >
                {/* Tournament & Date Header */}
                <div className="px-5 py-3 bg-black/40 border-b border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-[#ffffff]">
                      <Trophy className="w-4 h-4" />
                      <span className="text-sm font-medium">{s.tournament}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-500">
                      <Calendar className="w-4 h-4" />
                      <span className="text-sm">{s.estimatedDate}</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-600">Series #{s.seriesId}</span>
                </div>

                {/* Match Result */}
                <div className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className={`inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold ${
                      s.isWin 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {s.isWin ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      {s.isWin ? 'WIN' : 'LOSS'}
                    </span>
                    <span className="text-3xl font-bold text-white">
                      {s.c9MapsWon} - {s.opponentMapsWon}
                    </span>
                  </div>
                  <div className="text-gray-500 group-hover:text-[#ffffff] transition-colors">
                    View Details →
                  </div>
                </div>
                
                {/* Maps Played */}
                <div className="border-t border-gray-800 bg-black/30 px-5 py-4">
                  <div className="flex flex-wrap gap-3">
                    {s.games.map((game) => (
                      <div
                        key={game.gameId}
                        className={`flex items-center gap-3 px-4 py-2 rounded-lg border text-sm ${
                          game.c9Won 
                            ? 'bg-green-500/10 border-green-500/30' 
                            : 'bg-red-500/10 border-red-500/30'
                        }`}
                      >
                        <span className="font-semibold text-white capitalize">{game.mapName}</span>
                        <span className={game.c9Won ? 'text-green-400' : 'text-red-400'}>
                          {game.c9Rounds} - {game.opponentRounds}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
