'use client'

import { useState } from 'react'
import Image from 'next/image'
import { getMapImage } from '@/lib/mapImages'

interface GameData {
  gameId: string
  mapName: string
  c9Rounds: number
  opponentRounds: number
  c9Won: boolean
}

interface MapSelectorProps {
  games: GameData[]
  selectedGameId: string
  onSelectGame: (gameId: string) => void
}

export function MapSelector({ games, selectedGameId, onSelectGame }: MapSelectorProps) {
  return (
    <div className="card p-6 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
      <h2 className="text-xl font-semibold text-white mb-4">Map Summary</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {games.map((game, index) => {
          const isSelected = game.gameId === selectedGameId
          const mapImage = getMapImage(game.mapName)
          
          return (
            <button
              key={game.gameId}
              onClick={() => onSelectGame(game.gameId)}
              className={`relative overflow-hidden rounded-lg border p-4 text-left transition-all ${
                isSelected 
                  ? 'border-[#ffffff] bg-[#ffffff]/20 ring-2 ring-[#ffffff]/50' 
                  : 'border-gray-700 bg-black/30 hover:border-gray-600 hover:bg-black/50'
              }`}
            >
              {/* Map background image */}
              {mapImage && (
                <div className="absolute inset-0 opacity-20">
                  <Image
                    src={mapImage}
                    alt={game.mapName}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
              )}
              
              <div className="relative z-10">
                <p className="text-xs text-gray-400 mb-1">Game {index + 1}</p>
                <p className="text-lg font-semibold text-white capitalize">{game.mapName}</p>
                <p className={`text-2xl font-bold mt-2 ${game.c9Won ? 'text-green-400' : 'text-red-400'}`}>
                  {game.c9Rounds} - {game.opponentRounds}
                </p>
              </div>
              
              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-[#ffffff]" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface MapBackgroundProps {
  mapName: string
  children: React.ReactNode
}

export function MapBackground({ mapName, children }: MapBackgroundProps) {
  const mapImage = getMapImage(mapName)
  
  return (
    <div className="min-h-screen relative">
      {/* Background image */}
      {mapImage && (
        <div className="fixed inset-0 z-0">
          <Image
            src={mapImage}
            alt={mapName}
            fill
            className="object-cover"
            unoptimized
            priority
          />
          {/* Dark overlay gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/70 to-black/90" />
          {/* Additional blue tint to match theme */}
          <div className="absolute inset-0 bg-blue-950/30" />
        </div>
      )}
      
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  )
}
