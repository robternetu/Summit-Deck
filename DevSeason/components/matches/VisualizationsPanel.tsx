'use client'

import { useState, useEffect, useMemo } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import WinProbabilityTimeline from '@/components/visualizations/WinProbabilityTimeline'
import PlayerRadarChart from '@/components/visualizations/PlayerRadarChart'
import KillHeatmap from '@/components/visualizations/KillHeatmap'
import EconomyTimeline from '@/components/visualizations/EconomyTimeline'
import RoundTimeline from '@/components/visualizations/RoundTimeline'
import HighlightReel from '@/components/visualizations/HighlightReel'
import { normalizeTeamName } from '@/lib/teamUtils'
import { PRIMARY_TEAM_ID, PRIMARY_TEAM_NAME } from '@/lib/branding'

interface VisualizationsPanelProps {
  matchId: string
  selectedGameId?: string
}

export function VisualizationsPanel({ matchId, selectedGameId }: VisualizationsPanelProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<any>(null)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    async function fetchEvidence() {
      try {
        setLoading(true)
        const res = await fetch(`/api/coach/match?matchId=${matchId}`)

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to fetch evidence')
        }

        const data = await res.json()
        setEvidence(data.evidence)
        setError(null)
      } catch (err) {
        console.error('Error fetching evidence:', err)
        setError(err instanceof Error ? err.message : 'Failed to load visualizations')
      } finally {
        setLoading(false)
      }
    }

    fetchEvidence()
  }, [matchId])

  // Build team name mapping
  const teamNames = useMemo(() => {
    if (!evidence) return { team: PRIMARY_TEAM_NAME, opponent: 'Opponent' }

    const names: Record<string, string> = { [PRIMARY_TEAM_ID]: PRIMARY_TEAM_NAME }

    // Extract team names from various stats
    evidence.derived?.firstBloodStats?.forEach((stat: any) => {
      if (stat.teamId && stat.teamName) {
        names[stat.teamId] = normalizeTeamName(stat.teamName)
      }
    })

    evidence.derived?.mapsStats?.forEach((stat: any) => {
      if (stat.teamId && stat.teamName) {
        names[stat.teamId] = normalizeTeamName(stat.teamName)
      }
    })

    // Find opponent name
    const opponentId = Object.keys(names).find(id => id !== PRIMARY_TEAM_ID)

    return {
      team: names[PRIMARY_TEAM_ID] || PRIMARY_TEAM_NAME,
      opponent: opponentId ? names[opponentId] : 'Opponent',
      opponentId: opponentId || ''
    }
  }, [evidence])

  // Filter data by selected game
  const filteredData = useMemo(() => {
    if (!evidence) return { rounds: [], kills: [], economy: [], games: [] }

    const rounds = selectedGameId
      ? (evidence.rounds || []).filter((r: any) => r.gameId === selectedGameId)
      : evidence.rounds || []

    const kills = selectedGameId
      ? (evidence.kills || []).filter((k: any) => k.gameId === selectedGameId)
      : evidence.kills || []

    const economy = selectedGameId
      ? (evidence.economyRounds || []).filter((e: any) => e.gameId === selectedGameId)
      : evidence.economyRounds || []

    return {
      rounds,
      kills,
      economy,
      games: evidence.games || []
    }
  }, [evidence, selectedGameId])

  // Prepare player radar data
  const playerRadarData = useMemo(() => {
    if (!evidence?.players) return []

    const teamPlayers = evidence.players.filter((p: any) => p.teamId === PRIMARY_TEAM_ID)
    const derived = evidence.derived || {}

    return teamPlayers.map((player: any) => {
      const clutchStats = derived.clutchStats?.find((c: any) => c.playerId === player.playerId)
      const openingStats = derived.openingDuelStats?.find((o: any) => o.playerId === player.playerId)
      const tradeStats = derived.tradeStats?.find((t: any) => t.playerId === player.playerId)
      const damageStats = derived.playerDamageStats?.find((d: any) => d.playerId === player.playerId)
      const kastStats = derived.kastStats?.find((k: any) => k.playerId === player.playerId)
      const multiKillStats = derived.multiKillStats?.find((m: any) => m.playerId === player.playerId)

      return {
        playerId: player.playerId,
        playerName: player.playerName || `Player ${player.playerId.slice(-4)}`,
        teamId: player.teamId,
        metrics: {
          adr: Math.min((damageStats?.adr || 150) / 2, 100),
          kast: (kastStats?.kastPercent || 0.7) * 100,
          clutchRate: (clutchStats?.clutchRate || 0) * 100,
          firstBloodRate: ((openingStats?.openingKills || 0) / Math.max(openingStats?.openingDuels || 1, 1)) * 100,
          tradeRate: (tradeStats?.tradedRate || 0.5) * 100,
          impactRating: Math.min((multiKillStats?.impactScore || 0) * 10, 100)
        }
      }
    })
  }, [evidence])

  // Prepare highlight data
  const highlights = useMemo(() => {
    if (!evidence?.derived?.highlightStats?.rounds) return []
    return evidence.derived.highlightStats.rounds
  }, [evidence])

  // Prepare round timeline data
  const roundTimelineData = useMemo(() => {
    if (!filteredData.rounds.length) return []

    let teamScore = 0
    let oppScore = 0

    return filteredData.rounds.map((round: any) => {
      const isWin = round.winnerTeamId === PRIMARY_TEAM_ID
      if (isWin) teamScore++
      else oppScore++

      const game = filteredData.games.find((g: any) => g.gameId === round.gameId)
      const eco = filteredData.economy.find(
        (e: any) => e.roundNumber === round.roundNumber && e.gameId === round.gameId && e.teamId === PRIMARY_TEAM_ID
      )

      const highlight = highlights.find(
        (h: any) => h.roundNumber === round.roundNumber && h.gameId === round.gameId
      )

      return {
        roundNumber: round.roundNumber,
        gameId: round.gameId,
        mapName: game?.mapName || 'Unknown',
        won: isWin,
        winType: round.winType || 'unknown',
        events: [],
        score: { team: teamScore, opponent: oppScore },
        economyTier: eco?.economyTier || 'unknown',
        isHighlight: !!highlight,
        highlightTypes: highlight?.allHighlightTypes
      }
    })
  }, [filteredData, highlights])

  // Get current map name
  const currentMap = useMemo(() => {
    if (!selectedGameId || !filteredData.games.length) {
      return filteredData.games[0]?.mapName || 'Unknown'
    }
    return filteredData.games.find((g: any) => g.gameId === selectedGameId)?.mapName || 'Unknown'
  }, [selectedGameId, filteredData.games])

  // Prepare heatmap kills
  const heatmapKills = useMemo(() => {
    return filteredData.kills.map((k: any) => ({
      gameId: k.gameId,
      killerPosition: k.killerPosition || { x: 0, y: 0 },
      victimPosition: k.victimPosition || { x: 0, y: 0 },
      killerId: k.killerId,
      victimId: k.victimId,
      killerTeamId: k.killerTeamId,
      victimTeamId: k.victimTeamId,
      weapon: k.weapon,
      isFirstBlood: k.isFirstBlood,
      roundNumber: k.roundNumber,
      timestamp: k.timestamp
    }))
  }, [filteredData.kills])

  if (loading) {
    return (
      <div className="card backdrop-blur-xl bg-gray-900/70 p-6">
        <div className="flex items-center justify-center gap-3 py-12">
          <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
          <span className="text-gray-400">Loading visualizations...</span>
        </div>
      </div>
    )
  }

  if (error || !evidence) {
    return (
      <div className="card backdrop-blur-xl bg-gray-900/70 p-6">
        <div className="flex items-center gap-3 mb-4">
          <BarChart3 className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-semibold text-white">Match Visualizations</h2>
        </div>
        <p className="text-gray-400 text-center py-8">
          {error || 'No visualization data available for this match'}
        </p>
      </div>
    )
  }

  return (
    <div className="card backdrop-blur-xl bg-gray-900/70 p-6">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-6 h-6 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Match Visualizations</h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-gray-800/50 border border-gray-700 mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="players">Players</TabsTrigger>
          <TabsTrigger value="economy">Economy</TabsTrigger>
          <TabsTrigger value="rounds">Rounds</TabsTrigger>
          <TabsTrigger value="highlights">
            Highlights
            {highlights.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded">
                {highlights.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <WinProbabilityTimeline
            rounds={filteredData.rounds.map((r: any) => ({
              ...r,
              isClutch: evidence.clutchSituations?.some(
                (c: any) => c.roundNumber === r.roundNumber && c.gameId === r.gameId
              ),
              isCritical: evidence.derived?.criticalRounds?.some(
                (cr: any) => cr.topReviewRounds?.some(
                  (tr: any) => tr.roundNumber === r.roundNumber
                )
              )
            }))}
            teamId={PRIMARY_TEAM_ID}
            teamName={teamNames.team}
            opponentName={teamNames.opponent}
            games={filteredData.games}
          />

          {highlights.length > 0 && (
            <HighlightReel
              highlights={highlights.slice(0, 5)}
              onRoundSelect={(round, gameId) => {
                console.log(`Selected round ${round} from game ${gameId}`)
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="heatmap">
          <KillHeatmap
            kills={heatmapKills}
            mapName={currentMap}
            teamId={PRIMARY_TEAM_ID}
            teamName={teamNames.team}
            opponentName={teamNames.opponent}
            players={evidence.players || []}
            abilityUses={evidence.abilityUses || []}
          />
        </TabsContent>

        <TabsContent value="players">
          <PlayerRadarChart
            players={playerRadarData}
            showTeamAverage={true}
          />
        </TabsContent>

        <TabsContent value="economy">
          <EconomyTimeline
            economyRounds={filteredData.economy.map((e: any) => ({
              ...e,
              teamName: e.teamId === PRIMARY_TEAM_ID ? teamNames.team : teamNames.opponent
            }))}
            teamId={PRIMARY_TEAM_ID}
            teamName={teamNames.team}
            opponentTeamId={teamNames.opponentId || ''}
            opponentName={teamNames.opponent}
          />
        </TabsContent>

        <TabsContent value="rounds">
          <RoundTimeline
            rounds={roundTimelineData}
            teamName={teamNames.team}
            opponentName={teamNames.opponent}
            highlightRounds={highlights.map((h: any) => h.roundNumber)}
          />
        </TabsContent>

        <TabsContent value="highlights">
          <HighlightReel
            highlights={highlights}
            onRoundSelect={(round, gameId) => {
              console.log(`Selected round ${round} from game ${gameId}`)
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
