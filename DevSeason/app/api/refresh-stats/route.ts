import { NextResponse } from 'next/server'
import { connectToDB } from '@/lib/db'
import { Match } from '@/models/Match'
import { DashboardStats } from '@/models/DashboardStats'
import { DASHBOARD_STATS_ID, PRIMARY_TEAM_ID } from '@/lib/branding'

export async function POST() {
  try {
    console.log('[REFRESH-STATS] Starting dashboard stats refresh...')
    const startTime = Date.now()

    await connectToDB()
    console.log('[REFRESH-STATS] Connected to DB in', Date.now() - startTime, 'ms')

    // Get all C9 matches with evidence
    const matches = await Match.aggregate([
      {
        $match: {
          'analytics.evidence_v1.derived.mapsStats': {
            $elemMatch: { teamId: PRIMARY_TEAM_ID }
          }
        }
      },
      {
        $project: {
          gridSeriesId: 1,
          date: 1,
          games: '$analytics.evidence_v1.games',
          mapsStats: '$analytics.evidence_v1.derived.mapsStats',
          rounds: '$analytics.evidence_v1.rounds'
        }
      }
    ])

    console.log('[REFRESH-STATS] Found', matches.length, 'C9 matches in', Date.now() - startTime, 'ms')

    // Process matches into series
    const seriesMap = new Map<string, any>()
    const mapsPlayed: Record<string, number> = {}
    const opponentRecords: Record<string, { wins: number; losses: number; mapsWon: number; mapsLost: number }> = {}

    let attackWins = 0, attackTotal = 0
    let defenseWins = 0, defenseTotal = 0

    for (const match of matches) {
      const seriesId = match.gridSeriesId
      if (!seriesId) continue

      // Process rounds for attack/defense stats
      for (const round of match.rounds || []) {
        const side = round.winnerSide
        const winnerId = round.winnerTeamId

        if (side === 'attack' || side === 'attacker') {
          attackTotal++
          if (winnerId === PRIMARY_TEAM_ID) attackWins++
        } else if (side === 'defense' || side === 'defender') {
          defenseTotal++
          if (winnerId === PRIMARY_TEAM_ID) defenseWins++
        }
      }

      // Process games for series stats
      for (const game of match.games || []) {
        const c9Stats = match.mapsStats?.find(
          (s: any) => s.gameId === game.gameId && s.teamId === PRIMARY_TEAM_ID
        )
        const oppStats = match.mapsStats?.find(
          (s: any) => s.gameId === game.gameId && s.teamId !== PRIMARY_TEAM_ID
        )

        if (!c9Stats || !oppStats) continue

        // Count map plays
        const mapName = game.mapName || 'Unknown'
        mapsPlayed[mapName] = (mapsPlayed[mapName] || 0) + 1

        // Track series data
        if (!seriesMap.has(seriesId)) {
          seriesMap.set(seriesId, {
            seriesId,
            date: match.date,
            opponent: oppStats.teamName || 'Unknown',
            c9MapsWon: 0,
            opponentMapsWon: 0,
            games: []
          })
        }

        const series = seriesMap.get(seriesId)!
        const c9Rounds = c9Stats.roundsWon || 0
        const oppRounds = oppStats.roundsWon || 0

        series.games.push({
          mapName,
          c9Rounds,
          opponentRounds: oppRounds
        })

        if (c9Rounds > oppRounds) {
          series.c9MapsWon++
        } else if (oppRounds > c9Rounds) {
          series.opponentMapsWon++
        }
      }
    }

    // Calculate series wins/losses and opponent records
    let seriesWins = 0, seriesLosses = 0
    const allSeries: any[] = []

    for (const [seriesId, series] of seriesMap) {
      const isWin = series.c9MapsWon > series.opponentMapsWon
      series.isWin = isWin

      if (isWin) {
        seriesWins++
      } else if (series.opponentMapsWon > series.c9MapsWon) {
        seriesLosses++
      }

      // Track opponent records
      const opponent = series.opponent
      if (!opponentRecords[opponent]) {
        opponentRecords[opponent] = { wins: 0, losses: 0, mapsWon: 0, mapsLost: 0 }
      }
      if (isWin) {
        opponentRecords[opponent].wins++
      } else if (series.opponentMapsWon > series.c9MapsWon) {
        opponentRecords[opponent].losses++
      }
      opponentRecords[opponent].mapsWon += series.c9MapsWon
      opponentRecords[opponent].mapsLost += series.opponentMapsWon

      allSeries.push(series)
    }

    // Sort series by date and take recent 10
    allSeries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const recentSeries = allSeries.slice(0, 10).map(s => ({
      seriesId: s.seriesId,
      opponent: s.opponent,
      c9MapsWon: s.c9MapsWon,
      opponentMapsWon: s.opponentMapsWon,
      isWin: s.isWin,
      games: s.games
    }))

    // Find struggling opponents (>50% loss rate, min 2 series)
    const strugglingAgainst = Object.entries(opponentRecords)
      .filter(([_, record]) => {
        const total = record.wins + record.losses
        return total >= 2 && record.losses / total > 0.5
      })
      .map(([name, record]) => ({
        name,
        seriesWins: record.wins,
        seriesLosses: record.losses,
        mapsWon: record.mapsWon,
        mapsLost: record.mapsLost
      }))
      .sort((a, b) => {
        const aRate = a.seriesLosses / (a.seriesWins + a.seriesLosses)
        const bRate = b.seriesLosses / (b.seriesWins + b.seriesLosses)
        return bRate - aRate || b.seriesLosses - a.seriesLosses
      })
      .slice(0, 5)

    // Build final stats document
    const statsDoc = {
      _id: DASHBOARD_STATS_ID,
      totalSeries: seriesMap.size,
      seriesWins,
      seriesLosses,
      mapsPlayed,
      attackWinRate: attackTotal > 0 ? attackWins / attackTotal : 0,
      defenseWinRate: defenseTotal > 0 ? defenseWins / defenseTotal : 0,
      recentSeries,
      strugglingAgainst,
      lastUpdated: new Date(),
      matchesProcessed: matches.length
    }

    console.log('[REFRESH-STATS] Computed stats:', {
      totalSeries: statsDoc.totalSeries,
      seriesWins: statsDoc.seriesWins,
      seriesLosses: statsDoc.seriesLosses,
      attackWinRate: (statsDoc.attackWinRate * 100).toFixed(1) + '%',
      defenseWinRate: (statsDoc.defenseWinRate * 100).toFixed(1) + '%'
    })

    // Upsert the stats document
    await DashboardStats.findOneAndUpdate(
      { _id: DASHBOARD_STATS_ID },
      statsDoc,
      { upsert: true, new: true }
    )

    console.log('[REFRESH-STATS] Saved stats in', Date.now() - startTime, 'ms')

    return NextResponse.json({
      success: true,
      stats: {
        totalSeries: statsDoc.totalSeries,
        seriesWins: statsDoc.seriesWins,
        seriesLosses: statsDoc.seriesLosses,
        winRate: ((seriesWins / seriesMap.size) * 100).toFixed(1) + '%',
        attackWinRate: (statsDoc.attackWinRate * 100).toFixed(1) + '%',
        defenseWinRate: (statsDoc.defenseWinRate * 100).toFixed(1) + '%',
        recentSeriesCount: recentSeries.length,
        strugglingAgainstCount: strugglingAgainst.length
      },
      timing: Date.now() - startTime
    })
  } catch (error) {
    console.error('[REFRESH-STATS] Error:', error)
    return NextResponse.json(
      { error: 'Failed to refresh dashboard stats' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Use POST to refresh dashboard stats'
  })
}
