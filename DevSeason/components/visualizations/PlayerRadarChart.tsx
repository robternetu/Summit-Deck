'use client'

import { useMemo } from 'react'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip
} from 'recharts'

interface PlayerStats {
  playerId: string
  playerName: string
  teamId: string
  // Normalized 0-100 scores for each metric
  metrics: {
    adr: number           // Average Damage per Round
    kast: number          // KAST %
    clutchRate: number    // Clutch win %
    firstBloodRate: number // Opening duel win rate
    tradeRate: number     // Trade participation
    impactRating: number  // Multi-kill impact
  }
}

interface PlayerRadarChartProps {
  players: PlayerStats[]
  selectedPlayers?: string[]  // Player IDs to highlight
  showTeamAverage?: boolean
  compactMode?: boolean
}

const METRIC_LABELS: Record<string, string> = {
  adr: 'ADR',
  kast: 'KAST%',
  clutchRate: 'Clutch',
  firstBloodRate: 'Entry',
  tradeRate: 'Trading',
  impactRating: 'Impact'
}

const METRIC_COLORS = [
  '#3B82F6',  // Blue
  '#10B981',  // Green
  '#F59E0B',  // Amber
  '#EF4444',  // Red
  '#8B5CF6',  // Purple
  '#EC4899',  // Pink
]

export default function PlayerRadarChart({
  players,
  selectedPlayers,
  showTeamAverage = false,
  compactMode = false
}: PlayerRadarChartProps) {
  // Transform data for radar chart
  const chartData = useMemo(() => {
    const metrics = ['adr', 'kast', 'clutchRate', 'firstBloodRate', 'tradeRate', 'impactRating'] as const

    return metrics.map(metric => {
      const dataPoint: Record<string, string | number> = {
        metric: METRIC_LABELS[metric],
        fullMark: 100
      }

      // Add each player's value
      players.forEach(player => {
        if (!selectedPlayers || selectedPlayers.includes(player.playerId)) {
          dataPoint[player.playerName] = player.metrics[metric] || 0
        }
      })

      // Add team average if requested
      if (showTeamAverage) {
        const avg = players.reduce((sum, p) =>
          sum + (p.metrics[metric] || 0), 0
        ) / players.length
        dataPoint['Team Avg'] = Math.round(avg)
      }

      return dataPoint
    })
  }, [players, selectedPlayers, showTeamAverage])

  // Get players to display
  const displayPlayers = useMemo(() => {
    if (selectedPlayers) {
      return players.filter(p => selectedPlayers.includes(p.playerId))
    }
    return players.slice(0, 3)  // Max 3 for readability
  }, [players, selectedPlayers])

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; payload: typeof chartData[0] }> }) => {
    if (!active || !payload?.length) return null

    return (
      <div className="bg-gray-900/95 border border-gray-700 rounded-lg p-3 shadow-xl">
        <p className="text-white font-semibold mb-2">{payload[0]?.payload?.metric}</p>
        {payload.map((entry, idx) => (
          <p key={idx} style={{ color: entry.color }} className="text-sm">
            {entry.name}: {entry.value}
          </p>
        ))}
      </div>
    )
  }

  if (players.length === 0) {
    return (
      <div className={`bg-gray-900/50 rounded-xl border border-gray-700 ${compactMode ? 'p-4' : 'p-6'} text-center`}>
        <p className="text-gray-400">No player data available</p>
      </div>
    )
  }

  return (
    <div className={`bg-gray-900/50 rounded-xl border border-gray-700 ${compactMode ? 'p-4' : 'p-6'}`}>
      <h3 className={`font-semibold text-white ${compactMode ? 'text-base mb-2' : 'text-lg mb-4'}`}>
        Player Performance Radar
      </h3>

      <div className={compactMode ? 'h-48' : 'h-80'}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
            <PolarGrid stroke="#374151" />
            <PolarAngleAxis
              dataKey="metric"
              tick={{ fill: '#9CA3AF', fontSize: compactMode ? 10 : 12 }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tick={{ fill: '#6B7280', fontSize: 10 }}
              tickCount={5}
            />

            {displayPlayers.map((player, idx) => (
              <Radar
                key={player.playerId}
                name={player.playerName}
                dataKey={player.playerName}
                stroke={METRIC_COLORS[idx % METRIC_COLORS.length]}
                fill={METRIC_COLORS[idx % METRIC_COLORS.length]}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            ))}

            {showTeamAverage && (
              <Radar
                name="Team Avg"
                dataKey="Team Avg"
                stroke="#6B7280"
                fill="#6B7280"
                fillOpacity={0.1}
                strokeWidth={1}
                strokeDasharray="5 5"
              />
            )}

            <Legend
              wrapperStyle={{
                paddingTop: compactMode ? 10 : 20,
                fontSize: compactMode ? 10 : 12
              }}
            />
            <Tooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
