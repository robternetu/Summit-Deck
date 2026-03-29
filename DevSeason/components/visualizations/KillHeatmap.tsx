'use client'

import { useState, useMemo, useCallback } from 'react'
import Image from 'next/image'
import { getMinimapImage } from '@/lib/mapImages'
import { MAP_SETTINGS } from '@/config/maps'

interface KillEvent {
  gameId: string
  killerPosition: { x: number; y: number }
  victimPosition: { x: number; y: number }
  killerId: string
  victimId: string
  killerTeamId: string
  victimTeamId: string
  weapon?: string
  isFirstBlood?: boolean
  roundNumber: number
  timestamp: string
}

interface KillHeatmapProps {
  kills: KillEvent[]
  mapName: string
  teamId: string  // Featured team ID
  teamName: string
  opponentName: string
  players: any[]
  abilityUses?: any[]
}



type ViewMode = 'all' | 'kills' | 'deaths' | 'firstbloods'

export default function KillHeatmap({
  kills,
  mapName,
  teamId,
  teamName,
  opponentName,
  players,
  abilityUses = []
}: KillHeatmapProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [hoveredKill, setHoveredKill] = useState<KillEvent | null>(null)

  // Normalize coordinates to percentage positions
  const normalizePosition = useCallback((pos: { x: number; y: number }) => {
    const settings = MAP_SETTINGS[mapName.toLowerCase()] || { 
      minX: -10000, 
      maxX: 10000, 
      minY: -10000, 
      maxY: 10000 
    }

    const nx = ((pos.x - settings.minX) / (settings.maxX - settings.minX)) * 100
    const ny = ((pos.y - settings.minY) / (settings.maxY - settings.minY)) * 100

    // Clamp and flip Y for screen coordinates (Y increases downward)
    // We handle rotation visually using CSS on the container instead of manual math
    return {
      x: Math.max(0, Math.min(100, nx)),
      y: Math.max(0, Math.min(100, 100 - ny))
    }
  }, [mapName])

  // Filter and process kills based on view mode
  const displayKills = useMemo(() => {
    let filtered = [...kills]

    // Filter by round if selected
    if (selectedRound !== null) {
      filtered = filtered.filter(k => k.roundNumber === selectedRound)
    }

    // Filter by view mode
    switch (viewMode) {
      case 'kills':
        return filtered.filter(k => k.killerTeamId === teamId)
      case 'deaths':
        return filtered.filter(k => k.victimTeamId === teamId)
      case 'firstbloods':
        return filtered.filter(k => k.isFirstBlood)
      default:
        return filtered
    }
  }, [kills, viewMode, selectedRound, teamId])

  // Get unique rounds for filter
  const rounds = useMemo(() => {
    return [...new Set(kills.map(k => k.roundNumber))].sort((a, b) => a - b)
  }, [kills])

  // Aggregate positions for heatmap density
  const heatmapData = useMemo(() => {
    const gridSize = 20 // Increased resolution for smoother heatmap
    const grid: number[][] = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0))

    displayKills.forEach(kill => {
      const pos = normalizePosition(kill.victimPosition)
      const gridX = Math.floor(pos.x / (100 / gridSize))
      const gridY = Math.floor(pos.y / (100 / gridSize))

      if (gridX >= 0 && gridX < gridSize && gridY >= 0 && gridY < gridSize) {
        // Apply a simple kernel for smoothing
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gridX + dx
            const ny = gridY + dy
            if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
              const weight = (dx === 0 && dy === 0) ? 1.0 : 0.5
              grid[ny][nx] += weight
            }
          }
        }
      }
    })

    return grid
  }, [displayKills, normalizePosition])

  // Find max for color scaling
  const maxDensity = Math.max(...heatmapData.flat(), 1)

  // Check if map image exists
  const mapImagePath = getMinimapImage(mapName)

  // Map image rendering
  const renderMapImage = () => {
    if (!mapImagePath) {
      return (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 bg-gray-800">
          <span className="text-sm capitalize">{mapName} Map Image Missing</span>
        </div>
      )
    }

    const settings = MAP_SETTINGS[mapName.toLowerCase()] || { imageRotation: 0 }

    return (
      <div 
        className="absolute inset-0 transition-transform duration-500 ease-in-out pointer-events-none"
        style={{ transform: `rotate(${settings.imageRotation}deg)` }}
      >
        <Image
          src={mapImagePath}
          alt={mapName}
          fill
          className="object-contain rounded-lg opacity-70"
          unoptimized
        />
      </div>
    )
  }

  // Get rotation-aware position for UI elements that sit outside the rotated container
  const getRotatedPosition = (pos: { x: number; y: number }) => {
    const settings = MAP_SETTINGS[mapName.toLowerCase()] || { dataRotation: 0 }
    let { x, y } = normalizePosition(pos)
    
    const rotation = settings.dataRotation;
    if (rotation === 90) {
      const px = x; x = y; y = 100 - px;
    } else if (rotation === 180) {
      x = 100 - x; y = 100 - y;
    } else if (rotation === 270) {
      const px = x; x = 100 - y; y = px;
    }
    
    return { x, y }
  }

  if (kills.length === 0) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6 text-center">
        <p className="text-gray-400">No kill data available for this map</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">
          Kill Heatmap - {mapName}
        </h3>

        {/* View mode selector */}
        <div className="flex gap-2">
          {(['all', 'kills', 'deaths', 'firstbloods'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                viewMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {mode === 'all' ? 'All' :
               mode === 'kills' ? `${teamName} Kills` :
               mode === 'deaths' ? `${teamName} Deaths` :
               'First Bloods'}
            </button>
          ))}
        </div>
      </div>

      {/* Round filter */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-2">
        <button
          onClick={() => setSelectedRound(null)}
          className={`px-2 py-1 rounded text-xs whitespace-nowrap ${
            selectedRound === null
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          All Rounds
        </button>
        {rounds.map(round => (
          <button
            key={round}
            onClick={() => setSelectedRound(round)}
            className={`px-2 py-1 rounded text-xs ${
              selectedRound === round
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            R{round}
          </button>
        ))}
      </div>

      {/* Map container */}
      <div className="relative aspect-square max-w-lg mx-auto bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
        {/* Map image layer */}
        {renderMapImage()}

        {/* Data points layer (Heatmap + Markers) */}
        <div 
          className="absolute inset-0 transition-transform duration-500 ease-in-out"
          style={{ transform: `rotate(${MAP_SETTINGS[mapName.toLowerCase()]?.dataRotation || 0}deg)` }}
        >
          {/* Heatmap overlay */}
          <div 
            className="absolute inset-0 grid"
            style={{ 
              gridTemplateColumns: `repeat(${heatmapData.length}, 1fr)`,
              gridTemplateRows: `repeat(${heatmapData.length}, 1fr)`
            }}
          >
            {heatmapData.map((row, y) =>
              row.map((density, x) => (
                <div
                  key={`${x}-${y}`}
                  className="transition-opacity"
                  style={{
                    backgroundColor: density > 0
                      ? `rgba(239, 68, 68, ${(density / maxDensity) * 0.6})`
                      : 'transparent'
                  }}
                />
              ))
            )}
          </div>

          {/* Individual kill markers */}
          {displayKills.slice(0, 50).map((kill, idx) => {
            const victimPos = normalizePosition(kill.victimPosition)
            const isTeamDeath = kill.victimTeamId === teamId
            const dataRotation = MAP_SETTINGS[mapName.toLowerCase()]?.dataRotation || 0

            return (
              <div
                key={idx}
                className={`absolute w-3 h-3 rounded-full cursor-pointer
                  ${isTeamDeath ? 'bg-red-500' : 'bg-green-500'}
                  ${kill.isFirstBlood ? 'ring-2 ring-yellow-400' : ''}
                  hover:scale-150 transition-transform z-10`}
                style={{
                  left: `${victimPos.x}%`,
                  top: `${victimPos.y}%`,
                  transform: `translate(-50%, -50%) rotate(${-dataRotation}deg)`
                }}
                onMouseEnter={() => setHoveredKill(kill)}
                onMouseLeave={() => setHoveredKill(null)}
              />
            )
          })}
        </div>

        {/* Hover tooltip - stays OUTSIDE the rotated div to stay horizontal and avoid clipping */}
        {hoveredKill && (
          <div
            className="absolute z-20 bg-gray-900/95 border border-gray-700 rounded p-3 text-xs pointer-events-none min-w-[200px] shadow-xl backdrop-blur-sm"
            style={{
              left: `${Math.min(getRotatedPosition(hoveredKill.victimPosition).x, 80)}%`,
              top: `${Math.max(getRotatedPosition(hoveredKill.victimPosition).y - 15, 10)}%`,
              transform: 'translateX(-50%)'
            }}
          >
            <div className="flex justify-between items-start mb-2 border-b border-gray-700 pb-1">
              <span className="text-blue-400 font-bold">Round {hoveredKill.roundNumber}</span>
              <span className="text-gray-500">{new Date(hoveredKill.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}</span>
            </div>
            
            <div className="space-y-1 mb-2">
              <p className="text-white">
                <span className="text-green-400 font-semibold">
                  {players.find(p => p.playerId === hoveredKill.killerId)?.playerName || 'Unknown Killer'}
                </span>
                <span className="text-gray-400 mx-1">killed</span>
                <span className="text-red-400 font-semibold">
                  {players.find(p => p.playerId === hoveredKill.victimId)?.playerName || 'Unknown Victim'}
                </span>
              </p>
              <p className="text-gray-300 italic flex items-center gap-1">
                with <span className="text-white not-italic font-medium">{hoveredKill.weapon || 'Unknown weapon'}</span>
              </p>
            </div>

            {hoveredKill.isFirstBlood && (
              <div className="bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded text-[10px] font-bold inline-block mb-2 uppercase tracking-wider">
                First Blood!
              </div>
            )}

            {(() => {
              const killTime = new Date(hoveredKill.timestamp).getTime();
              const tenSeconds = 10 * 1000;
              const relatedAbilities = abilityUses.filter(a => {
                if (a.gameId !== hoveredKill.gameId) return false;
                if (a.playerId !== hoveredKill.killerId && a.playerId !== hoveredKill.victimId) return false;
                const abilityTime = new Date(a.timestamp).getTime();
                return Math.abs(killTime - abilityTime) <= tenSeconds;
              });

              if (relatedAbilities.length > 0) {
                return (
                  <div className="mt-2 pt-2 border-t border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Recent Abilities</p>
                    <div className="flex flex-wrap gap-1">
                      {relatedAbilities.slice(0, 3).map((a, i) => (
                        <span key={i} className="bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded text-[10px]">
                          {a.agent}: {a.abilityName}
                        </span>
                      ))}
                      {relatedAbilities.length > 3 && (
                        <span className="text-gray-500 text-[10px]">+{relatedAbilities.length - 3} more</span>
                      )}
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4 text-sm text-gray-300">
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500"></span>
          {teamName} Deaths
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-500"></span>
          {teamName} Kills
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-yellow-400"></span>
          First Blood
        </span>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-4 gap-4 mt-4 text-center">
        <div className="bg-gray-800/50 rounded p-2">
          <p className="text-2xl font-bold text-green-400">
            {kills.filter(k => k.killerTeamId === teamId).length}
          </p>
          <p className="text-xs text-gray-400">Kills</p>
        </div>
        <div className="bg-gray-800/50 rounded p-2">
          <p className="text-2xl font-bold text-red-400">
            {kills.filter(k => k.victimTeamId === teamId).length}
          </p>
          <p className="text-xs text-gray-400">Deaths</p>
        </div>
        <div className="bg-gray-800/50 rounded p-2">
          <p className="text-2xl font-bold text-yellow-400">
            {kills.filter(k => k.isFirstBlood && k.killerTeamId === teamId).length}
          </p>
          <p className="text-xs text-gray-400">First Bloods</p>
        </div>
        <div className="bg-gray-800/50 rounded p-2">
          <p className="text-2xl font-bold text-blue-400">
            {(kills.filter(k => k.killerTeamId === teamId).length /
              Math.max(kills.filter(k => k.victimTeamId === teamId).length, 1)).toFixed(2)}
          </p>
          <p className="text-xs text-gray-400">K/D Ratio</p>
        </div>
      </div>
    </div>
  )
}
