import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { connectToDB } from '@/lib/db'
import { Match, type MatchDocument } from '@/models/Match'
import { computeMatchAnalytics } from '@/lib/analytics/computeMatchAnalytics'
import { generateCoachingReport } from '@/lib/ai/coach'
import { DAILY_QUOTA_REACHED_CODE, DailyQuotaReachedError } from '@/lib/ai/llmClient'

// Increase timeout for LLM calls (Vercel default is 10s, we need more for Gemini)
export const maxDuration = 60 // 60 seconds max

/**
 * GET /api/coach/match
 * Fetch match data with evidence_v1
 * Query params: matchId or seriesId
 */
export async function GET(req: NextRequest) {
  // await requireAuth()
  await connectToDB()

  const { searchParams } = new URL(req.url)
  const matchId = searchParams.get('matchId')
  const seriesId = searchParams.get('seriesId')

  if (!matchId && !seriesId) {
    return NextResponse.json(
      { error: 'Either matchId or seriesId is required' },
      { status: 400 }
    )
  }

  let match: MatchDocument | null = null

  try {
    if (matchId) {
      match = (await Match.findById(matchId).lean()) as MatchDocument | null
    } else if (seriesId) {
      match = (await Match.findOne({ gridSeriesId: seriesId }).lean()) as MatchDocument | null
    }

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    // Build response with evidence
    const response = {
      matchId: match._id.toString(),
      meta: {
        seriesId: match.gridSeriesId || '',
        tournamentId: match.tournamentId || '',
        map: match.map,
        opponentName: match.opponentName,
        eventName: match.eventName,
        date: match.date,
        games: match.analytics?.evidence_v1?.games || [],
      },
      evidence: match.analytics?.evidence_v1 || null,
      evidenceMeta: match.analytics?.evidence_v1_meta || null,
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('Failed to fetch match', err)
    return NextResponse.json(
      { error: 'Failed to fetch match' },
      { status: 500 }
    )
  }
}

/**
 * Filter evidence data to only include a specific game/map
 */
function filterEvidenceByGame(evidence: any, gameId: string): any {
  if (!evidence || !gameId) return evidence

  const game = evidence.games?.find((g: any) => g.gameId === gameId)
  if (!game) return evidence

  // Filter all arrays by gameId
  const filteredRounds = evidence.rounds?.filter((r: any) => r.gameId === gameId) || []
  const filteredKills = evidence.kills?.filter((k: any) => k.gameId === gameId) || []
  const filteredPlants = evidence.plants?.filter((p: any) => p.gameId === gameId) || []
  const filteredDefuses = evidence.defuses?.filter((d: any) => d.gameId === gameId) || []
  const filteredClutches = evidence.clutchSituations?.filter((c: any) => c.gameId === gameId) || []
  const filteredEconomy = evidence.economyRounds?.filter((e: any) => e.gameId === gameId) || []
  const filteredAbilities = evidence.abilityUses?.filter((a: any) => a.gameId === gameId) || []

  // Recompute player stats for this game only
  const playerStatsMap = new Map<string, any>()
  
  // Initialize from evidence players
  evidence.players?.forEach((p: any) => {
    playerStatsMap.set(p.playerId, {
      ...p,
      kills: 0,
      deaths: 0,
      firstBloods: 0,
      firstDeaths: 0,
      isolatedDeathsCount: 0
    })
  })

  // Count from filtered kills
  filteredKills.forEach((kill: any) => {
    if (kill.killerId && playerStatsMap.has(kill.killerId)) {
      const player = playerStatsMap.get(kill.killerId)
      player.kills++
    }
    if (kill.victimId && playerStatsMap.has(kill.victimId)) {
      const player = playerStatsMap.get(kill.victimId)
      player.deaths++
      if (kill.isIsolated) {
        player.isolatedDeathsCount++
      }
    }
    if (kill.isFirstBlood) {
      if (kill.killerId && playerStatsMap.has(kill.killerId)) {
        playerStatsMap.get(kill.killerId).firstBloods++
      }
      if (kill.victimId && playerStatsMap.has(kill.victimId)) {
        playerStatsMap.get(kill.victimId).firstDeaths++
      }
    }
  })

  const filteredPlayers = Array.from(playerStatsMap.values())
    .filter(p => p.kills > 0 || p.deaths > 0)
    .map(p => ({
      ...p,
      kd: p.deaths > 0 ? p.kills / p.deaths : p.kills
    }))

  // Recompute derived stats for this game
  const teamFBStats = new Map<string, { firstBloods: number; roundsWon: number; teamName: string; teamId: string }>()
  
  filteredRounds.forEach((round: any) => {
    const fb = round.firstBlood
    if (fb?.killerTeamId) {
      if (!teamFBStats.has(fb.killerTeamId)) {
        // Try to get team name from mapsStats
        const teamInfo = evidence.derived?.mapsStats?.find((s: any) => s.teamId === fb.killerTeamId)
        teamFBStats.set(fb.killerTeamId, { 
          firstBloods: 0, 
          roundsWon: 0, 
          teamName: teamInfo?.teamName || `Team ${fb.killerTeamId}`,
          teamId: fb.killerTeamId
        })
      }
      teamFBStats.get(fb.killerTeamId)!.firstBloods++
      
      if (round.winnerTeamId === fb.killerTeamId) {
        teamFBStats.get(fb.killerTeamId)!.roundsWon++
      }
    }
  })

  const filteredFirstBloodStats = Array.from(teamFBStats.values()).map(stats => ({
    teamId: stats.teamId,
    teamName: stats.teamName,
    firstBloods: stats.firstBloods,
    roundsWon: stats.roundsWon,
    conversionRate: stats.firstBloods > 0 ? stats.roundsWon / stats.firstBloods : 0
  }))

  // Compute plant stats
  const teamPlantStats = new Map<string, { plants: number; postPlantWins: number; teamName: string; teamId: string }>()
  
  filteredPlants.forEach((plant: any) => {
    const teamId = plant.planterTeamId
    if (!teamId) return
    
    if (!teamPlantStats.has(teamId)) {
      const teamInfo = evidence.derived?.mapsStats?.find((s: any) => s.teamId === teamId)
      teamPlantStats.set(teamId, { 
        plants: 0, 
        postPlantWins: 0, 
        teamName: teamInfo?.teamName || `Team ${teamId}`,
        teamId
      })
    }
    teamPlantStats.get(teamId)!.plants++
    
    const round = filteredRounds.find((r: any) => r.roundNumber === plant.roundNumber)
    if (round?.winnerTeamId === teamId) {
      teamPlantStats.get(teamId)!.postPlantWins++
    }
  })

  const filteredPlantStats = Array.from(teamPlantStats.values()).map(stats => ({
    teamId: stats.teamId,
    teamName: stats.teamName,
    plants: stats.plants,
    postPlantWins: stats.postPlantWins,
    postPlantWinRate: stats.plants > 0 ? stats.postPlantWins / stats.plants : 0
  }))

  // Compute site stats
  const siteStatsMap = new Map<string, { plants: number; postPlantWins: number }>()
  
  filteredPlants.forEach((plant: any) => {
    const site = plant.site
    if (!site || site === 'unknown') return
    
    if (!siteStatsMap.has(site)) {
      siteStatsMap.set(site, { plants: 0, postPlantWins: 0 })
    }
    siteStatsMap.get(site)!.plants++
    
    const round = filteredRounds.find((r: any) => r.roundNumber === plant.roundNumber)
    if (round?.winnerTeamId === plant.planterTeamId) {
      siteStatsMap.get(site)!.postPlantWins++
    }
  })

  const filteredSiteStats = Array.from(siteStatsMap.entries()).map(([site, stats]) => ({
    site,
    plants: stats.plants,
    postPlantWins: stats.postPlantWins,
    postPlantWinRate: stats.plants > 0 ? stats.postPlantWins / stats.plants : 0
  })).sort((a, b) => a.site.localeCompare(b.site))

  // Filter mapsStats for this game only
  const filteredMapsStats = evidence.derived?.mapsStats?.filter((s: any) => s.gameId === gameId) || []

  // Recompute clutch stats for this game
  const clutchStatsMap = new Map<string, any>()
  filteredClutches.forEach((clutch: any) => {
    const playerId = clutch.playerId
    if (!playerId) return
    if (!clutchStatsMap.has(playerId)) {
      clutchStatsMap.set(playerId, {
        playerId,
        playerName: clutch.playerName || `Player ${playerId}`,
        teamId: clutch.teamId,
        clutchAttempts: 0,
        clutchWins: 0,
        breakdown: {} as Record<string, { attempts: number; wins: number }>
      })
    }
    const stats = clutchStatsMap.get(playerId)!
    stats.clutchAttempts++
    if (clutch.won) stats.clutchWins++
    const situation = clutch.situation || 'unknown'
    if (!stats.breakdown[situation]) stats.breakdown[situation] = { attempts: 0, wins: 0 }
    stats.breakdown[situation].attempts++
    if (clutch.won) stats.breakdown[situation].wins++
  })
  const filteredClutchStats = Array.from(clutchStatsMap.values()).map(s => ({
    ...s,
    clutchRate: s.clutchAttempts > 0 ? s.clutchWins / s.clutchAttempts : 0
  }))

  // Recompute economy stats for this game
  const teamEconomyMap = new Map<string, any>()
  filteredEconomy.forEach((eco: any) => {
    const teamId = eco.teamId
    const tier = eco.economyTier
    if (!teamId || !tier) return
    if (!teamEconomyMap.has(teamId)) {
      teamEconomyMap.set(teamId, { teamId, teamName: eco.teamName, byTier: {} })
    }
    const stats = teamEconomyMap.get(teamId)!
    if (!stats.byTier[tier]) stats.byTier[tier] = { rounds: 0, wins: 0 }
    stats.byTier[tier].rounds++
    if (eco.roundWon) stats.byTier[tier].wins++
  })
  const filteredEconomyStats = Array.from(teamEconomyMap.values()).map(s => ({
    ...s,
    byTier: Object.fromEntries(
      Object.entries(s.byTier).map(([tier, data]: [string, any]) => [
        tier,
        { ...data, winRate: data.rounds > 0 ? data.wins / data.rounds : 0 }
      ])
    )
  }))

  // Recompute ability stats for this game
  const roundCount = filteredRounds.length
  const playerAbilityMap = new Map<string, any>()
  filteredAbilities.forEach((use: any) => {
    const playerId = use.playerId
    const agent = use.agent || 'unknown'
    const ability = use.abilityName || 'unknown'
    if (!playerId) return
    if (!playerAbilityMap.has(playerId)) {
      const player = evidence.players?.find((p: any) => p.playerId === playerId)
      playerAbilityMap.set(playerId, {
        playerId,
        playerName: player?.playerName || `Player ${playerId}`,
        teamId: use.teamId,
        totalAbilityUses: 0,
        agentBreakdown: new Map<string, Map<string, number>>()
      })
    }
    const stats = playerAbilityMap.get(playerId)!
    stats.totalAbilityUses++
    if (!stats.agentBreakdown.has(agent)) stats.agentBreakdown.set(agent, new Map())
    const agentMap = stats.agentBreakdown.get(agent)!
    agentMap.set(ability, (agentMap.get(ability) || 0) + 1)
  })
  const filteredAbilityStats = Array.from(playerAbilityMap.values()).map(s => ({
    playerId: s.playerId,
    playerName: s.playerName,
    teamId: s.teamId,
    totalAbilityUses: s.totalAbilityUses,
    roundsPlayed: roundCount,
    abilitiesPerRound: roundCount > 0 ? Math.round((s.totalAbilityUses / roundCount) * 10) / 10 : 0,
    agentBreakdown: (Array.from(s.agentBreakdown.entries()) as [string, Map<string, number>][]).map(([agent, abilities]) => ({
      agent,
      totalUses: Array.from(abilities.values()).reduce((sum, n) => sum + n, 0),
      abilities: Array.from(abilities.entries())
        .map(([name, uses]) => ({ name, uses }))
        .sort((a, b) => b.uses - a.uses)
    })).sort((a, b) => (b.totalUses as number) - (a.totalUses as number))
  })).sort((a, b) => b.totalAbilityUses - a.totalAbilityUses)

  // Recompute multi-kill stats for this game
  const roundKillCounts = new Map<string, Map<string, number>>()
  const playerTeams = new Map<string, string>()
  filteredKills.forEach((kill: any) => {
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
      if (!multiKillMap.has(playerId)) multiKillMap.set(playerId, { twoKs: 0, threeKs: 0, fourKs: 0, aces: 0 })
      const stats = multiKillMap.get(playerId)!
      if (count === 2) stats.twoKs++
      else if (count === 3) stats.threeKs++
      else if (count === 4) stats.fourKs++
      else stats.aces++
    })
  })
  const filteredMultiKillStats = Array.from(multiKillMap.entries()).map(([playerId, stats]) => {
    const player = evidence.players?.find((p: any) => p.playerId === playerId)
    const teamId = playerTeams.get(playerId) || ''
    const impactScore = stats.twoKs * 1 + stats.threeKs * 2 + stats.fourKs * 3 + stats.aces * 5
    return { playerId, playerName: player?.playerName || `Player ${playerId}`, teamId, ...stats, impactScore }
  }).sort((a, b) => b.impactScore - a.impactScore)

  // Recompute trade stats for this game
  const TRADE_WINDOW_MS = 3000
  const sortedKills = [...filteredKills].sort((a: any, b: any) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
  const tradeStatsMap = new Map<string, { playerId: string; teamId: string; deaths: number; deathsTraded: number; tradesGotten: number }>()
  sortedKills.forEach((death: any, i: number) => {
    const victimId = death.victimId
    const victimTeamId = death.victimTeamId
    const killerId = death.killerId
    if (!victimId || !killerId) return
    if (!tradeStatsMap.has(victimId)) {
      tradeStatsMap.set(victimId, { playerId: victimId, teamId: victimTeamId || '', deaths: 0, deathsTraded: 0, tradesGotten: 0 })
    }
    tradeStatsMap.get(victimId)!.deaths++
    const deathTime = new Date(death.timestamp).getTime()
    for (let j = i + 1; j < sortedKills.length; j++) {
      const potentialTrade = sortedKills[j]
      const tradeTime = new Date(potentialTrade.timestamp).getTime()
      if (tradeTime - deathTime > TRADE_WINDOW_MS) break
      if (potentialTrade.victimId === killerId && potentialTrade.killerTeamId === victimTeamId && potentialTrade.killerId !== victimId) {
        tradeStatsMap.get(victimId)!.deathsTraded++
        const traderId = potentialTrade.killerId
        if (traderId) {
          if (!tradeStatsMap.has(traderId)) {
            tradeStatsMap.set(traderId, { playerId: traderId, teamId: potentialTrade.killerTeamId || '', deaths: 0, deathsTraded: 0, tradesGotten: 0 })
          }
          tradeStatsMap.get(traderId)!.tradesGotten++
        }
        break
      }
    }
  })
  const filteredTradeStats = Array.from(tradeStatsMap.values()).filter(s => s.deaths > 0).map(s => {
    const player = evidence.players?.find((p: any) => p.playerId === s.playerId)
    return {
      ...s,
      playerName: player?.playerName || `Player ${s.playerId}`,
      untradedDeaths: s.deaths - s.deathsTraded,
      tradedRate: s.deaths > 0 ? s.deathsTraded / s.deaths : 0
    }
  }).sort((a, b) => b.deaths - a.deaths)

  return {
    ...evidence,
    games: [game],
    rounds: filteredRounds,
    kills: filteredKills,
    plants: filteredPlants,
    defuses: filteredDefuses,
    clutchSituations: filteredClutches,
    economyRounds: filteredEconomy,
    abilityUses: filteredAbilities,
    players: filteredPlayers,
    agentCompositions: evidence.agentCompositions?.[gameId] 
      ? { [gameId]: evidence.agentCompositions[gameId] } 
      : {},
    derived: {
      ...evidence.derived,
      mapsStats: filteredMapsStats,
      firstBloodStats: filteredFirstBloodStats,
      plantStats: filteredPlantStats,
      siteStats: filteredSiteStats,
      clutchStats: filteredClutchStats,
      economyStats: filteredEconomyStats,
      abilityStats: filteredAbilityStats,
      multiKillStats: filteredMultiKillStats,
      tradeStats: filteredTradeStats,
    },
    meta: {
      ...evidence.meta,
      filteredForGame: gameId,
      mapName: game.mapName
    }
  }
}

/**
 * POST /api/coach/match
 * Generate coaching report for a match (optionally per-map)
 * Body: { matchId: string, gameId?: string }
 */
export async function POST(req: NextRequest) {
  // await requireAuth()
  await connectToDB()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const matchId = (body as Record<string, unknown>)?.matchId as string | undefined
  const gameId = (body as Record<string, unknown>)?.gameId as string | undefined
  
  if (!matchId) {
    return NextResponse.json({ error: 'matchId is required' }, { status: 400 })
  }

  const match = (await Match.findById(matchId).lean()) as MatchDocument | null
  if (!match) {
    return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  }

  let analytics
  try {
    analytics = computeMatchAnalytics(match)
  } catch (err) {
    console.error('Failed to compute analytics for match', matchId, err)
    return NextResponse.json(
      { error: 'Failed to compute analytics' },
      { status: 500 }
    )
  }

  try {
    // Get evidence and optionally filter by gameId
    let evidence = match.analytics?.evidence_v1 || null
    
    if (evidence && gameId) {
      // Filter evidence to only include the selected game/map
      evidence = filterEvidenceByGame(evidence, gameId)

      // Update analytics to reflect the specific map
      const game = evidence?.games?.[0]
      if (game) {
        analytics.map = game.mapName

        // Update round stats from filtered data
        const c9Stats = evidence?.derived?.mapsStats?.find((s: any) => s.teamId === '79')
        const oppStats = evidence?.derived?.mapsStats?.find((s: any) => s.teamId !== '79')
        
        if (c9Stats) {
          analytics.teamRoundsWon = c9Stats.roundsWon
        }
        if (oppStats) {
          analytics.teamRoundsLost = oppStats.roundsWon
          analytics.opponentName = oppStats.teamName
        }
        analytics.roundsPlayed = (analytics.teamRoundsWon || 0) + (analytics.teamRoundsLost || 0)
      }
    }
    
    const report = await generateCoachingReport(analytics, evidence)
    return NextResponse.json({ report })
  } catch (err) {
    console.error('Failed to generate coaching report', err)

    if (err instanceof DailyQuotaReachedError) {
      return NextResponse.json(
        {
          code: DAILY_QUOTA_REACHED_CODE,
          error: 'Daily AI quota reached. Please come back after 24 hours.',
        },
        { status: 429 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to generate coaching report' },
      { status: 500 }
    )
  }
}
