'use client'

import { useState, useEffect, useMemo } from 'react'
import type { EvidenceV1 } from '@/models/Match'
import { AgentImage } from '@/components/ui/AgentImage'
import { normalizeTeamName } from '@/lib/teamUtils'
import { PRIMARY_TEAM_ID, PRIMARY_TEAM_NAME } from '@/lib/branding'

interface EvidencePanelProps {
  matchId: string
  selectedGameId?: string // Sync with parent's map selection
  onGameChange?: (gameId: string) => void // Callback when map changes
}

interface MatchWithEvidence {
  matchId: string
  meta: {
    seriesId: string
    tournamentId: string
    map: string
    opponentName: string
    eventName: string
    games: Array<{ gameId: string; mapName: string; sequenceNumber: number }>
  }
  evidence: EvidenceV1 | null
  evidenceMeta: {
    extractedAt: string
    version: string
    extractor?: string
  } | null
}

// Known team ID to name mapping
const KNOWN_TEAMS: Record<string, string> = {
  [PRIMARY_TEAM_ID]: PRIMARY_TEAM_NAME,
}

export function EvidencePanel({ matchId, selectedGameId: externalGameId, onGameChange }: EvidencePanelProps) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<MatchWithEvidence | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [internalGameId, setInternalGameId] = useState<string>('')

  // Use external game ID if provided, otherwise use internal state
  const selectedGameId = externalGameId ?? internalGameId

  useEffect(() => {
    async function fetchEvidence() {
      try {
        const res = await fetch(`/api/coach/match?matchId=${matchId}`)

        if (!res.ok) {
          let msg = 'Failed to fetch evidence'
          try {
            const errorData = await res.json()
            if (errorData?.error) msg = errorData.error
          } catch {
            // ignore JSON parse error
          }
          throw new Error(msg)
        }

        const matchData = await res.json()
        setData(matchData)
        
        // Set initial game selection if not externally controlled
        if (matchData?.evidence?.games?.length > 0 && !externalGameId) {
          setInternalGameId(matchData.evidence.games[0].gameId)
        }
      } catch (err: unknown) {
        console.error(err)
        setError(err instanceof Error ? err.message : 'Unexpected error')
      } finally {
        setLoading(false)
      }
    }

    fetchEvidence()
  }, [matchId, externalGameId])

  // Build team ID to name mapping from evidence data
  // IMPORTANT: Apply normalizeTeamName to remove any "(1)" suffixes
  const teamMap = useMemo(() => {
    const map: Record<string, string> = { ...KNOWN_TEAMS }

    if (!data?.evidence) return map

    data.evidence.derived?.firstBloodStats?.forEach((stat: any) => {
      if (stat.teamId && stat.teamName) {
        map[stat.teamId] = normalizeTeamName(stat.teamName)
      }
    })

    data.evidence.derived?.plantStats?.forEach((stat: any) => {
      if (stat.teamId && stat.teamName) {
        map[stat.teamId] = normalizeTeamName(stat.teamName)
      }
    })

    data.evidence.derived?.mapsStats?.forEach((stat: any) => {
      if (stat.teamId && stat.teamName) {
        map[stat.teamId] = normalizeTeamName(stat.teamName)
      }
    })

    return map
  }, [data])

  // Filter stats for selected game/map
  const filteredStats = useMemo(() => {
    if (!data?.evidence || !selectedGameId) return null

    const evidence = data.evidence
    const gameId = selectedGameId

    // Filter raw data by gameId
    const gameRounds = evidence.rounds.filter(r => r.gameId === gameId)
    const gameKills = evidence.kills.filter(k => k.gameId === gameId)
    const gamePlants = evidence.plants.filter(p => p.gameId === gameId)
    const gameClutches = evidence.clutchSituations?.filter(c => c.gameId === gameId) || []
    const gameEconomyRounds = evidence.economyRounds?.filter(e => e.gameId === gameId) || []
    const gameAbilityUses = evidence.abilityUses?.filter(a => a.gameId === gameId) || []

    const roundCount = gameRounds.length

    // Player stats from kills
    const playerStatsMap = new Map<string, {
      playerId: string
      playerName: string
      teamId: string
      kills: number
      deaths: number
      firstBloods: number
      firstDeaths: number
      isolatedDeathsCount: number
    }>()

    evidence.players.forEach(p => {
      playerStatsMap.set(p.playerId, {
        playerId: p.playerId,
        playerName: p.playerName || `Player ${p.playerId}`,
        teamId: p.teamId,
        kills: 0,
        deaths: 0,
        firstBloods: 0,
        firstDeaths: 0,
        isolatedDeathsCount: 0
      })
    })

    gameKills.forEach(kill => {
      if (kill.killerId && playerStatsMap.has(kill.killerId)) {
        playerStatsMap.get(kill.killerId)!.kills++
      }
      if (kill.victimId && playerStatsMap.has(kill.victimId)) {
        playerStatsMap.get(kill.victimId)!.deaths++
        if (kill.isIsolated) {
          playerStatsMap.get(kill.victimId)!.isolatedDeathsCount++
        }
      }
      if (kill.isFirstBlood) {
        if (kill.killerId && playerStatsMap.has(kill.killerId)) {
          playerStatsMap.get(kill.killerId)!.firstBloods++
        }
        if (kill.victimId && playerStatsMap.has(kill.victimId)) {
          playerStatsMap.get(kill.victimId)!.firstDeaths++
        }
      }
    })

    const gamePlayers = Array.from(playerStatsMap.values()).filter(p => p.kills > 0 || p.deaths > 0)

    // First blood stats
    const teamFBStats = new Map<string, { firstBloods: number; roundsWon: number; teamName: string }>()
    
    gameRounds.forEach(round => {
      const fb = round.firstBlood
      if (fb?.killerTeamId) {
        if (!teamFBStats.has(fb.killerTeamId)) {
          teamFBStats.set(fb.killerTeamId, { 
            firstBloods: 0, 
            roundsWon: 0, 
            teamName: teamMap[fb.killerTeamId] || `Team ${fb.killerTeamId}` 
          })
        }
        teamFBStats.get(fb.killerTeamId)!.firstBloods++
        
        if (round.winnerTeamId === fb.killerTeamId) {
          teamFBStats.get(fb.killerTeamId)!.roundsWon++
        }
      }
    })

    const firstBloodStats = Array.from(teamFBStats.entries()).map(([teamId, stats]) => ({
      teamId,
      teamName: stats.teamName,
      firstBloods: stats.firstBloods,
      roundsWon: stats.roundsWon,
      conversionRate: stats.firstBloods > 0 ? stats.roundsWon / stats.firstBloods : 0
    }))

    // Plant stats
    const teamPlantStats = new Map<string, { plants: number; postPlantWins: number; teamName: string }>()
    
    gamePlants.forEach(plant => {
      const teamId = plant.planterTeamId
      if (!teamId) return
      
      if (!teamPlantStats.has(teamId)) {
        teamPlantStats.set(teamId, { 
          plants: 0, 
          postPlantWins: 0, 
          teamName: teamMap[teamId] || `Team ${teamId}` 
        })
      }
      teamPlantStats.get(teamId)!.plants++
      
      const round = gameRounds.find(r => r.roundNumber === plant.roundNumber)
      if (round?.winnerTeamId === teamId) {
        teamPlantStats.get(teamId)!.postPlantWins++
      }
    })

    const plantStats = Array.from(teamPlantStats.entries()).map(([teamId, stats]) => ({
      teamId,
      teamName: stats.teamName,
      plants: stats.plants,
      postPlantWins: stats.postPlantWins,
      postPlantWinRate: stats.plants > 0 ? stats.postPlantWins / stats.plants : 0
    }))

    // Site stats with attack/defense split
    const siteAttackStats = new Map<string, Map<string, { plants: number; postPlantWins: number; teamName: string }>>()
    const siteDefenseStats = new Map<string, Map<string, { defenseAttempts: number; defenseWins: number; teamName: string }>>()
    
    gamePlants.forEach(plant => {
      const site = plant.site
      if (!site || site === 'unknown') return
      
      const planterTeam = plant.planterTeamId
      if (!planterTeam) return

      // Initialize site if needed
      if (!siteAttackStats.has(site)) siteAttackStats.set(site, new Map())
      if (!siteDefenseStats.has(site)) siteDefenseStats.set(site, new Map())

      // Attack stats for planter team
      if (!siteAttackStats.get(site)!.has(planterTeam)) {
        siteAttackStats.get(site)!.set(planterTeam, {
          plants: 0,
          postPlantWins: 0,
          teamName: teamMap[planterTeam] || `Team ${planterTeam}`
        })
      }
      siteAttackStats.get(site)!.get(planterTeam)!.plants++

      const round = gameRounds.find(r => r.roundNumber === plant.roundNumber)
      if (round) {
        if (round.winnerTeamId === planterTeam) {
          siteAttackStats.get(site)!.get(planterTeam)!.postPlantWins++
        }

        // Defense stats for opposing team
        const defenderTeam = round.winnerTeamId === planterTeam 
          ? Object.keys(teamMap).find(t => t !== planterTeam) || ''
          : round.winnerTeamId
        
        if (defenderTeam && defenderTeam !== planterTeam) {
          if (!siteDefenseStats.get(site)!.has(defenderTeam)) {
            siteDefenseStats.get(site)!.set(defenderTeam, {
              defenseAttempts: 0,
              defenseWins: 0,
              teamName: teamMap[defenderTeam] || `Team ${defenderTeam}`
            })
          }
          siteDefenseStats.get(site)!.get(defenderTeam)!.defenseAttempts++
          if (round.winnerTeamId === defenderTeam) {
            siteDefenseStats.get(site)!.get(defenderTeam)!.defenseWins++
          }
        }
      }
    })

    const siteStats = Array.from(siteAttackStats.keys()).map(site => {
      const attackStats: Record<string, any> = {}
      const defenseStats: Record<string, any> = {}

      siteAttackStats.get(site)!.forEach((stats, teamId) => {
        attackStats[teamId] = {
          teamId,
          teamName: stats.teamName,
          plants: stats.plants,
          postPlantWins: stats.postPlantWins,
          postPlantWinRate: stats.plants > 0 ? stats.postPlantWins / stats.plants : 0
        }
      })

      siteDefenseStats.get(site)?.forEach((stats, teamId) => {
        defenseStats[teamId] = {
          teamId,
          teamName: stats.teamName,
          defenseAttempts: stats.defenseAttempts,
          defenseWins: stats.defenseWins,
          defenseWinRate: stats.defenseAttempts > 0 ? stats.defenseWins / stats.defenseAttempts : 0
        }
      })

      return { site, attackStats, defenseStats }
    }).sort((a, b) => a.site.localeCompare(b.site))

    // Clutch stats - filter by gameId
    const clutchStatsMap = new Map<string, {
      playerId: string
      playerName: string
      teamId: string
      clutchAttempts: number
      clutchWins: number
      breakdown: Record<string, { attempts: number; wins: number }>
    }>()

    gameClutches.forEach(clutch => {
      const playerId = clutch.playerId
      if (!playerId) return

      if (!clutchStatsMap.has(playerId)) {
        const player = evidence.players.find(p => p.playerId === playerId)
        clutchStatsMap.set(playerId, {
          playerId,
          playerName: clutch.playerName || player?.playerName || `Player ${playerId}`,
          teamId: clutch.teamId,
          clutchAttempts: 0,
          clutchWins: 0,
          breakdown: {}
        })
      }

      const stats = clutchStatsMap.get(playerId)!
      stats.clutchAttempts++
      if (clutch.won) stats.clutchWins++

      const situation = clutch.situation || 'unknown'
      if (!stats.breakdown[situation]) {
        stats.breakdown[situation] = { attempts: 0, wins: 0 }
      }
      stats.breakdown[situation].attempts++
      if (clutch.won) stats.breakdown[situation].wins++
    })

    const clutchStats = Array.from(clutchStatsMap.values())
      .map(s => ({
        ...s,
        teamName: teamMap[s.teamId] || `Team ${s.teamId}`,
        clutchRate: s.clutchAttempts > 0 ? s.clutchWins / s.clutchAttempts : 0
      }))
      .sort((a, b) => b.clutchAttempts - a.clutchAttempts)

    // Economy stats - filter by gameId
    const teamEconomyMap = new Map<string, {
      teamId: string
      teamName: string
      byTier: Record<string, { rounds: number; wins: number }>
    }>()

    gameEconomyRounds.forEach(eco => {
      const teamId = eco.teamId
      const tier = eco.economyTier
      if (!teamId || !tier) return

      if (!teamEconomyMap.has(teamId)) {
        teamEconomyMap.set(teamId, {
          teamId,
          teamName: eco.teamName || teamMap[teamId] || `Team ${teamId}`,
          byTier: {}
        })
      }

      const stats = teamEconomyMap.get(teamId)!
      if (!stats.byTier[tier]) {
        stats.byTier[tier] = { rounds: 0, wins: 0 }
      }
      stats.byTier[tier].rounds++
      if (eco.roundWon) stats.byTier[tier].wins++
    })

    const economyStats = Array.from(teamEconomyMap.values()).map(s => ({
      ...s,
      byTier: Object.fromEntries(
        Object.entries(s.byTier).map(([tier, data]) => [
          tier,
          { ...data, winRate: data.rounds > 0 ? data.wins / data.rounds : 0 }
        ])
      )
    }))

    // Ability stats - filter by gameId
    const playerAbilityMap = new Map<string, {
      playerId: string
      playerName: string
      teamId: string
      totalAbilityUses: number
      agentBreakdown: Map<string, Map<string, number>>
    }>()

    gameAbilityUses.forEach(use => {
      const playerId = use.playerId
      const agent = use.agent || 'unknown'
      const ability = use.abilityName || 'unknown'
      if (!playerId) return

      if (!playerAbilityMap.has(playerId)) {
        const player = evidence.players.find(p => p.playerId === playerId)
        playerAbilityMap.set(playerId, {
          playerId,
          playerName: player?.playerName || `Player ${playerId}`,
          teamId: use.teamId,
          totalAbilityUses: 0,
          agentBreakdown: new Map()
        })
      }

      const stats = playerAbilityMap.get(playerId)!
      stats.totalAbilityUses++

      if (!stats.agentBreakdown.has(agent)) {
        stats.agentBreakdown.set(agent, new Map())
      }
      const agentMap = stats.agentBreakdown.get(agent)!
      agentMap.set(ability, (agentMap.get(ability) || 0) + 1)
    })

    const abilityStats = Array.from(playerAbilityMap.values())
      .map(s => ({
        playerId: s.playerId,
        playerName: s.playerName,
        teamId: s.teamId,
        teamName: teamMap[s.teamId] || `Team ${s.teamId}`,
        totalAbilityUses: s.totalAbilityUses,
        roundsPlayed: roundCount,
        abilitiesPerRound: roundCount > 0 ? Math.round((s.totalAbilityUses / roundCount) * 10) / 10 : 0,
        agentBreakdown: Array.from(s.agentBreakdown.entries()).map(([agent, abilities]) => ({
          agent,
          totalUses: Array.from(abilities.values()).reduce((sum, n) => sum + n, 0),
          abilities: Array.from(abilities.entries())
            .map(([name, uses]) => ({ name, uses }))
            .sort((a, b) => b.uses - a.uses)
        })).sort((a, b) => b.totalUses - a.totalUses)
      }))
      .sort((a, b) => b.totalAbilityUses - a.totalAbilityUses)

    // Opening duel stats - compute from filtered rounds/kills
    const openingDuelMap = new Map<string, {
      playerId: string
      teamId: string
      openingKills: number
      openingDeaths: number
      attackOpeningKills: number
      attackOpeningDeaths: number
      defenseOpeningKills: number
      defenseOpeningDeaths: number
      openingKillsConverted: number
      openingDeathsConverted: number
    }>()

    gameRounds.forEach(round => {
      const fb = round.firstBlood
      if (!fb?.killerId || !fb?.victimId) return

      const killerTeamId = fb.killerTeamId
      const victimTeamId = gameKills.find(k => 
        k.isFirstBlood && k.roundNumber === round.roundNumber
      )?.victimTeamId

      if (!killerTeamId || !victimTeamId) return

      const winnerSide = round.winnerSide
      const killerWon = round.winnerTeamId === killerTeamId
      const killerSide = killerWon ? winnerSide : (winnerSide === 'attack' ? 'defense' : 'attack')
      const victimSide = killerSide === 'attack' ? 'defense' : 'attack'

      // Killer stats
      if (!openingDuelMap.has(fb.killerId)) {
        openingDuelMap.set(fb.killerId, {
          playerId: fb.killerId,
          teamId: killerTeamId,
          openingKills: 0, openingDeaths: 0,
          attackOpeningKills: 0, attackOpeningDeaths: 0,
          defenseOpeningKills: 0, defenseOpeningDeaths: 0,
          openingKillsConverted: 0, openingDeathsConverted: 0
        })
      }
      const killerStats = openingDuelMap.get(fb.killerId)!
      killerStats.openingKills++
      if (killerSide === 'attack') killerStats.attackOpeningKills++
      else killerStats.defenseOpeningKills++
      if (killerWon) killerStats.openingKillsConverted++

      // Victim stats
      if (!openingDuelMap.has(fb.victimId)) {
        openingDuelMap.set(fb.victimId, {
          playerId: fb.victimId,
          teamId: victimTeamId,
          openingKills: 0, openingDeaths: 0,
          attackOpeningKills: 0, attackOpeningDeaths: 0,
          defenseOpeningKills: 0, defenseOpeningDeaths: 0,
          openingKillsConverted: 0, openingDeathsConverted: 0
        })
      }
      const victimStats = openingDuelMap.get(fb.victimId)!
      victimStats.openingDeaths++
      if (victimSide === 'attack') victimStats.attackOpeningDeaths++
      else victimStats.defenseOpeningDeaths++
      if (round.winnerTeamId === victimTeamId) victimStats.openingDeathsConverted++
    })

    const openingDuelStats = Array.from(openingDuelMap.values())
      .filter(s => s.openingKills > 0 || s.openingDeaths > 0)
      .map(s => {
        const player = evidence.players.find(p => p.playerId === s.playerId)
        const totalDuels = s.openingKills + s.openingDeaths
        const attackDuels = s.attackOpeningKills + s.attackOpeningDeaths
        const defenseDuels = s.defenseOpeningKills + s.defenseOpeningDeaths
        return {
          ...s,
          playerName: player?.playerName || `Player ${s.playerId}`,
          teamName: teamMap[s.teamId] || `Team ${s.teamId}`,
          openingDuels: totalDuels,
          openingDuelWinRate: totalDuels > 0 ? s.openingKills / totalDuels : 0,
          attackOpeningDuels: attackDuels,
          attackOpeningWinRate: attackDuels > 0 ? s.attackOpeningKills / attackDuels : 0,
          defenseOpeningDuels: defenseDuels,
          defenseOpeningWinRate: defenseDuels > 0 ? s.defenseOpeningKills / defenseDuels : 0,
          openingKillConversion: s.openingKills > 0 ? s.openingKillsConverted / s.openingKills : 0,
          openingDeathSurvival: s.openingDeaths > 0 ? s.openingDeathsConverted / s.openingDeaths : 0
        }
      })
      .sort((a, b) => b.openingDuels - a.openingDuels)

    // Multi-kill stats - compute from filtered kills
    const roundKillCounts = new Map<string, Map<string, number>>() // roundKey -> playerId -> killCount
    const playerTeams = new Map<string, string>()

    gameKills.forEach(kill => {
      const roundKey = `${kill.gameId}-${kill.roundNumber}`
      const killerId = kill.killerId
      if (!killerId) return

      if (!roundKillCounts.has(roundKey)) roundKillCounts.set(roundKey, new Map())
      const roundMap = roundKillCounts.get(roundKey)!
      roundMap.set(killerId, (roundMap.get(killerId) || 0) + 1)
      if (kill.killerTeamId) playerTeams.set(killerId, kill.killerTeamId)
    })

    const multiKillMap = new Map<string, { twoKs: number; threeKs: number; fourKs: number; aces: number }>()

    roundKillCounts.forEach(roundMap => {
      roundMap.forEach((count, playerId) => {
        if (count < 2) return
        if (!multiKillMap.has(playerId)) {
          multiKillMap.set(playerId, { twoKs: 0, threeKs: 0, fourKs: 0, aces: 0 })
        }
        const stats = multiKillMap.get(playerId)!
        if (count === 2) stats.twoKs++
        else if (count === 3) stats.threeKs++
        else if (count === 4) stats.fourKs++
        else stats.aces++
      })
    })

    const multiKillStats = Array.from(multiKillMap.entries())
      .map(([playerId, stats]) => {
        const player = evidence.players.find(p => p.playerId === playerId)
        const teamId = playerTeams.get(playerId) || ''
        const impactScore = stats.twoKs * 1 + stats.threeKs * 2 + stats.fourKs * 3 + stats.aces * 5
        return {
          playerId,
          playerName: player?.playerName || `Player ${playerId}`,
          teamId,
          teamName: teamMap[teamId] || `Team ${teamId}`,
          ...stats,
          totalMultiKills: stats.twoKs + stats.threeKs + stats.fourKs + stats.aces,
          impactScore
        }
      })
      .sort((a, b) => b.impactScore - a.impactScore)

    // Trade stats - compute from filtered kills
    const TRADE_WINDOW_MS = 3000
    const sortedKills = [...gameKills].sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime()
      const bTime = new Date(b.timestamp).getTime()
      return aTime - bTime
    })

    const tradeStatsMap = new Map<string, {
      playerId: string
      teamId: string
      deaths: number
      deathsTraded: number
      tradesGotten: number
    }>()

    sortedKills.forEach((death, i) => {
      const victimId = death.victimId
      const victimTeamId = death.victimTeamId
      const killerId = death.killerId
      if (!victimId || !killerId) return

      // Initialize victim stats
      if (!tradeStatsMap.has(victimId)) {
        tradeStatsMap.set(victimId, {
          playerId: victimId,
          teamId: victimTeamId || '',
          deaths: 0,
          deathsTraded: 0,
          tradesGotten: 0
        })
      }
      tradeStatsMap.get(victimId)!.deaths++

      const deathTime = new Date(death.timestamp).getTime()

      // Look for trade in subsequent kills
      for (let j = i + 1; j < sortedKills.length; j++) {
        const potentialTrade = sortedKills[j]
        const tradeTime = new Date(potentialTrade.timestamp).getTime()
        if (tradeTime - deathTime > TRADE_WINDOW_MS) break

        // Check if teammate killed the killer
        if (potentialTrade.victimId === killerId && 
            potentialTrade.killerTeamId === victimTeamId &&
            potentialTrade.killerId !== victimId) {
          tradeStatsMap.get(victimId)!.deathsTraded++

          // Credit the trader
          const traderId = potentialTrade.killerId
          if (traderId) {
            if (!tradeStatsMap.has(traderId)) {
              tradeStatsMap.set(traderId, {
                playerId: traderId,
                teamId: potentialTrade.killerTeamId || '',
                deaths: 0,
                deathsTraded: 0,
                tradesGotten: 0
              })
            }
            tradeStatsMap.get(traderId)!.tradesGotten++
          }
          break
        }
      }
    })

    const tradeStats = Array.from(tradeStatsMap.values())
      .filter(s => s.deaths > 0)
      .map(s => {
        const player = evidence.players.find(p => p.playerId === s.playerId)
        return {
          ...s,
          playerName: player?.playerName || `Player ${s.playerId}`,
          teamName: teamMap[s.teamId] || `Team ${s.teamId}`,
          untradedDeaths: s.deaths - s.deathsTraded,
          tradedRate: s.deaths > 0 ? s.deathsTraded / s.deaths : 0
        }
      })
      .sort((a, b) => b.deaths - a.deaths)

    return {
      rounds: gameRounds,
      kills: gameKills,
      plants: gamePlants,
      players: gamePlayers,
      firstBloodStats,
      plantStats,
      siteStats,
      clutchStats,
      economyStats,
      abilityStats,
      openingDuelStats,
      multiKillStats,
      tradeStats
    }
  }, [data, selectedGameId, teamMap])

  const getTeamName = (teamId: string): string => {
    return teamMap[teamId] || `Team ${teamId}`
  }

  if (loading) {
    return (
      <section className="card p-6 backdrop-blur-xl bg-gray-900/70">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-[#ffffff] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Loading evidence data...</p>
        </div>
      </section>
    )
  }

  if (error || !data?.evidence) {
    return (
      <section className="card p-6 backdrop-blur-xl bg-gray-900/70">
        <p className="text-gray-400">
          {error || 'No evidence available for this match yet.'}
        </p>
      </section>
    )
  }

  const { evidence } = data
  const selectedGame = evidence.games.find(g => g.gameId === selectedGameId)

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center gap-3 px-2">
        <div className="w-2 h-8 bg-cyan-500 rounded-full" />
        <div>
          <h3 className="text-lg font-semibold text-white">
            Evidence Data: <span className="text-cyan-400 capitalize">{selectedGame?.mapName}</span>
          </h3>
          <p className="text-sm text-gray-500">Detailed statistics from event data</p>
        </div>
      </div>

      {/* Agent Compositions for Selected Map */}
      {evidence.agentCompositions && selectedGameId && evidence.agentCompositions[selectedGameId] && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Agent Compositions</h2>
          </div>
          <div className="p-6">
            {(() => {
              const composition = evidence.agentCompositions?.[selectedGameId]
              if (!composition || composition.length === 0) return null

              const teamGroups = composition.reduce((acc, pick) => {
                if (!acc[pick.teamId]) acc[pick.teamId] = []
                acc[pick.teamId].push(pick)
                return acc
              }, {} as Record<string, typeof composition>)

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(teamGroups).map(([teamId, picks]) => (
                    <div key={teamId} className="bg-black/30 rounded-lg p-4 border border-gray-800">
                      <div className={`text-sm font-semibold mb-3 ${teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                        {getTeamName(teamId)}
                      </div>
                      <div className="space-y-2">
                        {picks.map((pick) => (
                          <div key={pick.playerId} className="flex justify-between items-center text-sm">
                            <span className="text-gray-300">
                              {pick.playerName || `Player ${pick.playerId}`}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[#ffffff] capitalize">
                                {pick.agent}
                              </span>
                              <AgentImage agent={pick.agent} size="sm" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        </section>
      )}

      {/* First Blood Stats for Selected Map */}
      {filteredStats?.firstBloodStats && filteredStats.firstBloodStats.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">First Blood Stats</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-4 px-6 text-left text-gray-400 font-medium">Team</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">First Bloods</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Rounds Won</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.firstBloodStats.map((stat) => (
                  <tr key={stat.teamId} className="border-b border-gray-800/50 hover:bg-black/20">
                    <td className={`py-4 px-6 font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                      {stat.teamName}
                    </td>
                    <td className="py-4 px-6 text-center text-[#ffffff] font-semibold">{stat.firstBloods}</td>
                    <td className="py-4 px-6 text-center text-green-400">{stat.roundsWon}</td>
                    <td className="py-4 px-6 text-center">
                      <span className={`font-semibold ${stat.conversionRate >= 0.6 ? 'text-green-400' : stat.conversionRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {(stat.conversionRate * 100).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Plant Stats for Selected Map */}
      {filteredStats?.plantStats && filteredStats.plantStats.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Plant Stats</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-4 px-6 text-left text-gray-400 font-medium">Team</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Plants</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Post-Plant Wins</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.plantStats.map((stat) => (
                  <tr key={stat.teamId} className="border-b border-gray-800/50 hover:bg-black/20">
                    <td className={`py-4 px-6 font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                      {stat.teamName}
                    </td>
                    <td className="py-4 px-6 text-center text-[#ffffff] font-semibold">{stat.plants}</td>
                    <td className="py-4 px-6 text-center text-green-400">{stat.postPlantWins}</td>
                    <td className="py-4 px-6 text-center">
                      <span className={`font-semibold ${stat.postPlantWinRate >= 0.6 ? 'text-green-400' : stat.postPlantWinRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {(stat.postPlantWinRate * 100).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Site-Specific Stats with Attack/Defense Split */}
      {filteredStats?.siteStats && filteredStats.siteStats.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Site Performance</h2>
            <p className="text-sm text-gray-400 mt-1">Attack and defense stats by bomb site</p>
          </div>
          <div className="p-6 space-y-6">
            {filteredStats.siteStats.map((stat: any) => (
              <div key={stat.site} className="bg-black/30 rounded-lg p-4 border border-gray-800">
                <div className="text-2xl font-bold text-white mb-4">Site {stat.site}</div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Attack Stats */}
                  <div>
                    <h3 className="text-red-400 font-semibold mb-3">Attack</h3>
                    <div className="space-y-2">
                      {Object.values(stat.attackStats || {}).map((attackStat: any) => (
                        <div key={attackStat.teamId} className="bg-black/40 rounded p-3">
                          <div className={`text-sm font-medium mb-2 ${attackStat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                            {normalizeTeamName(attackStat.teamName)}
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Plants: {attackStat.plants}</span>
                            <span className={`font-semibold ${attackStat.postPlantWinRate >= 0.6 ? 'text-green-400' : attackStat.postPlantWinRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {(attackStat.postPlantWinRate * 100).toFixed(0)}% wins
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {attackStat.postPlantWins}/{attackStat.plants} post-plant wins
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Defense Stats */}
                  <div>
                    <h3 className="text-[#ffffff] font-semibold mb-3">Defense</h3>
                    <div className="space-y-2">
                      {Object.values(stat.defenseStats || {}).map((defenseStat: any) => (
                        <div key={defenseStat.teamId} className="bg-black/40 rounded p-3">
                          <div className={`text-sm font-medium mb-2 ${defenseStat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                            {normalizeTeamName(defenseStat.teamName)}
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Attempts: {defenseStat.defenseAttempts}</span>
                            <span className={`font-semibold ${defenseStat.defenseWinRate >= 0.6 ? 'text-green-400' : defenseStat.defenseWinRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {(defenseStat.defenseWinRate * 100).toFixed(0)}% held
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {defenseStat.defenseWins}/{defenseStat.defenseAttempts} successful defenses
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Isolated Deaths for Selected Map */}
      {filteredStats?.players && filteredStats.players.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Isolated Deaths (All Players)</h2>
            <p className="text-sm text-gray-400 mt-1">
              Deaths far from teammates (threshold: {evidence.meta.isoThreshold || 2500} units)
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-4 px-6 text-left text-gray-400 font-medium">Player</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Team</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Isolated Deaths</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Total Deaths</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Isolation %</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.players
                  .filter(p => p.deaths > 0)
                  .sort((a, b) => b.isolatedDeathsCount - a.isolatedDeathsCount)
                  .map((player) => (
                    <tr key={player.playerId} className="border-b border-gray-800/50 hover:bg-black/20">
                      <td className={`py-4 px-6 font-medium ${player.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                        {player.playerName || `Player ${player.playerId}`}
                      </td>
                      <td className={`py-4 px-6 text-center font-medium ${player.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                        {getTeamName(player.teamId)}
                      </td>
                      <td className="py-4 px-6 text-center text-red-400 font-semibold">
                        {player.isolatedDeathsCount}
                      </td>
                      <td className="py-4 px-6 text-center text-gray-300">{player.deaths}</td>
                      <td className="py-4 px-6 text-center">
                        <span className={`font-semibold ${(player.isolatedDeathsCount / player.deaths) > 0.15 ? 'text-red-400' : 'text-green-400'}`}>
                          {player.deaths > 0
                            ? ((player.isolatedDeathsCount / player.deaths) * 100).toFixed(1)
                            : '0.0'}%
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Economy Stats for Selected Map */}
      {filteredStats?.economyStats && filteredStats.economyStats.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Economy Performance</h2>
            <p className="text-sm text-gray-400 mt-1">Win rate by buy type</p>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredStats.economyStats.map((stat: any) => (
              <div key={stat.teamId}>
                <h3 className={`font-semibold mb-4 ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                  {normalizeTeamName(stat.teamName)}
                </h3>
                <div className="space-y-3">
                  {Object.entries(stat.byTier).map(([tier, data]: [string, any]) => (
                    <div key={tier} className="flex justify-between items-center">
                      <span className="text-gray-400 capitalize">{tier.replace('_', ' ')}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-gray-500">{data.rounds} rounds</span>
                        <span className={`font-semibold ${data.winRate >= 0.5 ? 'text-green-400' : 'text-red-400'}`}>
                          {(data.winRate * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Opening Duel Performance */}
      {filteredStats?.openingDuelStats && filteredStats.openingDuelStats.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Opening Duel Performance</h2>
            <p className="text-sm text-gray-400 mt-1">First kill of each round - win rates and side splits</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-4 px-6 text-left text-gray-400 font-medium">Player</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Team</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Duels</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Kills</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Deaths</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Win Rate</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Attack WR</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Defense WR</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.openingDuelStats.map((stat: any) => {
                  const winRate = stat.openingDuelWinRate
                  const attackWR = stat.attackOpeningWinRate
                  const defenseWR = stat.defenseOpeningWinRate

                  const getColorClass = (rate: number) => {
                    if (rate >= 0.6) return 'text-green-400'
                    if (rate >= 0.4) return 'text-yellow-400'
                    return 'text-red-400'
                  }

                  return (
                    <tr key={stat.playerId} className="border-b border-gray-800/50 hover:bg-black/20">
                      <td className={`py-4 px-6 font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                        {stat.playerName || `Player ${stat.playerId}`}
                      </td>
                      <td className={`py-4 px-6 text-center font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                        {getTeamName(stat.teamId)}
                      </td>
                      <td className="py-4 px-6 text-center text-gray-300">{stat.openingDuels}</td>
                      <td className="py-4 px-6 text-center text-green-400">{stat.openingKills}</td>
                      <td className="py-4 px-6 text-center text-red-400">{stat.openingDeaths}</td>
                      <td className="py-4 px-6 text-center">
                        <span className={`font-semibold ${getColorClass(winRate)}`}>
                          {(winRate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className={`font-semibold ${getColorClass(attackWR)}`}>
                          {(attackWR * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className={`font-semibold ${getColorClass(defenseWR)}`}>
                          {(defenseWR * 100).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Clutch Performance */}
      {filteredStats?.clutchStats && filteredStats.clutchStats.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Clutch Performance</h2>
            <p className="text-sm text-gray-400 mt-1">1vX situations and win rates</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-4 px-6 text-left text-gray-400 font-medium">Player</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Team</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Attempts</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Wins</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Rate</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.clutchStats.map((stat: any) => {
                  const rate = stat.clutchRate

                  return (
                    <tr key={stat.playerId} className="border-b border-gray-800/50 hover:bg-black/20">
                      <td className={`py-4 px-6 font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                        {stat.playerName || `Player ${stat.playerId}`}
                      </td>
                      <td className={`py-4 px-6 text-center font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                        {getTeamName(stat.teamId)}
                      </td>
                      <td className="py-4 px-6 text-center text-gray-300">{stat.clutchAttempts}</td>
                      <td className="py-4 px-6 text-center text-green-400">{stat.clutchWins}</td>
                      <td className="py-4 px-6 text-center">
                        <span className={`font-semibold ${rate >= 0.4 ? 'text-green-400' : rate >= 0.2 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {(rate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex gap-2 justify-center flex-wrap">
                          {Object.entries(stat.breakdown || {}).map(([situation, data]: [string, any]) => (
                            <span
                              key={situation}
                              className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-300"
                              title={`${data.wins}/${data.attempts} won`}
                            >
                              {situation}: {data.wins}/{data.attempts}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Trade Efficiency */}
      {filteredStats?.tradeStats && filteredStats.tradeStats.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Trade Efficiency</h2>
            <p className="text-sm text-gray-400 mt-1">Deaths traded within 3 seconds by teammates</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-4 px-6 text-left text-gray-400 font-medium">Player</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Team</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Deaths</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Traded</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Untraded</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Trade Rate</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Trades Given</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.tradeStats.map((stat: any) => {
                  const rate = stat.tradedRate

                  return (
                    <tr key={stat.playerId} className="border-b border-gray-800/50 hover:bg-black/20">
                      <td className={`py-4 px-6 font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                        {stat.playerName || `Player ${stat.playerId}`}
                      </td>
                      <td className={`py-4 px-6 text-center font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                        {getTeamName(stat.teamId)}
                      </td>
                      <td className="py-4 px-6 text-center text-gray-300">{stat.deaths}</td>
                      <td className="py-4 px-6 text-center text-green-400">{stat.deathsTraded}</td>
                      <td className="py-4 px-6 text-center text-red-400">{stat.untradedDeaths}</td>
                      <td className="py-4 px-6 text-center">
                        <span className={`font-semibold ${rate >= 0.3 ? 'text-green-400' : rate >= 0.15 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {(rate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className={`py-4 px-6 text-center ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                        {stat.tradesGotten}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Multi-Kill Rounds */}
      {filteredStats?.multiKillStats && filteredStats.multiKillStats.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Multi-Kill Rounds</h2>
            <p className="text-sm text-gray-400 mt-1">2Ks, 3Ks, 4Ks, and Aces</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-4 px-6 text-left text-gray-400 font-medium">Player</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Team</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">2Ks</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">3Ks</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">4Ks</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Aces</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Impact Score</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.multiKillStats
                  .map((stat: any) => {
                    return (
                      <tr key={stat.playerId} className="border-b border-gray-800/50 hover:bg-black/20">
                        <td className={`py-4 px-6 font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                          {stat.playerName || `Player ${stat.playerId}`}
                        </td>
                        <td className={`py-4 px-6 text-center font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                          {getTeamName(stat.teamId)}
                        </td>
                        <td className="py-4 px-6 text-center text-gray-300">{stat.twoKs}</td>
                        <td className="py-4 px-6 text-center text-[#ffffff]">{stat.threeKs}</td>
                        <td className="py-4 px-6 text-center text-purple-400">{stat.fourKs}</td>
                        <td className="py-4 px-6 text-center text-yellow-400">{stat.aces}</td>
                        <td className="py-4 px-6 text-center">
                          <span className="font-semibold text-green-400">{stat.impactScore}</span>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Ability Usage */}
      {filteredStats?.abilityStats && filteredStats.abilityStats.length > 0 && (
        <section className="card backdrop-blur-xl bg-gray-900/70">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Ability Usage</h2>
            <p className="text-sm text-gray-400 mt-1">Agent abilities used per round</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-4 px-6 text-left text-gray-400 font-medium">Player</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Team</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Agents</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Total Uses</th>
                  <th className="py-4 px-6 text-center text-gray-400 font-medium">Per Round</th>
                  <th className="py-4 px-6 text-left text-gray-400 font-medium">Top 3 Abilities</th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.abilityStats.map((stat: any) => {
                  // Get all abilities across agents and sort by usage
                  const allAbilities: Array<{name: string, uses: number, agent: string}> = []
                  stat.agentBreakdown.forEach((agentData: any) => {
                    agentData.abilities.forEach((ability: any) => {
                      allAbilities.push({
                        name: ability.name,
                        uses: ability.uses,
                        agent: agentData.agent
                      })
                    })
                  })
                  const top3 = allAbilities
                    .sort((a, b) => b.uses - a.uses)
                    .slice(0, 3)

                  return (
                    <tr key={stat.playerId} className="border-b border-gray-800/50 hover:bg-black/20">
                      <td className={`py-4 px-6 font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                        {stat.playerName || `Player ${stat.playerId}`}
                      </td>
                      <td className={`py-4 px-6 text-center font-medium ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-400'}`}>
                        {getTeamName(stat.teamId)}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex gap-2 justify-center">
                          {stat.agentBreakdown.map((agentData: any) => (
                            <AgentImage key={agentData.agent} agent={agentData.agent} size="sm" />
                          ))}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-center text-gray-300">{stat.totalAbilityUses}</td>
                      <td className={`py-4 px-6 text-center ${stat.teamId === '79' ? 'text-[#ffffff]' : 'text-gray-300'}`}>
                        {stat.abilitiesPerRound.toFixed(1)}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex gap-2 flex-wrap">
                          {top3.map((ability, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-300"
                            >
                              {ability.name}: {ability.uses}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Evidence Metadata */}
      {data.evidenceMeta && (
        <div className="text-xs text-gray-500 text-right">
          Evidence extracted: {new Date(data.evidenceMeta.extractedAt).toLocaleString()} •
          Version: {data.evidenceMeta.version}
        </div>
      )}
    </div>
  )
}
