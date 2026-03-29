'use client'

import { useState } from 'react'
import { Star, Play, ChevronLeft, ChevronRight, Zap, Target, Trophy } from 'lucide-react'

interface HighlightRound {
  roundNumber: number
  gameId: string
  mapName: string
  highlightScore: number
  highlightType: string
  allHighlightTypes: string[]
  description: string
  involvedPlayers: string[]
  scoreBefore: string
  scoreAfter: string
  rank: number
}

interface HighlightReelProps {
  highlights: HighlightRound[]
  onRoundSelect?: (roundNumber: number, gameId: string) => void
}

const HIGHLIGHT_ICONS: Record<string, React.ReactNode> = {
  ace: <Star className="w-5 h-5 text-yellow-400" />,
  '4k': <Zap className="w-5 h-5 text-orange-400" />,
  '3k': <Target className="w-5 h-5 text-blue-400" />,
  clutch_win: <Trophy className="w-5 h-5 text-purple-400" />,
  hard_clutch: <Trophy className="w-5 h-5 text-pink-400" />,
  eco_upset: <Zap className="w-5 h-5 text-green-400" />,
  comeback: <ChevronRight className="w-5 h-5 text-cyan-400" />,
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  ace: 'from-yellow-500/20 to-orange-500/20 border-yellow-500/50',
  '4k': 'from-orange-500/20 to-red-500/20 border-orange-500/50',
  '3k': 'from-blue-500/20 to-indigo-500/20 border-blue-500/50',
  clutch_win: 'from-purple-500/20 to-pink-500/20 border-purple-500/50',
  hard_clutch: 'from-pink-500/20 to-red-500/20 border-pink-500/50',
  eco_upset: 'from-green-500/20 to-emerald-500/20 border-green-500/50',
  comeback: 'from-cyan-500/20 to-blue-500/20 border-cyan-500/50',
  default: 'from-gray-500/20 to-gray-600/20 border-gray-500/50',
}

export default function HighlightReel({
  highlights,
  onRoundSelect
}: HighlightReelProps) {
  const [currentIndex, setCurrentIndex] = useState(0)

  if (highlights.length === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6 text-center">
        <Star className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-400">No highlights detected in this match</p>
        <p className="text-gray-500 text-sm mt-1">Highlights are generated from clutches, multi-kills, and eco upsets</p>
      </div>
    )
  }

  const currentHighlight = highlights[currentIndex]
  const colorClass = HIGHLIGHT_COLORS[currentHighlight.highlightType] || HIGHLIGHT_COLORS.default

  const goToPrevious = () => {
    setCurrentIndex(prev => prev > 0 ? prev - 1 : highlights.length - 1)
  }

  const goToNext = () => {
    setCurrentIndex(prev => prev < highlights.length - 1 ? prev + 1 : 0)
  }

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-400" />
          Match Highlights
        </h3>
        <span className="text-gray-400 text-sm">
          {currentIndex + 1} / {highlights.length}
        </span>
      </div>

      {/* Main highlight card */}
      <div className={`relative bg-gradient-to-br ${colorClass} rounded-lg border p-6 mb-4`}>
        {/* Rank badge */}
        <div className="absolute top-3 right-3 bg-gray-900/80 px-2 py-1 rounded text-xs font-bold text-white">
          #{currentHighlight.rank}
        </div>

        {/* Highlight type icon */}
        <div className="flex items-center gap-3 mb-4">
          {HIGHLIGHT_ICONS[currentHighlight.highlightType] || <Star className="w-5 h-5 text-gray-400" />}
          <span className="text-xl font-bold text-white capitalize">
            {currentHighlight.highlightType.replace('_', ' ')}
          </span>
        </div>

        {/* Description */}
        <p className="text-white text-lg mb-4">{currentHighlight.description}</p>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-400">Map</p>
            <p className="text-white font-semibold">{currentHighlight.mapName}</p>
          </div>
          <div>
            <p className="text-gray-400">Round</p>
            <p className="text-white font-semibold">Round {currentHighlight.roundNumber}</p>
          </div>
          <div>
            <p className="text-gray-400">Score</p>
            <p className="text-white font-semibold">
              {currentHighlight.scoreBefore} → {currentHighlight.scoreAfter}
            </p>
          </div>
          <div>
            <p className="text-gray-400">Impact Score</p>
            <p className="text-white font-semibold">{currentHighlight.highlightScore}</p>
          </div>
        </div>

        {/* Players involved */}
        {currentHighlight.involvedPlayers.length > 0 && (
          <div className="mt-4">
            <p className="text-gray-400 text-sm mb-2">Players Involved</p>
            <div className="flex flex-wrap gap-2">
              {currentHighlight.involvedPlayers.map(player => (
                <span
                  key={player}
                  className="px-2 py-1 bg-gray-900/50 rounded text-sm text-white"
                >
                  {player}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* All highlight types */}
        {currentHighlight.allHighlightTypes.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {currentHighlight.allHighlightTypes.map(type => (
              <span
                key={type}
                className="px-2 py-0.5 bg-gray-900/50 rounded-full text-xs text-gray-300"
              >
                {type.replace('_', ' ')}
              </span>
            ))}
          </div>
        )}

        {/* View round button */}
        {onRoundSelect && (
          <button
            onClick={() => onRoundSelect(currentHighlight.roundNumber, currentHighlight.gameId)}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors"
          >
            <Play className="w-4 h-4" />
            View Round Details
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={goToPrevious}
          className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-300" />
        </button>

        {/* Dot indicators */}
        <div className="flex gap-2">
          {highlights.slice(0, 10).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className={`w-2 h-2 rounded-full transition-colors ${
                idx === currentIndex ? 'bg-blue-500' : 'bg-gray-600 hover:bg-gray-500'
              }`}
            />
          ))}
          {highlights.length > 10 && (
            <span className="text-gray-500 text-xs">+{highlights.length - 10}</span>
          )}
        </div>

        <button
          onClick={goToNext}
          className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-gray-300" />
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-gray-700">
        <div className="text-center">
          <p className="text-lg font-bold text-yellow-400">
            {highlights.filter(h => h.highlightType === 'ace').length}
          </p>
          <p className="text-xs text-gray-400">Aces</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-purple-400">
            {highlights.filter(h => h.allHighlightTypes.includes('clutch_win')).length}
          </p>
          <p className="text-xs text-gray-400">Clutches</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-green-400">
            {highlights.filter(h => h.highlightType === 'eco_upset').length}
          </p>
          <p className="text-xs text-gray-400">Eco Wins</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-orange-400">
            {highlights.filter(h => ['4k', '3k'].includes(h.highlightType)).length}
          </p>
          <p className="text-xs text-gray-400">Multi-kills</p>
        </div>
      </div>
    </div>
  )
}
