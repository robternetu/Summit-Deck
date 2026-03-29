'use client'

import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend
} from 'recharts'

interface EconomyRound {
  gameId: string
  roundNumber: number
  teamId: string
  teamName: string
  avgLoadoutValue: number
  economyTier: 'full_buy' | 'half_buy' | 'eco' | 'save'
  roundWon: boolean
}

interface EconomyTimelineProps {
  economyRounds: EconomyRound[]
  teamId: string
  teamName: string
  opponentTeamId: string
  opponentName: string
}

const ECONOMY_TIERS: Record<string, { min: number; color: string; label: string }> = {
  full_buy: { min: 3900, color: '#10B981', label: 'Full Buy' },
  half_buy: { min: 2600, color: '#F59E0B', label: 'Half Buy' },
  eco: { min: 1500, color: '#EF4444', label: 'Eco' },
  save: { min: 0, color: '#6B7280', label: 'Save' }
}

export default function EconomyTimeline({
  economyRounds,
  teamId,
  teamName,
  opponentTeamId,
  opponentName
}: EconomyTimelineProps) {
  // Process data for chart
  const chartData = useMemo(() => {
    // Group by round
    const byRound: Record<number, {
      round: number
      roundLabel: string
      teamEconomy?: number
      opponentEconomy?: number
      teamTier?: string
      opponentTier?: string
      teamWon?: boolean
    }> = {}

    for (const eco of economyRounds) {
      if (!byRound[eco.roundNumber]) {
        byRound[eco.roundNumber] = {
          round: eco.roundNumber,
          roundLabel: `R${eco.roundNumber}`
        }
      }

      if (eco.teamId === teamId) {
        byRound[eco.roundNumber].teamEconomy = eco.avgLoadoutValue
        byRound[eco.roundNumber].teamTier = eco.economyTier
        byRound[eco.roundNumber].teamWon = eco.roundWon
      } else {
        byRound[eco.roundNumber].opponentEconomy = eco.avgLoadoutValue
        byRound[eco.roundNumber].opponentTier = eco.economyTier
      }
    }

    return Object.values(byRound).sort((a, b) => a.round - b.round)
  }, [economyRounds, teamId])

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: typeof chartData[0] }> }) => {
    if (!active || !payload?.length) return null

    const data = payload[0].payload

    const getTierLabel = (tier: string) => ECONOMY_TIERS[tier]?.label || tier
    const getTierColor = (tier: string) => ECONOMY_TIERS[tier]?.color || '#888'

    return (
      <div className="bg-gray-900/95 border border-gray-700 rounded-lg p-3 shadow-xl">
        <p className="text-white font-semibold mb-2">Round {data.round}</p>

        <div className="space-y-2">
          <div>
            <p className="text-blue-400 text-sm">{teamName}</p>
            <p className="text-white">
              ${data.teamEconomy?.toLocaleString() || 'N/A'}
              {data.teamTier && (
                <span
                  className="ml-2 text-xs px-2 py-0.5 rounded"
                  style={{ backgroundColor: getTierColor(data.teamTier), color: 'white' }}
                >
                  {getTierLabel(data.teamTier)}
                </span>
              )}
            </p>
          </div>

          <div>
            <p className="text-red-400 text-sm">{opponentName}</p>
            <p className="text-white">
              ${data.opponentEconomy?.toLocaleString() || 'N/A'}
              {data.opponentTier && (
                <span
                  className="ml-2 text-xs px-2 py-0.5 rounded"
                  style={{ backgroundColor: getTierColor(data.opponentTier), color: 'white' }}
                >
                  {getTierLabel(data.opponentTier)}
                </span>
              )}
            </p>
          </div>
        </div>

        {data.teamWon !== undefined && (
          <p className={`mt-2 text-sm ${data.teamWon ? 'text-green-400' : 'text-red-400'}`}>
            {data.teamWon ? '✓ Round Won' : '✗ Round Lost'}
          </p>
        )}
      </div>
    )
  }

  if (economyRounds.length === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6 text-center">
        <p className="text-gray-400">No economy data available</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Economy Timeline</h3>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="teamEcoGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="oppEcoGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#EF4444" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
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
              stroke="#9CA3AF"
              fontSize={12}
              tickLine={false}
              tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
            />

            {/* Full buy threshold line */}
            <ReferenceLine
              y={3900}
              stroke="#10B981"
              strokeDasharray="5 5"
              label={{ value: 'Full Buy', position: 'right', fill: '#10B981', fontSize: 10 }}
            />

            {/* Eco threshold line */}
            <ReferenceLine
              y={1500}
              stroke="#EF4444"
              strokeDasharray="5 5"
              label={{ value: 'Eco', position: 'right', fill: '#EF4444', fontSize: 10 }}
            />

            <Tooltip content={<CustomTooltip />} />

            <Legend />

            <Area
              type="monotone"
              dataKey="teamEconomy"
              name={teamName}
              stroke="#3B82F6"
              fill="url(#teamEcoGradient)"
              strokeWidth={2}
            />

            <Area
              type="monotone"
              dataKey="opponentEconomy"
              name={opponentName}
              stroke="#EF4444"
              fill="url(#oppEcoGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Economy tier legend */}
      <div className="flex justify-center gap-4 mt-4 text-xs text-gray-300">
        {Object.entries(ECONOMY_TIERS).map(([key, tier]) => (
          <span key={key} className="flex items-center gap-1">
            <span
              className="w-3 h-3 rounded"
              style={{ backgroundColor: tier.color }}
            />
            {tier.label} (${tier.min.toLocaleString()}+)
          </span>
        ))}
      </div>
    </div>
  )
}
