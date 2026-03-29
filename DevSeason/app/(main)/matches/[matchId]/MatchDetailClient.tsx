'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { ChevronLeft, TrendingUp, TrendingDown, Trophy, Calendar } from 'lucide-react'
import { getMapImage } from '@/lib/mapImages'
import { normalizeTeamName } from '@/lib/teamUtils'
import { CoachPanel } from '@/components/matches/CoachPanel'
import { EvidencePanel } from '@/components/matches/EvidencePanel'
import { VisualizationsPanel } from '@/components/matches/VisualizationsPanel'

interface GameData {
  gameId: string
  mapName: string
  sequenceNumber: number
  c9Rounds: number
  opponentRounds: number
  c9Won: boolean
}

interface SeriesData {
  matchId: string
  seriesId: string
  opponentName: string
  tournamentName: string
  matchDate: string
  c9MapsWon: number
  opponentMapsWon: number
  seriesWon: boolean
  games: GameData[]
  playerStatsByGame: Record<string, any[]>
  derivedStats: any
}

interface MatchDetailClientProps {
  seriesData: SeriesData
}

export function MatchDetailClient({ seriesData }: MatchDetailClientProps) {
  const [selectedGameId, setSelectedGameId] = useState(seriesData.games[0]?.gameId || '')
  
  const selectedGame = seriesData.games.find(g => g.gameId === selectedGameId) || seriesData.games[0]
  const selectedMapImage = selectedGame ? getMapImage(selectedGame.mapName) : null
  const selectedPlayers = seriesData.playerStatsByGame[selectedGameId] || []

  return (
    <div className="min-h-screen relative">
      {/* Dynamic Background based on selected map */}
      {selectedMapImage && (
        <div className="fixed inset-0 z-0">
          <Image
            src={selectedMapImage}
            alt={selectedGame?.mapName || ''}
            fill
            className="object-cover transition-opacity duration-500"
            unoptimized
            priority
          />
          {/* Dark overlay gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/75 to-black/90" />
          {/* Blue tint to match theme */}
          <div className="absolute inset-0 bg-blue-950/20" />
        </div>
      )}
      
      {/* Content */}
      <div className="relative z-10 pt-24 pb-12 px-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Back Button */}
          <Link 
            href="/matches" 
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to opponents
          </Link>

          {/* Header - Series Info */}
          <header className="card p-6 backdrop-blur-xl bg-gray-900/70">
            <div className="flex items-center justify-between">
              {/* Left side - Map name and match info */}
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-white capitalize">{selectedGame?.mapName || 'Unknown'}</h1>
                <div className="flex items-center gap-4 mt-2">
                  <span className="text-gray-400">
                    vs <span className="text-[#ffffff]">{normalizeTeamName(seriesData.opponentName)}</span>
                  </span>
                  <div className="flex items-center gap-2 text-[#ffffff]">
                    <Trophy className="w-4 h-4" />
                    <span className="text-sm">{seriesData.tournamentName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm">{seriesData.matchDate}</span>
                  </div>
                </div>
              </div>
              
              {/* Right side - Series result */}
              <div className="text-right">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold ${
                  seriesData.seriesWon 
                    ? 'bg-green-500/20 text-green-400' 
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {seriesData.seriesWon ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  Series {seriesData.seriesWon ? 'WIN' : 'LOSS'}
                </div>
                <p className="text-2xl font-bold text-white mt-1">
                  {seriesData.c9MapsWon} - {seriesData.opponentMapsWon}
                </p>
              </div>
            </div>
          </header>

          {/* Map Selector */}
          <div className="card p-6 backdrop-blur-xl bg-gray-900/70">
            <h2 className="text-xl font-semibold text-white mb-4">Map Summary</h2>
            <p className="text-sm text-gray-400 mb-4">Click a map to view stats, generate reports, and change background</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {seriesData.games.map((game, index) => {
                const isSelected = game.gameId === selectedGameId
                const mapImage = getMapImage(game.mapName)
                
                return (
                  <button
                    key={game.gameId}
                    onClick={() => setSelectedGameId(game.gameId)}
                    className={`relative overflow-hidden rounded-lg border p-4 text-left transition-all ${
                      isSelected 
                        ? 'border-[#ffffff] bg-[#ffffff]/20 ring-2 ring-[#ffffff]/50' 
                        : 'border-gray-700 bg-black/40 hover:border-gray-500 hover:bg-black/60'
                    }`}
                  >
                    {/* Map background image */}
                    {mapImage && (
                      <div className="absolute inset-0 opacity-30">
                        <Image
                          src={mapImage}
                          alt={game.mapName}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
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
                      <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-[#ffffff] animate-pulse" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Stats for Selected Map */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card card-hover p-6 backdrop-blur-xl bg-gray-900/70">
              <div className="text-sm text-gray-400 mb-2">Rounds Won</div>
              <div className="text-4xl font-bold text-green-400">{selectedGame?.c9Rounds || 0}</div>
            </div>
            <div className="card card-hover p-6 backdrop-blur-xl bg-gray-900/70">
              <div className="text-sm text-gray-400 mb-2">Rounds Lost</div>
              <div className="text-4xl font-bold text-red-400">{selectedGame?.opponentRounds || 0}</div>
            </div>
          </div>

          {/* Player Stats for Selected Map */}
          {selectedPlayers.length > 0 && (
            <section className="card backdrop-blur-xl bg-gray-900/70">
              <div className="px-6 py-4 border-b border-gray-800">
                <h2 className="text-xl font-semibold text-white">
                  Player Stats - <span className="capitalize text-[#ffffff]">{selectedGame?.mapName}</span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-4 px-6 text-gray-400 font-medium">Player</th>
                      <th className="text-center py-4 px-6 text-gray-400 font-medium">Kills</th>
                      <th className="text-center py-4 px-6 text-gray-400 font-medium">Deaths</th>
                      <th className="text-center py-4 px-6 text-gray-400 font-medium">K/D</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPlayers
                      .sort((a: any, b: any) => b.kd - a.kd)
                      .map((player: any) => (
                        <tr key={player.playerId} className="border-b border-gray-800/50 hover:bg-black/20">
                          <td className="py-4 px-6 text-gray-300 font-medium">
                            {player.playerName || `Player ${player.playerId}`}
                          </td>
                          <td className="py-4 px-6 text-center text-green-400 font-semibold">{player.kills}</td>
                          <td className="py-4 px-6 text-center text-red-400">{player.deaths}</td>
                          <td className="py-4 px-6 text-center">
                            <span className={`font-semibold ${player.kd >= 1 ? 'text-green-400' : 'text-red-400'}`}>
                              {player.kd?.toFixed(2) || '0.00'}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Visualizations Panel - Sprint 7 */}
          <div className="backdrop-blur-xl">
            <VisualizationsPanel
              matchId={seriesData.matchId}
              selectedGameId={selectedGameId}
            />
          </div>

          {/* Evidence Panel - with synced map selection */}
          <div className="backdrop-blur-xl">
            <EvidencePanel
              matchId={seriesData.matchId}
              selectedGameId={selectedGameId}
              onGameChange={setSelectedGameId}
            />
          </div>

          {/* Coach Panel - with synced map selection */}
          <div className="backdrop-blur-xl">
            <CoachPanel matchId={seriesData.matchId} selectedGameId={selectedGameId} />
          </div>
        </div>
      </div>
    </div>
  )
}
