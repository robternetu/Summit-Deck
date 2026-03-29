import Link from 'next/link'
import { requireAuth } from '@/lib/auth'
import { connectToDB } from '@/lib/db'
import { Match, type MatchDocument } from '@/models/Match'
import { TeamLogo } from '@/components/ui/TeamLogo'
import { normalizeTeamName, getTeamKey } from '@/lib/teamUtils'
import { getMapsStats, PRIMARY_TEAM_ID } from '@/lib/types/evidence'
import { APP_SHORT_NAME } from '@/lib/branding'

export const dynamic = 'force-dynamic'

interface OpponentStats {
  name: string
  seriesCount: number
  seriesWins: number
  seriesLosses: number
  mapsWon: number
  mapsLost: number
}

function getOpponentStats(matches: MatchDocument[]): OpponentStats[] {
  const c9Matches = matches.filter(match => {
    const mapsStats = getMapsStats(match.analytics?.evidence_v1)
    if (mapsStats.length === 0) return false
    return mapsStats.some(stat => stat.teamId === PRIMARY_TEAM_ID)
  })

  // Use normalized team key for grouping
  const opponentMap = new Map<string, {
    displayName: string  // Use the first encountered name (without suffix)
    seriesIds: Set<string>
    seriesWins: number
    seriesLosses: number
    mapsWon: number
    mapsLost: number
  }>()

  for (const match of c9Matches) {
    const evidence = match.analytics?.evidence_v1
    if (!evidence) continue

    const mapsStats = getMapsStats(evidence)
    const seriesId = match.gridSeriesId

    let rawOpponentName = 'Unknown'
    for (const stat of mapsStats) {
      if (stat.teamId !== PRIMARY_TEAM_ID && stat.teamName) {
        rawOpponentName = stat.teamName
        break
      }
    }

    // Normalize the team name (removes "(1)" suffix)
    const normalizedName = normalizeTeamName(rawOpponentName)
    const teamKey = getTeamKey(rawOpponentName)

    if (!opponentMap.has(teamKey)) {
      opponentMap.set(teamKey, {
        displayName: normalizedName,
        seriesIds: new Set(),
        seriesWins: 0,
        seriesLosses: 0,
        mapsWon: 0,
        mapsLost: 0
      })
    }

    const opponent = opponentMap.get(teamKey)!
    
    if (seriesId && !opponent.seriesIds.has(seriesId)) {
      opponent.seriesIds.add(seriesId)

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

      let c9MapsWon = 0
      let oppMapsWon = 0
      for (const [, stats] of gameStats) {
        if (stats.c9 > stats.opp) {
          c9MapsWon++
          opponent.mapsWon++
        } else if (stats.opp > stats.c9) {
          oppMapsWon++
          opponent.mapsLost++
        }
      }

      if (c9MapsWon > oppMapsWon) {
        opponent.seriesWins++
      } else if (oppMapsWon > c9MapsWon) {
        opponent.seriesLosses++
      }
    }
  }

  return Array.from(opponentMap.entries())
    .map(([, stats]) => ({
      name: stats.displayName,  // Use normalized display name
      seriesCount: stats.seriesIds.size,
      seriesWins: stats.seriesWins,
      seriesLosses: stats.seriesLosses,
      mapsWon: stats.mapsWon,
      mapsLost: stats.mapsLost,
    }))
    .sort((a, b) => b.seriesCount - a.seriesCount)
}

export default async function MatchesPage() {
  // await requireAuth()
  await connectToDB()

  const matches = (await Match.aggregate([
    { $match: { 'analytics.evidence_v1': { $exists: true } } },
    {
      $project: {
        gridSeriesId: 1,
        'analytics.evidence_v1.derived.mapsStats': 1
      }
    },
    { $sort: { _id: -1 } }
  ])) as unknown as MatchDocument[]

  const opponents = getOpponentStats(matches)

  return (
    <div className="min-h-screen pt-24 pb-12 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 animate-fade-in-up">
          <h1 className="text-4xl font-bold text-white mb-2">Opponents</h1>
          <p className="text-[rgb(var(--muted-foreground))]">
            {APP_SHORT_NAME} scouting index by opponent • {opponents.length} teams faced
          </p>
        </div>

        {/* Opponent Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {opponents.map((opponent, index) => {
            const winRate = opponent.seriesCount > 0 
              ? ((opponent.seriesWins / opponent.seriesCount) * 100).toFixed(0) 
              : '0'
            const isPositive = opponent.seriesWins > opponent.seriesLosses

            return (
              <Link
                key={opponent.name}
                href={`/matches/opponent/${encodeURIComponent(opponent.name)}`}
                className="card card-hover p-6 cursor-pointer group animate-fade-in-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Logo */}
                <div className="mb-4 flex justify-center">
                  <TeamLogo teamName={opponent.name} size="lg" />
                </div>

                {/* Team Name */}
                <h3 className="text-center text-lg font-semibold text-white mb-4 group-hover:text-[#ffffff] transition-colors">
                  {opponent.name}
                </h3>

                {/* Stats */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Series</span>
                    <span className={isPositive ? 'text-green-400' : 'text-red-400'}>
                      {opponent.seriesWins}W - {opponent.seriesLosses}L
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Maps</span>
                    <span className="text-[#ffffff]">
                      {opponent.mapsWon} - {opponent.mapsLost}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b border-gray-800">
                    <span className="text-gray-400 text-sm">Series played</span>
                    <span className="text-gray-300">{opponent.seriesCount}</span>
                  </div>

                  {/* Win Rate Bar */}
                  <div>
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-400 text-xs">Win Rate</span>
                      <span className="text-xs text-gray-300">{winRate}%</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-1000 ${
                          isPositive
                            ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                            : 'bg-gradient-to-r from-red-500 to-rose-500'
                        }`}
                        style={{ width: `${winRate}%` }}
                      />
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>

        {opponents.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            No tracked featured-team matches found.
          </div>
        )}
      </div>
    </div>
  )
}
