'use client'

import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Area,
  ComposedChart
} from 'recharts'

interface WinProbabilityTimelineProps {
  rounds: Array<{
    roundNumber: number
    gameId: string
    winnerTeamId: string
    teamWinProb?: number  // 0-1, featured team win probability
    momentumShift?: boolean
    isClutch?: boolean
    isCritical?: boolean
  }>
  teamId: string  // Featured team ID
  teamName: string
  opponentName: string
  games: Array<{
    gameId: string
    mapName: string
  }>
}

export default function WinProbabilityTimeline({
  rounds,
  teamId,
  teamName,
  opponentName,
  games
}: WinProbabilityTimelineProps) {
  // Process data for chart
  const chartData = useMemo(() => {
    let teamScore = 0
    let opponentScore = 0

    return rounds.map((round) => {
      const isTeamWin = round.winnerTeamId === teamId
      if (isTeamWin) teamScore++
      else opponentScore++

      // Calculate win probability based on score
      // Simple model: based on rounds needed to win
      const teamRoundsToWin = 13 - teamScore
      const oppRoundsToWin = 13 - opponentScore
      const totalRoundsLeft = teamRoundsToWin + oppRoundsToWin

      // Bayesian-ish probability
      let winProb = round.teamWinProb
      if (!winProb) {
        // Estimate from score
        winProb = oppRoundsToWin / Math.max(totalRoundsLeft, 1)
      }

      // Find map name
      const game = games.find(g => g.gameId === round.gameId)
      const mapName = game?.mapName || 'Unknown'

      return {
        round: round.roundNumber,
        roundLabel: `R${round.roundNumber}`,
        winProb: Math.round(winProb * 100),
        teamScore,
        opponentScore,
        score: `${teamScore}-${opponentScore}`,
        isTeamWin,
        mapName,
        gameId: round.gameId,
        isClutch: round.isClutch,
        isCritical: round.isCritical,
        momentumShift: round.momentumShift
      }
    })
  }, [rounds, teamId, games])

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: typeof chartData[0] }> }) => {
    if (!active || !payload?.length) return null

    const data = payload[0].payload

    return (
      <div className="bg-gray-900/95 border border-gray-700 rounded-lg p-3 shadow-xl">
        <p className="text-white font-semibold">{data.mapName} - Round {data.round}</p>
        <p className="text-gray-300">Score: {data.score}</p>
        <p className={`font-bold ${data.winProb >= 50 ? 'text-green-400' : 'text-red-400'}`}>
          Win Probability: {data.winProb}%
        </p>
        {data.isClutch && <p className="text-yellow-400 text-sm">⚡ Clutch Round</p>}
        {data.isCritical && <p className="text-orange-400 text-sm">🔥 Critical Round</p>}
        {data.momentumShift && <p className="text-purple-400 text-sm">📈 Momentum Shift</p>}
      </div>
    )
  }

  // Custom dot for special rounds
  const CustomDot = (props: { cx?: number; cy?: number; payload?: typeof chartData[0] }) => {
    const { cx, cy, payload } = props

    if (!cx || !cy || !payload) return null

    if (payload.isClutch) {
      return (
        <circle cx={cx} cy={cy} r={6} fill="#EAB308" stroke="#FDE047" strokeWidth={2} />
      )
    }
    if (payload.isCritical) {
      return (
        <circle cx={cx} cy={cy} r={5} fill="#F97316" stroke="#FB923C" strokeWidth={2} />
      )
    }
    if (payload.momentumShift) {
      return (
        <circle cx={cx} cy={cy} r={5} fill="#A855F7" stroke="#C084FC" strokeWidth={2} />
      )
    }

    return null
  }

  if (rounds.length === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6 text-center">
        <p className="text-gray-400">No round data available</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Win Probability Timeline</h3>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
            Clutch
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-orange-500"></span>
            Critical
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-purple-500"></span>
            Momentum
          </span>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="winProbGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />

            <XAxis
              dataKey="roundLabel"
              stroke="#9CA3AF"
              fontSize={12}
              tickLine={false}
            />

            <YAxis
              domain={[0, 100]}
              stroke="#9CA3AF"
              fontSize={12}
              tickLine={false}
              tickFormatter={(val) => `${val}%`}
            />

            {/* 50% reference line */}
            <ReferenceLine
              y={50}
              stroke="#6B7280"
              strokeDasharray="5 5"
              label={{ value: '50%', position: 'right', fill: '#9CA3AF', fontSize: 10 }}
            />

            <Tooltip content={<CustomTooltip />} />

            {/* Area fill under line */}
            <Area
              type="monotone"
              dataKey="winProb"
              stroke="transparent"
              fill="url(#winProbGradient)"
            />

            {/* Main probability line */}
            <Line
              type="monotone"
              dataKey="winProb"
              stroke="#3B82F6"
              strokeWidth={2}
              dot={<CustomDot />}
              activeDot={{ r: 6, fill: '#3B82F6', stroke: '#60A5FA', strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Map separators / Game indicators */}
      <div className="flex justify-center gap-2 mt-4">
        {games.map((game, idx) => (
          <span
            key={game.gameId}
            className="px-3 py-1 bg-gray-800 rounded-full text-xs text-gray-300"
          >
            Map {idx + 1}: {game.mapName}
          </span>
        ))}
      </div>
    </div>
  )
}
