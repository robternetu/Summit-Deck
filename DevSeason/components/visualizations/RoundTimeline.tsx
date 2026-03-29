'use client'

import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, Skull, Clock, Shield } from 'lucide-react'

interface RoundEvent {
  type: 'kill' | 'plant' | 'defuse' | 'clutch_start' | 'round_end'
  timestamp: string
  description: string
  player?: string
  team?: string
  isTeam: boolean  // Is this the featured team's action
}

interface RoundData {
  roundNumber: number
  gameId: string
  mapName: string
  won: boolean
  winType: string
  events: RoundEvent[]
  score: { team: number; opponent: number }
  economyTier: string
  isHighlight: boolean
  highlightTypes?: string[]
}

interface RoundTimelineProps {
  rounds: RoundData[]
  teamName: string
  opponentName: string
  highlightRounds?: number[]
}

export default function RoundTimeline({
  rounds,
  teamName,
  opponentName,
  highlightRounds = []
}: RoundTimelineProps) {
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set())
  const [filterType, setFilterType] = useState<'all' | 'won' | 'lost' | 'highlight'>('all')

  const toggleRound = (roundNumber: number) => {
    setExpandedRounds(prev => {
      const next = new Set(prev)
      if (next.has(roundNumber)) {
        next.delete(roundNumber)
      } else {
        next.add(roundNumber)
      }
      return next
    })
  }

  const filteredRounds = useMemo(() => {
    switch (filterType) {
      case 'won':
        return rounds.filter(r => r.won)
      case 'lost':
        return rounds.filter(r => !r.won)
      case 'highlight':
        return rounds.filter(r => r.isHighlight)
      default:
        return rounds
    }
  }, [rounds, filterType])

  const getWinTypeIcon = (winType: string) => {
    switch (winType) {
      case 'elimination':
      case 'opponentEliminated':
        return <Skull className="w-4 h-4" />
      case 'bomb_exploded':
      case 'bombExploded':
        return (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="8" />
          </svg>
        )
      case 'bomb_defused':
      case 'bombDefused':
        return <Shield className="w-4 h-4" />
      default:
        return <Clock className="w-4 h-4" />
    }
  }

  const getEconomyColor = (tier: string) => {
    switch (tier) {
      case 'full_buy': return 'bg-green-500'
      case 'half_buy': return 'bg-yellow-500'
      case 'eco': return 'bg-orange-500'
      case 'save': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
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
        <h3 className="text-lg font-semibold text-white">Round Timeline</h3>

        {/* Filter buttons */}
        <div className="flex gap-2">
          {(['all', 'won', 'lost', 'highlight'] as const).map(filter => (
            <button
              key={filter}
              onClick={() => setFilterType(filter)}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                filterType === filter
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {filter === 'all' ? 'All' :
               filter === 'won' ? 'Wins' :
               filter === 'lost' ? 'Losses' :
               '⭐ Highlights'}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
        {filteredRounds.map(round => {
          const isExpanded = expandedRounds.has(round.roundNumber)
          const isHighlight = highlightRounds.includes(round.roundNumber) || round.isHighlight

          return (
            <div
              key={`${round.gameId}-${round.roundNumber}`}
              className={`border rounded-lg transition-colors ${
                isHighlight
                  ? 'border-yellow-500/50 bg-yellow-500/5'
                  : 'border-gray-700 bg-gray-800/30'
              }`}
            >
              {/* Round header */}
              <button
                onClick={() => toggleRound(round.roundNumber)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-700/30 transition-colors"
              >
                {/* Expand icon */}
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                )}

                {/* Round number */}
                <span className={`font-mono text-sm w-8 ${
                  round.won ? 'text-green-400' : 'text-red-400'
                }`}>
                  R{round.roundNumber}
                </span>

                {/* Score */}
                <span className="text-gray-300 text-sm w-12">
                  {round.score.team}-{round.score.opponent}
                </span>

                {/* Win type icon */}
                <span className={round.won ? 'text-green-400' : 'text-red-400'}>
                  {getWinTypeIcon(round.winType)}
                </span>

                {/* Economy indicator */}
                <span className={`w-2 h-2 rounded-full ${getEconomyColor(round.economyTier)}`} />

                {/* Map name (if multiple games) */}
                <span className="text-gray-500 text-xs">{round.mapName}</span>

                {/* Highlight badge */}
                {isHighlight && (
                  <span className="ml-auto px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded">
                    {round.highlightTypes?.[0] || 'Highlight'}
                  </span>
                )}

                {/* Outcome */}
                <span className={`text-xs ml-auto ${round.won ? 'text-green-400' : 'text-red-400'}`}>
                  {round.won ? 'WIN' : 'LOSS'}
                </span>
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-700">
                  <div className="pt-2 space-y-1">
                    {round.events.length > 0 ? (
                      round.events.map((event, idx) => (
                        <div
                          key={idx}
                          className={`flex items-center gap-2 text-sm ${
                            event.isTeam ? 'text-blue-300' : 'text-red-300'
                          }`}
                        >
                          <span className="text-gray-500 text-xs w-16">
                            {event.timestamp}
                          </span>
                          {event.type === 'kill' && <Skull className="w-3 h-3" />}
                          {event.type === 'plant' && (
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="12" cy="12" r="6" />
                            </svg>
                          )}
                          {event.type === 'defuse' && <Shield className="w-3 h-3" />}
                          <span>{event.description}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-500 text-sm italic">
                        Detailed events not available
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-700">
        <div className="text-center">
          <p className="text-2xl font-bold text-green-400">
            {rounds.filter(r => r.won).length}
          </p>
          <p className="text-xs text-gray-400">Rounds Won</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-red-400">
            {rounds.filter(r => !r.won).length}
          </p>
          <p className="text-xs text-gray-400">Rounds Lost</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-yellow-400">
            {rounds.filter(r => r.isHighlight).length}
          </p>
          <p className="text-xs text-gray-400">Highlights</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-blue-400">
            {((rounds.filter(r => r.won).length / Math.max(rounds.length, 1)) * 100).toFixed(0)}%
          </p>
          <p className="text-xs text-gray-400">Win Rate</p>
        </div>
      </div>
    </div>
  )
}
