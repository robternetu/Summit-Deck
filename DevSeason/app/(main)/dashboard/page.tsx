import { requireAuth } from '@/lib/auth'
import { connectToDB } from '@/lib/db'
import { DashboardStats as DashboardStatsModel, DashboardStatsDocument } from '@/models/DashboardStats'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { APP_SHORT_NAME, DASHBOARD_STATS_ID, LEGACY_DASHBOARD_STATS_IDS } from '@/lib/branding'

export const dynamic = 'force-dynamic'

// Tournament mapping based on series ID ranges
function getTournamentInfo(seriesId: string): { tournamentName: string; matchDate: string } {
  const mappings: [number, number, string, string][] = [
    [2843060, 2843071, 'VCT 2025 Americas Split 2', 'Dec 2025'],
    [2819676, 2819705, 'VCT 2025 Americas Stage 2', 'Nov 2025'],
    [2775953, 2789396, 'VCT 2025 Americas Stage 1', 'Sep 2025'],
    [2748743, 2748766, 'VCT 2025 Americas Kickoff', 'Feb 2025'],
    [2681809, 2681847, 'VCT 2024 Americas Playoffs', 'Aug 2024'],
    [2653969, 2654052, 'VCT 2024 Americas Stage 2', 'Jun 2024'],
    [2648624, 2648639, 'VCT 2024 Americas Stage 1', 'Apr 2024'],
    [2637961, 2637963, 'VCT 2024 Americas Stage 1', 'Mar 2024'],
    [2629390, 2629407, 'VCT 2024 Americas Kickoff', 'Feb 2024'],
  ]

  try {
    const sid = parseInt(seriesId, 10)
    for (const [start, end, tournament, date] of mappings) {
      if (sid >= start && sid <= end) {
        return { tournamentName: tournament, matchDate: date }
      }
    }
  } catch {
    // ignore
  }
  return { tournamentName: 'VCT Americas', matchDate: '' }
}

export default async function DashboardPage() {
  console.log('[DASHBOARD] Starting page render...')
  const startTime = Date.now()

  // await requireAuth()
  console.log('[DASHBOARD] Auth check bypassed')

  await connectToDB()
  console.log('[DASHBOARD] DB connection completed in', Date.now() - startTime, 'ms')

  // Fetch pre-computed dashboard stats - single document query
  const dashboardStatsDoc = await DashboardStatsModel.findOne({
    _id: { $in: [DASHBOARD_STATS_ID, ...LEGACY_DASHBOARD_STATS_IDS] },
  }).lean() as DashboardStatsDocument | null

  console.log('[DASHBOARD] Stats fetch completed in', Date.now() - startTime, 'ms')

  // Convert MongoDB document to plain object
  const stats = dashboardStatsDoc ? {
    totalSeries: dashboardStatsDoc.totalSeries,
    seriesWins: dashboardStatsDoc.seriesWins,
    seriesLosses: dashboardStatsDoc.seriesLosses,
    mapsPlayed: dashboardStatsDoc.mapsPlayed instanceof Map
      ? Object.fromEntries(dashboardStatsDoc.mapsPlayed)
      : dashboardStatsDoc.mapsPlayed,
    attackWinRate: dashboardStatsDoc.attackWinRate,
    defenseWinRate: dashboardStatsDoc.defenseWinRate,
    recentSeries: dashboardStatsDoc.recentSeries,
    strugglingAgainst: dashboardStatsDoc.strugglingAgainst,
  } : {
    totalSeries: 0,
    seriesWins: 0,
    seriesLosses: 0,
    mapsPlayed: {},
    attackWinRate: 0,
    defenseWinRate: 0,
    recentSeries: [],
    strugglingAgainst: [],
  }

  const winRate = stats.totalSeries > 0 ? ((stats.seriesWins / stats.totalSeries) * 100).toFixed(0) : '0'

  return (
    <div className="min-h-screen pt-24 pb-12 px-6 relative">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 animate-fade-in-up">
          <h1 className="text-4xl font-bold text-white mb-2 md:text-5xl">
            {APP_SHORT_NAME} <span className="text-gradient-blue">overview snapshot</span>
          </h1>
          <p className="text-[rgb(var(--muted-foreground))]">Performance snapshot across {stats.totalSeries} tracked series.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <StatCard title="Series Played" value={stats.totalSeries} color="blue" delay={0} />
          <StatCard title="Series Wins" value={stats.seriesWins} color="green" delay={100} />
          <StatCard title="Series Losses" value={stats.seriesLosses} color="red" delay={200} />
          <StatCard title="Win Rate" value={`${winRate}%`} color="cyan" delay={300} />
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Map Breakdown */}
          <div className="card p-6 animate-slide-in-left" style={{ animationDelay: '200ms' }}>
            <h2 className="text-xl font-semibold text-white mb-6">Map footprint</h2>
            <div className="space-y-3">
              {Object.entries(stats.mapsPlayed)
                .sort((a, b) => b[1] - a[1])
                .map(([mapName, count], index) => (
                  <div
                    key={mapName}
                    className="flex items-center justify-between p-3 bg-black/30 rounded-lg hover:bg-black/50 transition-all cursor-pointer"
                    style={{ animationDelay: `${300 + index * 50}ms` }}
                  >
                    <span className="text-gray-300 capitalize">{mapName}</span>
                    <span className="font-medium text-[rgb(var(--accent-soft))]">{count} games</span>
                  </div>
                ))}
              {Object.keys(stats.mapsPlayed).length === 0 && (
                <p className="text-gray-500 italic">No matches recorded yet.</p>
              )}
            </div>
          </div>

          {/* Side Win Rate */}
          <div className="card p-6 animate-slide-in-right" style={{ animationDelay: '200ms' }}>
            <h2 className="text-xl font-semibold text-white mb-6">Side efficiency</h2>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Attack</span>
                  <span className="text-gray-300 font-medium">{(stats.attackWinRate * 100).toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-500 to-orange-500 transition-all duration-1000"
                    style={{ width: `${stats.attackWinRate * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Defense</span>
                  <span className="text-gray-300 font-medium">{(stats.defenseWinRate * 100).toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-1000"
                    style={{ width: `${stats.defenseWinRate * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Struggling Against Section */}
        <div className="card p-6 mb-8 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          <h2 className="text-xl font-semibold text-white mb-6">Pressure matchups</h2>
          <div className="space-y-3">
            {stats.strugglingAgainst.length > 0 ? (
              stats.strugglingAgainst.map((record, index) => {
                const totalSeries = record.seriesWins + record.seriesLosses
                const winRate = totalSeries > 0
                  ? ((record.seriesWins / totalSeries) * 100).toFixed(0)
                  : '0'
                return (
                  <Link
                    key={record.name}
                    href={`/matches/opponent/${encodeURIComponent(record.name)}`}
                    className="flex items-center justify-between p-3 bg-black/30 rounded-lg hover:bg-black/50 transition-all cursor-pointer"
                    style={{ animationDelay: `${300 + index * 50}ms` }}
                  >
                    <div className="flex-1">
                      <div className="text-gray-300 font-medium">{record.name}</div>
                      <div className="text-sm text-gray-500">
                        {record.seriesWins}W - {record.seriesLosses}L ({record.mapsWon}-{record.mapsLost} maps)
                      </div>
                    </div>
                    <div className="text-sm text-red-400 font-semibold">{winRate}%</div>
                  </Link>
                )
              })
            ) : (
              <p className="text-gray-500 italic">Performing well against all opponents!</p>
            )}
          </div>
        </div>

        {/* Recent Series Table */}
        <div className="card animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Recent series</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="text-left py-4 px-6 text-gray-400 font-medium">Opponent</th>
                  <th className="text-left py-4 px-6 text-gray-400 font-medium">Tournament</th>
                  <th className="text-center py-4 px-6 text-gray-400 font-medium">Result</th>
                  <th className="text-center py-4 px-6 text-gray-400 font-medium">Maps</th>
                  <th className="text-right py-4 px-6 text-gray-400 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentSeries.length === 0 ? (
                  <tr>
                    <td className="py-6 px-6 text-gray-500 text-center" colSpan={5}>
                      No series found.
                    </td>
                  </tr>
                ) : (
                  stats.recentSeries.map((series, index) => {
                    // Use stored tournament info or derive from seriesId
                    const tournamentInfo = series.tournamentName 
                      ? { tournamentName: series.tournamentName, matchDate: series.matchDate || '' }
                      : getTournamentInfo(series.seriesId)
                    
                    return (
                      <tr
                        key={series.seriesId}
                        className="table-row"
                        style={{ animationDelay: `${500 + index * 50}ms` }}
                      >
                        <td className="py-4 px-6 text-gray-300 font-medium">{series.opponent}</td>
                        <td className="py-4 px-6">
                          <div className="text-gray-300 text-sm">{tournamentInfo.tournamentName}</div>
                          {tournamentInfo.matchDate && (
                            <div className="text-gray-500 text-xs">{tournamentInfo.matchDate}</div>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center">
                          <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-semibold ${
                            series.isWin 
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                              : 'bg-red-500/20 text-red-400 border border-red-500/30'
                          }`}>
                            {series.isWin ? 'WIN' : 'LOSS'}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-center text-gray-400">
                          {series.c9MapsWon ?? 0} - {series.opponentMapsWon}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <Link
                            href={`/matches/opponent/${encodeURIComponent(series.opponent)}`}
                            className="text-[rgb(var(--accent-soft))] hover:text-[rgb(var(--accent-strong))] transition-colors inline-flex items-center gap-1"
                          >
                            View <ChevronRight className="w-4 h-4" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-gray-800 bg-black">
            <Link
              href="/matches"
              className="text-[rgb(var(--accent-soft))] hover:text-[rgb(var(--accent-strong))] transition-colors font-medium inline-flex items-center gap-1"
            >
              View all opponents <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  color,
  delay = 0
}: {
  title: string
  value: number | string
  color: 'blue' | 'green' | 'red' | 'cyan'
  delay?: number
}) {
  const colorClasses = {
    blue: 'text-[rgb(var(--accent-soft))]',
    green: 'text-green-400',
    red: 'text-red-400',
    cyan: 'text-[rgb(var(--accent-strong))]'
  }

  return (
    <div
      className="card card-hover p-6 animate-fade-in-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-gray-400 text-sm mb-2">{title}</p>
      <p className={`text-4xl font-bold ${colorClasses[color]}`}>{value}</p>
    </div>
  )
}
