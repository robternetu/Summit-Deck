'use client'

interface PlayerMetric {
  label: string
  value: number
  maxValue: number
  format?: 'percent' | 'number' | 'decimal'
  higherIsBetter?: boolean
}

interface PlayerComparisonCardProps {
  player1: {
    name: string
    agent?: string
    metrics: PlayerMetric[]
  }
  player2: {
    name: string
    agent?: string
    metrics: PlayerMetric[]
  }
  title?: string
}

export default function PlayerComparisonCard({
  player1,
  player2,
  title = 'Player Comparison'
}: PlayerComparisonCardProps) {
  const formatValue = (value: number, format?: string) => {
    switch (format) {
      case 'percent':
        return `${(value * 100).toFixed(1)}%`
      case 'decimal':
        return value.toFixed(2)
      default:
        return Math.round(value).toString()
    }
  }

  const getBarColor = (value1: number, value2: number, higherIsBetter: boolean = true) => {
    const isP1Better = higherIsBetter ? value1 > value2 : value1 < value2
    return {
      p1: isP1Better ? 'bg-green-500' : 'bg-blue-500',
      p2: !isP1Better ? 'bg-green-500' : 'bg-blue-500'
    }
  }

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>

      {/* Player headers */}
      <div className="flex justify-between mb-6">
        <div className="text-center">
          <p className="text-white font-semibold">{player1.name}</p>
          {player1.agent && (
            <p className="text-gray-400 text-sm">{player1.agent}</p>
          )}
        </div>
        <div className="text-center">
          <p className="text-white font-semibold">{player2.name}</p>
          {player2.agent && (
            <p className="text-gray-400 text-sm">{player2.agent}</p>
          )}
        </div>
      </div>

      {/* Metrics comparison */}
      <div className="space-y-4">
        {player1.metrics.map((metric, idx) => {
          const p2Metric = player2.metrics[idx]
          const colors = getBarColor(metric.value, p2Metric.value, metric.higherIsBetter)

          const p1Percent = (metric.value / metric.maxValue) * 100
          const p2Percent = (p2Metric.value / p2Metric.maxValue) * 100

          return (
            <div key={metric.label}>
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>{formatValue(metric.value, metric.format)}</span>
                <span className="text-gray-300">{metric.label}</span>
                <span>{formatValue(p2Metric.value, p2Metric.format)}</span>
              </div>

              <div className="flex gap-1 h-2">
                {/* Player 1 bar (right-aligned) */}
                <div className="flex-1 flex justify-end">
                  <div
                    className={`h-full rounded-l ${colors.p1} transition-all duration-500`}
                    style={{ width: `${Math.min(p1Percent, 100)}%` }}
                  />
                </div>

                {/* Divider */}
                <div className="w-px bg-gray-600" />

                {/* Player 2 bar (left-aligned) */}
                <div className="flex-1">
                  <div
                    className={`h-full rounded-r ${colors.p2} transition-all duration-500`}
                    style={{ width: `${Math.min(p2Percent, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4 pt-4 border-t border-gray-700 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-green-500"></span>
          Higher Value
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-blue-500"></span>
          Lower Value
        </span>
      </div>
    </div>
  )
}
