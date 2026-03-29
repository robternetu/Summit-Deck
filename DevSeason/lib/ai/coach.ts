import {
  MatchAnalytics,
  PlayerStats,
} from '@/lib/analytics/computeMatchAnalytics'
import type { EvidenceV1 } from '@/models/Match'
import { generateCoachReport as callLLM } from './llmClient'

// Re-export types for convenience
export type { MatchAnalytics, PlayerStats }

export function buildCoachPrompt(analytics: MatchAnalytics, evidence?: EvidenceV1 | null): string {
  const {
    teamName,
    opponentName,
    map,
    eventName,
    date,
    roundsPlayed,
    teamRoundsWon,
    teamRoundsLost,
    players,
  } = analytics

  const topPlayers = [...players]
    .sort((a, b) => b.kd - a.kd || b.kills - a.kills)
    .slice(0, 3)

  const playerLines = players
    .map((p) => `${p.name}: ${p.kills}/${p.deaths} (KD ${p.kd.toFixed(2)})`)
    .join('\n')

  const topPlayerLines = topPlayers
    .map(
      (p) =>
        `${p.name} - KD ${p.kd.toFixed(2)}, Kills ${p.kills}, Deaths ${p.deaths}`
    )
    .join('\n')

  // Build evidence section if available
  let evidenceSection = ''
  if (evidence) {
    evidenceSection = `
EVIDENCE (Advanced Metrics from GRID):

First Blood Stats:
${evidence.derived?.firstBloodStats?.map((fb: any) =>
  `- ${fb.teamName}: ${fb.firstBloods} first bloods, ${fb.roundsWon} rounds won (${(fb.conversionRate * 100).toFixed(1)}% conversion)`
).join('\n') || 'No data'}

Plant Stats:
${evidence.derived?.plantStats?.map((p: any) =>
  `- ${p.teamName}: ${p.plants} plants, ${p.postPlantWins} post-plant wins (${(p.postPlantWinRate * 100).toFixed(1)}% win rate)`
).join('\n') || 'No data'}

Isolated Deaths (Top 5):
${evidence.players
  ?.sort((a: any, b: any) => b.isolatedDeathsCount - a.isolatedDeathsCount)
  .slice(0, 5)
  .map((p: any) => {
    const name = p.playerName || `Player ${p.playerId}`
    const percentage = p.deaths > 0 ? ((p.isolatedDeathsCount / p.deaths) * 100).toFixed(1) : '0.0'
    return `- ${name}: ${p.isolatedDeathsCount} isolated deaths out of ${p.deaths} total (${percentage}%)`
  })
  .join('\n') || 'No data'}
`

    // Add site-specific stats if available
    if (evidence?.derived?.siteStats && evidence.derived.siteStats.length > 0) {
      evidenceSection += `
Site-Specific Performance:
${evidence.derived.siteStats.map((s: any) =>
  `- Site ${s.site}: ${s.plants} plants, ${(s.postPlantWinRate * 100).toFixed(0)}% post-plant win rate`
).join('\n')}
`
    }

    // Add clutch stats if available
    if (evidence?.derived?.clutchStats && evidence.derived.clutchStats.length > 0) {
      evidenceSection += `
Clutch Performance (1vX situations):
${evidence.derived.clutchStats.slice(0, 5).map((c: any) => {
  const breakdownStr = Object.entries(c.breakdown)
    .map(([situation, stats]: [string, any]) => `${situation}: ${stats.wins}/${stats.attempts}`)
    .join(', ')
  return `- ${c.playerName}: ${c.clutchWins}/${c.clutchAttempts} clutches won (${(c.clutchRate * 100).toFixed(1)}%) - ${breakdownStr}`
}).join('\n')}
`
    }

    // Add economy stats if available
    if (evidence?.derived?.economyStats && evidence.derived.economyStats.length > 0) {
      evidenceSection += `
Economy Performance:
${evidence.derived.economyStats.map((e: any) => {
  const fullBuy = e.byTier?.full_buy || { rounds: 0, wins: 0, winRate: 0 }
  const eco = e.byTier?.eco || { rounds: 0, wins: 0, winRate: 0 }
  const save = e.byTier?.save || { rounds: 0, wins: 0, winRate: 0 }
  const forceAfterPistol = e.forceAfterPistolLoss || { attempts: 0, wins: 0, winRate: 0 }

  return `- ${e.teamName}:
  Full Buy: ${fullBuy.wins}/${fullBuy.rounds} (${(fullBuy.winRate * 100).toFixed(0)}%)
  Eco/Save: ${eco.wins + save.wins}/${eco.rounds + save.rounds} (${(((eco.wins + save.wins) / (eco.rounds + save.rounds || 1)) * 100).toFixed(0)}%)${forceAfterPistol.attempts > 0 ? `
  Force after pistol loss: ${forceAfterPistol.wins}/${forceAfterPistol.attempts} (${(forceAfterPistol.winRate * 100).toFixed(0)}%)` : ''}`
}).join('\n')}
`
    }

    // Add ability usage stats if available
    if (evidence?.derived?.abilityStats && evidence.derived.abilityStats.length > 0) {
      evidenceSection += `
Ability Usage (Top 5 players):
${evidence.derived.abilityStats.slice(0, 5).map((p: any) => {
  const topAgent = p.agentBreakdown[0]
  const topAbilities = topAgent?.abilities.slice(0, 3).map((a: any) => `${a.name}: ${a.uses}`).join(', ')
  return `- ${p.playerName} (${topAgent?.agent}): ${p.abilitiesPerRound} abilities/round [${topAbilities}]`
}).join('\n')}
`
    }

    // Add trade kill analysis if available
    if (evidence?.derived?.tradeStats && evidence.derived.tradeStats.length > 0) {
      // Sort by traded rate (lowest first = most problematic)
      const sortedByTraded = [...evidence.derived.tradeStats]
        .filter((p: any) => p.deaths >= 5)  // Only players with significant deaths
        .sort((a: any, b: any) => a.tradedRate - b.tradedRate)

      const worstTraded = sortedByTraded.slice(0, 3)
      const bestTraders = [...evidence.derived.tradeStats]
        .sort((a: any, b: any) => b.tradesGotten - a.tradesGotten)
        .slice(0, 3)

      evidenceSection += `
Trade Kill Analysis:
${worstTraded.length > 0 ? `Players with lowest trade rates (vulnerable positioning):
${worstTraded.map((p: any) =>
  `- ${p.playerName}: ${(p.tradedRate * 100).toFixed(0)}% traded (${p.deathsTraded}/${p.deaths} deaths traded, ${p.untradedDeaths} untraded)`
).join('\n')}` : ''}
${bestTraders.length > 0 && bestTraders[0].tradesGotten > 0 ? `
Best traders (team coordination):
${bestTraders.filter((p: any) => p.tradesGotten > 0).map((p: any) =>
  `- ${p.playerName}: ${p.tradesGotten} trades gotten for teammates`
).join('\n')}` : ''}
`
    }

    // Add opening duel analysis if available
    if (evidence?.derived?.openingDuelStats && evidence.derived.openingDuelStats.length > 0) {
      // Filter to significant sample size
      const significantPlayers = evidence.derived.openingDuelStats.filter((p: any) => p.openingDuels >= 5)

      // Best overall
      const bestOverall = [...significantPlayers]
        .sort((a: any, b: any) => b.openingDuelWinRate - a.openingDuelWinRate)
        .slice(0, 3)

      // Best on attack
      const bestAttack = [...significantPlayers]
        .filter((p: any) => p.attackOpeningDuels >= 3)
        .sort((a: any, b: any) => b.attackOpeningWinRate - a.attackOpeningWinRate)
        .slice(0, 3)

      // Worst performers (struggling in opening duels)
      const worst = [...significantPlayers]
        .sort((a: any, b: any) => a.openingDuelWinRate - b.openingDuelWinRate)
        .slice(0, 3)

      evidenceSection += `
Opening Duel Analysis:
${bestOverall.length > 0 ? `Best opening duel performers:
${bestOverall.map((p: any) =>
  `- ${p.playerName}: ${(p.openingDuelWinRate * 100).toFixed(0)}% win rate (${p.openingKills}K/${p.openingDeaths}D in ${p.openingDuels} duels)`
).join('\n')}` : ''}
${bestAttack.length > 0 ? `
Attack side specialists:
${bestAttack.map((p: any) =>
  `- ${p.playerName}: ${(p.attackOpeningWinRate * 100).toFixed(0)}% on attack (${p.attackOpeningKills}K/${p.attackOpeningDeaths}D)`
).join('\n')}` : ''}
${worst.length > 0 ? `
Players struggling in opening duels:
${worst.map((p: any) =>
  `- ${p.playerName}: ${(p.openingDuelWinRate * 100).toFixed(0)}% win rate (${p.openingKills}K/${p.openingDeaths}D) - conversion: ${(p.openingKillConversion * 100).toFixed(0)}%`
).join('\n')}` : ''}
`
    }

    // Add multi-kill analysis if available
    if (evidence?.derived?.multiKillStats && evidence.derived.multiKillStats.length > 0) {
      // Filter to players with at least one multi-kill
      const playersWithMultiKills = evidence.derived.multiKillStats.filter((p: any) => p.totalMultiKills > 0)

      if (playersWithMultiKills.length > 0) {
        // Sort by impact score and take top 5
        const topMultiKillers = playersWithMultiKills
          .sort((a: any, b: any) => b.impactScore - a.impactScore)
          .slice(0, 5)

        evidenceSection += `
Multi-Kill Performance (High Impact Rounds):
${topMultiKillers.map((p: any) => {
  const breakdown: string[] = []
  if (p.aces > 0) breakdown.push(`${p.aces} ace${p.aces > 1 ? 's' : ''}`)
  if (p.fourKs > 0) breakdown.push(`${p.fourKs} 4k${p.fourKs > 1 ? 's' : ''}`)
  if (p.threeKs > 0) breakdown.push(`${p.threeKs} 3k${p.threeKs > 1 ? 's' : ''}`)
  if (p.twoKs > 0) breakdown.push(`${p.twoKs} 2k${p.twoKs > 1 ? 's' : ''}`)

  return `- ${p.playerName}: Impact ${p.impactScore} [${breakdown.join(', ')}]`
}).join('\n')}
`
      }
    }

    // Add agent compositions if available
    if (evidence.agentCompositions && Object.keys(evidence.agentCompositions).length > 0) {
      evidenceSection += `
Agent Compositions:
${evidence.games.map((game: any, idx: number) => {
  const composition = evidence.agentCompositions?.[game.gameId]
  if (!composition || composition.length === 0) return null

  // Group by team
  const teamGroups = composition.reduce((acc: any, pick: any) => {
    if (!acc[pick.teamId]) acc[pick.teamId] = []
    acc[pick.teamId].push(pick)
    return acc
  }, {})

  const teamLines = Object.entries(teamGroups).map(([teamId, picks]: [string, any]) => {
    const agents = picks.map((p: any) => p.agent).join(', ')
    return `  - Team ${teamId}: ${agents}`
  }).join('\n')

  return `Game ${idx + 1} (${game.mapName}):\n${teamLines}`
}).filter(Boolean).join('\n') || 'No data'}
`
    }

    // Sprint 1: Add weapon stats if available
    if (evidence?.derived?.weaponStats && evidence.derived.weaponStats.length > 0) {
      evidenceSection += `
Weapon Performance (Top 5 players):
${evidence.derived.weaponStats.slice(0, 5).map((p: any) => {
  const topWeapon = Object.entries(p.byWeapon || {})
    .sort((a: any, b: any) => b[1].kills - a[1].kills)[0]
  const topWeaponStr = topWeapon ? `${topWeapon[0]}: ${(topWeapon[1] as any).kills}` : 'N/A'
  return `- ${p.playerName}: ${p.totalKills} kills [Primary: ${topWeaponStr}]${p.operatorKills > 0 ? ` (${p.operatorKills} Op kills)` : ''}`
}).join('\n')}
`
    }

    // Sprint 1: Add engagement range stats if available
    if (evidence?.derived?.engagementStats && evidence.derived.engagementStats.length > 0) {
      evidenceSection += `
Engagement Range Analysis:
${evidence.derived.engagementStats.slice(0, 5).map((p: any) => {
  const ranges = Object.entries(p.byRange || {})
    .map(([range, stats]: [string, any]) => `${range}: ${stats.kills}K/${stats.deaths}D`)
    .join(', ')
  return `- ${p.playerName}: Preferred ${p.preferredRange} [${ranges}]`
}).join('\n')}
`
    }

    // Sprint 1: Add tempo stats if available
    if (evidence?.derived?.tempoStats && evidence.derived.tempoStats.length > 0) {
      evidenceSection += `
Round Tempo Analysis:
${evidence.derived.tempoStats.map((t: any) => {
  return `- ${t.teamName}:
  Attack: Avg plant at ${t.attackStats.avgTimeToPlant}s, ${(t.attackStats.latePlantRate * 100).toFixed(0)}% late plants
  Defense: Avg first kill at ${t.defenseStats.avgTimeToFirstKill}s, ${(t.defenseStats.earlyAggressionRate * 100).toFixed(0)}% early aggression`
}).join('\n')}
`
    }

    // Sprint 1: Add save round stats if available
    if (evidence?.derived?.saveRoundStats && evidence.derived.saveRoundStats.length > 0) {
      evidenceSection += `
Save Round Discipline:
${evidence.derived.saveRoundStats.map((s: any) =>
  `- ${s.teamName}: ${s.saveRounds} saves, ${s.exitFragsAttempted} exit frags, ${s.saveRoundWins} unexpected wins`
).join('\n')}
`
    }

    // Sprint 1: Add anti-eco stats if available
    if (evidence?.derived?.antiEcoStats && evidence.derived.antiEcoStats.length > 0) {
      evidenceSection += `
Anti-Eco Performance:
${evidence.derived.antiEcoStats.map((a: any) => {
  const problematic = a.problematicWeapons?.slice(0, 2).map((w: any) => w.weapon).join(', ') || 'none'
  return `- ${a.teamName}: ${(a.antiEcoWinRate * 100).toFixed(0)}% win rate (${a.antiEcoWins}/${a.antiEcoRounds}), ${a.deathsToEco} deaths to eco [Problem weapons: ${problematic}]`
}).join('\n')}
`
    }

    // Sprint 1: Add half stats if available
    if (evidence?.derived?.halfStats && evidence.derived.halfStats.length > 0) {
      evidenceSection += `
Half-by-Half Performance:
${evidence.derived.halfStats.map((h: any) =>
  `- ${h.teamName}: 1st half (${h.firstHalf.side}): ${h.firstHalf.roundsWon}-${h.firstHalf.roundsLost} (${(h.firstHalf.winRate * 100).toFixed(0)}%), 2nd half: ${h.secondHalf.roundsWon}-${h.secondHalf.roundsLost} (${(h.secondHalf.winRate * 100).toFixed(0)}%) [${h.adaptation.improved ? 'Improved' : 'Declined'}: ${h.adaptation.delta > 0 ? '+' : ''}${(h.adaptation.delta * 100).toFixed(0)}%]`
).join('\n')}
`
    }

    // Sprint 2: Add ability impact stats if available
    if (evidence?.derived?.abilityImpactStats && evidence.derived.abilityImpactStats.length > 0) {
      evidenceSection += `
Utility Impact (Flash Assists & Kill Setups):
${evidence.derived.abilityImpactStats
  .filter((p: any) => p.totalAbilityUses >= 5)
  .sort((a: any, b: any) => b.flashAssists + b.utilityKillSetups - (a.flashAssists + a.utilityKillSetups))
  .slice(0, 5)
  .map((p: any) => {
    const topAbility = Object.entries(p.abilityBreakdown || {})
      .sort((a: any, b: any) => b[1].correlatedKills - a[1].correlatedKills)[0]
    const topAbilityStr = topAbility ? `${topAbility[0]}: ${(topAbility[1] as any).correlatedKills} kills` : 'N/A'
    return `- ${p.playerName}: ${p.flashAssists} flash assists (${(p.flashAssistRate * 100).toFixed(0)}%), ${p.utilityKillSetups} utility setups [Best: ${topAbilityStr}]`
  }).join('\n')}
`
    }

    // Sprint 2: Add team utility coordination stats if available
    if (evidence?.derived?.teamUtilityStats && evidence.derived.teamUtilityStats.length > 0) {
      evidenceSection += `
Team Utility Coordination:
${evidence.derived.teamUtilityStats.map((t: any) =>
  `- ${t.teamName}: ${t.totalAbilityUses} abilities used, ${t.correlatedKills} kills after utility (${(t.utilityCoordinationScore * 100).toFixed(0)}% coordination score)${t.flashUses > 0 ? `, ${t.flashAssists}/${t.flashUses} flash assists` : ''}${t.topFlashPlayer ? ` [Top flash: ${t.topFlashPlayer}]` : ''}`
).join('\n')}
`
    }

    // Sprint 2: Add post-plant positioning stats if available
    if (evidence?.derived?.postPlantStats) {
      const postPlant = evidence.derived.postPlantStats as any

      if (postPlant.siteStats && postPlant.siteStats.length > 0) {
        evidenceSection += `
Post-Plant Site Analysis:
${postPlant.siteStats.map((s: any) =>
  `- ${s.site}: ${s.postPlantKills}K/${s.postPlantDeaths}D (${s.kdRatio.toFixed(2)} KD) in post-plant situations`
).join('\n')}
`
      }

      if (postPlant.playerStats && postPlant.playerStats.length > 0) {
        const topPostPlant = postPlant.playerStats
          .filter((p: any) => (p.postPlantKills + p.postPlantDeaths) >= 3)
          .sort((a: any, b: any) => b.postPlantKD - a.postPlantKD)
          .slice(0, 5)

        if (topPostPlant.length > 0) {
          evidenceSection += `
Post-Plant Player Performance:
${topPostPlant.map((p: any) =>
  `- ${p.playerName}: ${p.postPlantKills}K/${p.postPlantDeaths}D (${p.postPlantKD.toFixed(2)} KD) in post-plant`
).join('\n')}
`
        }
      }
    }

    // Sprint 2: Add matchup stats if available
    if (evidence?.derived?.matchupStats) {
      const matchups = evidence.derived.matchupStats as any

      if (matchups.playerSummary && matchups.playerSummary.length > 0) {
        // Find players with strong nemesis/victim relationships
        const playersWithNemesis = matchups.playerSummary
          .filter((p: any) => p.nemesis && Math.abs(p.nemesisDifferential) >= 2)
          .slice(0, 3)

        const playersWithVictim = matchups.playerSummary
          .filter((p: any) => p.victim && p.victimDifferential >= 2)
          .slice(0, 3)

        if (playersWithNemesis.length > 0 || playersWithVictim.length > 0) {
          evidenceSection += `
Player Matchup Analysis:
${playersWithNemesis.length > 0 ? `Vulnerable matchups (nemesis):
${playersWithNemesis.map((p: any) =>
  `- ${p.playerName} vs ${p.nemesis}: ${p.nemesisDifferential} differential (struggling)`
).join('\n')}` : ''}
${playersWithVictim.length > 0 ? `
Favorable matchups (victims):
${playersWithVictim.map((p: any) =>
  `- ${p.playerName} vs ${p.victim}: +${p.victimDifferential} differential (dominant)`
).join('\n')}` : ''}
`
        }
      }
    }

    // Sprint 2: Add map control stats if available
    if (evidence?.derived?.mapControlStats && evidence.derived.mapControlStats.length > 0) {
      evidenceSection += `
Map Control & Aggression:
${evidence.derived.mapControlStats.map((m: any) =>
  `- ${m.teamName}: ${m.aggressiveOpenings} aggressive openings (${(m.aggressiveOpeningWinRate * 100).toFixed(0)}% win rate), early kills ${m.earlyKills}K/${m.earlyDeaths}D (${m.earlyKillDifferential > 0 ? '+' : ''}${m.earlyKillDifferential})`
).join('\n')}
`
    }

    // Sprint 3: Add pistol stats if available
    if (evidence?.derived?.pistolStats && evidence.derived.pistolStats.length > 0) {
      evidenceSection += `
Pistol & Bonus Round Analysis:
${evidence.derived.pistolStats.map((p: any) => {
  const pr = p.pistolRounds || {}
  const bc = p.bonusConversion || {}
  const ab = p.antiBonus || {}
  const pistolWinPct = ((pr.winRate || 0) * 100).toFixed(0)
  const bonusConvPct = ((bc.bonusConversionRate || 0) * 100).toFixed(0)
  const attackPct = ((pr.attackPistolWinRate || 0) * 100).toFixed(0)
  const defensePct = ((pr.defensePistolWinRate || 0) * 100).toFixed(0)
  const topFragger = p.pistolTopFragger ? ` [Top: ${p.pistolTopFragger.playerName} - ${p.pistolTopFragger.pistolKills} kills]` : ''
  return `- ${p.teamName}: ${pr.won || 0}/${pr.played || 0} pistols won (${pistolWinPct}%), ${bonusConvPct}% bonus conversion [Attack: ${attackPct}%, Defense: ${defensePct}%]${topFragger}`
}).join('\n')}
`
    }

    // Sprint 3: Add man advantage stats if available
    if (evidence?.derived?.manAdvantageStats && evidence.derived.manAdvantageStats.length > 0) {
      evidenceSection += `
Man Advantage Conversion:
${evidence.derived.manAdvantageStats.map((m: any) => {
  const ts = m.throwStats || {}
  const cs = m.comebackStats || {}
  const throwPct = ((ts.throwRate || 0) * 100).toFixed(0)
  return `- ${m.teamName}: ${ts.totalThrows || 0} throws (${throwPct}% rate), ${cs.totalComebacks || 0} comebacks${ts.worstThrow ? ` [Worst: ${ts.worstThrow}]` : ''}${cs.bestComeback ? ` [Best comeback: ${cs.bestComeback}]` : ''}`
}).join('\n')}
`
    }

    // Sprint 3: Add retake stats if available
    if (evidence?.derived?.retakeStats && evidence.derived.retakeStats.length > 0) {
      evidenceSection += `
Retake Performance:
${evidence.derived.retakeStats.map((r: any) => {
  const winPct = ((r.retakeWinRate || 0) * 100).toFixed(0)
  const siteBreakdown = Object.entries(r.bySite || {})
    .map(([site, stats]: [string, any]) => `${site}: ${stats.successes}/${stats.attempts}`)
    .join(', ')
  const topDefuser = r.topDefuser ? ` [Top defuser: ${r.topDefuser.playerName} - ${r.topDefuser.clutchDefuses}]` : ''
  return `- ${r.teamName}: ${r.retakeSuccesses}/${r.totalRetakeAttempts} retakes won (${winPct}%) [${siteBreakdown}]${topDefuser}`
}).join('\n')}
`
    }

    // Sprint 3: Add entry stats if available
    if (evidence?.derived?.entryStats && evidence.derived.entryStats.length > 0) {
      const topEntryPlayers = evidence.derived.entryStats
        .filter((e: any) => e.entryAttempts >= 3)
        .sort((a: any, b: any) => (b.entrySuccessRate || 0) - (a.entrySuccessRate || 0))
        .slice(0, 5)

      if (topEntryPlayers.length > 0) {
        evidenceSection += `
Entry Fragger Performance:
${topEntryPlayers.map((e: any) => {
  const successPct = ((e.entrySuccessRate || 0) * 100).toFixed(0)
  const killPct = ((e.entryKillRate || 0) * 100).toFixed(0)
  const flashInfo = e.entriesWithFlash > 0 ? ` [Flash: ${((e.flashSupportedWinRate || 0) * 100).toFixed(0)}% vs Dry: ${((e.dryEntryWinRate || 0) * 100).toFixed(0)}%]` : ''
  return `- ${e.playerName}: ${e.entryKills}K/${e.entryDeaths}D (${killPct}% kill rate), trade rate ${((e.tradeRate || 0) * 100).toFixed(0)}%${flashInfo}`
}).join('\n')}
`
      }
    }

    // Sprint 3: Add spike carrier stats if available
    if (evidence?.derived?.spikeCarrierStats && evidence.derived.spikeCarrierStats.length > 0) {
      evidenceSection += `
Spike Carrier Analysis:
${evidence.derived.spikeCarrierStats.map((s: any) => {
  const plantPct = ((s.plantRate || 0) * 100).toFixed(0)
  const deathPct = ((s.carrierDeathRate || 0) * 100).toFixed(0)
  const topPlanters = Object.entries(s.byPlayer || {})
    .sort((a: any, b: any) => (b[1].successfulPlants || 0) - (a[1].successfulPlants || 0))
    .slice(0, 2)
    .map(([_, data]: [string, any]) => `${data.playerName}: ${data.successfulPlants}`)
    .join(', ')
  return `- ${s.teamName}: ${plantPct}% plant rate, ${s.carrierDeathsBeforePlant || 0} carrier deaths (${deathPct}%), ${s.spikeDrops || 0} spike drops [${topPlanters}]`
}).join('\n')}
`
    }

    // Sprint 4: Add streak & momentum stats if available
    if (evidence?.derived?.streakStats && evidence.derived.streakStats.length > 0) {
      evidenceSection += `
Momentum & Streak Analysis:
${evidence.derived.streakStats.map((m: any) => {
  const winStreaks = m.winStreaks || {}
  const lossStreaks = m.lossStreaks || {}
  const triggers = Object.entries(m.triggerDistribution || {})
    .sort((a: any, b: any) => b[1].count - a[1].count)
    .slice(0, 2)
    .map(([t, info]: [string, any]) => `${t}: ${info.count}`)
    .join(', ')
  return `- ${m.teamName}: ${winStreaks.count || 0} win streaks (max ${winStreaks.maxLength || 0}), ${lossStreaks.count || 0} loss streaks (max ${lossStreaks.maxLength || 0}). Momentum: ${m.momentumScore?.toFixed(1) || 0}, Resilience: ${m.resilienceScore?.toFixed(1) || 0}${triggers ? ` [Triggers: ${triggers}]` : ''}`
}).join('\n')}
`
    }

    // Sprint 4: Add critical rounds if available
    if (evidence?.derived?.criticalRounds && evidence.derived.criticalRounds.length > 0) {
      evidenceSection += `
Critical Rounds for VOD Review:
${evidence.derived.criticalRounds.map((c: any) => {
  const priority = c.byPriority || {}
  const categories = Object.entries(c.categoryBreakdown || {})
    .map(([cat, info]: [string, any]) => `${cat}: ${info.count}`)
    .join(', ')
  const topRounds = (c.topReviewRounds || []).slice(0, 3)
    .map((r: any) => `R${r.roundNumber}`)
    .join(', ')
  return `- Game: ${c.totalCriticalRounds} critical rounds [Critical: ${priority.critical || 0}, High: ${priority.high || 0}]. Categories: ${categories}. Top review: ${topRounds}. Est. ${c.reviewTimeEstimate || 0}min`
}).join('\n')}
`
    }

    // Sprint 4: Add execute pattern stats if available
    if (evidence?.derived?.executePatternStats && evidence.derived.executePatternStats.length > 0) {
      evidenceSection += `
Execute Pattern Analysis:
${evidence.derived.executePatternStats.map((e: any) => {
  const pref = e.preferredPatterns || {}
  const best = e.mostSuccessfulPatterns || {}
  const insights = (e.coachingInsights || [])
    .slice(0, 2)
    .map((i: any) => i.description)
    .join('; ')
  return `- ${e.teamName}: Preferred ${pref.site || 'N/A'} site (${pref.timing || 'N/A'} timing), ${pref.entryMethod || 'N/A'} entries. Best: ${best.site || 'N/A'} (${((best.siteWinRate || 0) * 100).toFixed(0)}%). Predictability: ${((e.predictabilityScore || 0) * 100).toFixed(0)}%${insights ? ` [${insights}]` : ''}`
}).join('\n')}
`
    }

    // Sprint 4: Add performance trend stats if available
    if (evidence?.derived?.performanceTrendStats && evidence.derived.performanceTrendStats.length > 0) {
      evidenceSection += `
Performance Trends:
${evidence.derived.performanceTrendStats.map((t: any) => {
  const profile = t.trendProfile || {}
  const fatigue = t.fatigueIndicators || {}
  const flags = (t.coachingFlags || [])
    .map((f: any) => f.flag)
    .join(', ')
  return `- ${t.teamName}: HS trend ${profile.headshotDirection || 'stable'}, ${profile.dominantPhases || 0} dominant phases, ${profile.strugglingPhases || 0} struggling. Late game: ${fatigue.lateGameDropoff ? 'DROPOFF' : 'stable'} (${fatigue.lateGameKdDiff || 0} KD)${flags ? ` [Flags: ${flags}]` : ''}`
}).join('\n')}
`
    }

    // Sprint 4: Add composition stats if available
    if (evidence?.derived?.compositionStats && evidence.derived.compositionStats.length > 0) {
      evidenceSection += `
Agent Composition Effectiveness:
${evidence.derived.compositionStats.map((c: any) => {
  const topComp = Object.entries(c.compositionFrequency || {})
    .sort((a: any, b: any) => b[1].count - a[1].count)[0]
  const topCompStr = topComp ? `${topComp[0]}: ${(topComp[1] as any).count}x (${((topComp[1] as any).winRate * 100).toFixed(0)}%)` : 'N/A'
  const topAgent = Object.entries(c.agentEffectiveness || {})
    .sort((a: any, b: any) => b[1].winRate - a[1].winRate)[0]
  const topAgentStr = topAgent ? `${topAgent[0]}: ${((topAgent[1] as any).winRate * 100).toFixed(0)}%` : 'N/A'
  return `- ${c.teamName}: ${c.uniqueCompositions} unique comps (flexibility: ${((c.flexibilityScore || 0) * 100).toFixed(0)}%). Most used: ${topCompStr}. Best agent: ${topAgentStr}`
}).join('\n')}
`
    }
  }

  // Add attack/defense stats if available
  if (analytics.roundStats) {
    evidenceSection += `
Attack/Defense Performance:
- Attack Win Rate: ${(analytics.roundStats.attackWinRate * 100).toFixed(1)}% (${analytics.roundStats.attackWins}/${analytics.roundStats.attackTotal} rounds)
- Defense Win Rate: ${(analytics.roundStats.defenseWinRate * 100).toFixed(1)}% (${analytics.roundStats.defenseWins}/${analytics.roundStats.defenseTotal} rounds)
`
  }

  // Add overall first blood conversion and post-plant win rate if available
  if (analytics.firstBloodConversion !== undefined || analytics.postPlantWinRate !== undefined) {
    evidenceSection += `
${analytics.teamName} Overall Performance:
${analytics.firstBloodConversion !== undefined ? `- First Blood Conversion: ${(analytics.firstBloodConversion * 100).toFixed(1)}%` : ''}
${analytics.postPlantWinRate !== undefined ? `- Post-Plant Win Rate: ${(analytics.postPlantWinRate * 100).toFixed(1)}%` : ''}
`
  }

  // Check if this is a map-filtered report
  const isMapFiltered = evidence?.meta?.filteredForGame
  const mapName = evidence?.meta?.mapName || map

  return `
You are an assistant coach for a professional Valorant team.

You are reviewing ${isMapFiltered ? `a single MAP (${mapName}) from a series` : 'a single match'} for ${teamName} against ${opponentName}.
${isMapFiltered ? `NOTE: All statistics below are filtered to ONLY this map. Use this for map-specific tactical analysis.` : ''}
Use the structured stats below to produce a concise and practical coaching report.

Match context:
- Event: ${eventName ?? 'Unknown event'}
- Date: ${date}
- Map: ${mapName}
- Final score: ${teamRoundsWon} - ${teamRoundsLost} over ${roundsPlayed} rounds

Player stat lines:
${playerLines}

Top performers (by KD):
${topPlayerLines}
${evidenceSection}
Guidelines:
- Assume you are talking to the coaching staff, not directly to the players.
- Focus on patterns, decision making and macro tendencies, not just raw aim.
- Do not invent stats that are not provided. If something is missing, ignore it.
- Make feedback specific and actionable.
- Use the EVIDENCE section to ground your insights in data about first bloods, plant situations, isolated deaths, site-specific performance, clutch situations, economy management, ability usage, multi-kill impact, and agent compositions.
- When agent compositions are provided, consider how team compositions might have influenced outcomes.
- When site stats are provided, identify which sites teams favor and their success rates on each.
- When clutch stats are provided, identify which players excel in high-pressure 1vX situations.
- When economy stats are provided, analyze buy decisions, force buy success rates, and economic discipline.
- When ability usage stats are provided, identify players who may be over/under-utilizing agent abilities.
- When multi-kill stats are provided, identify players who can turn rounds with high-kill performances. Aces and 4ks are especially impactful.
- Analyze trade patterns: players with low traded rates may be over-extending or taking isolated fights.
- High trade-getters indicate good team coordination and positioning.
- Analyze opening duel patterns: players with high opening kill rates on attack may be good entry fraggers.
- Compare attack vs defense opening performance to identify role fit.
- Low opening death survival indicates poor team support when entry player dies.
- When weapon stats are provided, identify if players are effective with their preferred weapons and if there are weapon choices mismatched to economic situations.
- Operator specialists with high opening kills indicate strong AWP presence. Low operator kills might suggest the role isn't being utilized.
- When engagement range stats are provided, identify if players are fighting at optimal distances for their roles. Entry fraggers should win close-range fights.
- When tempo stats are provided, analyze attack pacing. High late-plant rates with low win rates suggest execution timing issues.
- Fast executes with high success indicate well-drilled set plays. Slow tempo with losses may indicate indecision or poor mid-round calls.
- When save round stats are provided, evaluate discipline. Many exit frag attempts but low success suggests over-aggression on saves.
- When anti-eco stats are provided, identify if the team is losing rounds they should win. Deaths to specific weapons (e.g., Spectre) indicate positioning issues.
- When half stats are provided, compare adaptation between halves. Teams that improve in the second half show good mid-match adjustments.
- When utility impact stats are provided, identify players who create kill opportunities for teammates through flashes and other utility. High flash assist rates indicate strong team coordination.
- When team utility coordination stats are provided, compare teams' ability to convert utility usage into kills. Higher coordination scores indicate better-drilled executes.
- When post-plant stats are provided, analyze site-specific performance in post-plant scenarios. Negative KD on a site may indicate poor positioning or callouts.
- When player matchup stats are provided, identify nemesis relationships (players consistently losing to specific opponents) and favorable matchups (players dominating specific opponents). Use this for strategic player positioning.
- When map control stats are provided, evaluate early-round aggression success. Teams with high early kill differentials have strong map control. Low aggressive opening win rates suggest overcommitting.
- When pistol stats are provided, analyze pistol round economy and bonus conversion. High pistol win rate with low bonus conversion suggests inability to capitalize on economic advantage.
- Attack vs defense pistol win rates may indicate which side needs pistol strat improvements. Identify pistol kill leaders for potential designated pistol callers.
- When man advantage stats are provided, identify throw rates (losing with numbers advantage) and comeback rates. High throw rates indicate poor discipline or coordination under pressure.
- Teams with low advantage conversion but high comebacks may have mental resilience but tactical issues.
- When retake stats are provided, analyze site-specific retake success. Low retake rates on specific sites may indicate poor utility allocation or passive positioning.
- Identify top defusers for clutch situations and retake assignments.
- When entry stats are provided, compare entry fraggers' success rates and flash support impact. High flash-supported win rates vs low dry entry rates suggest team is over-relying on flash support.
- Entry players with high death rates but low trade rates indicate poor follow-up from teammates.
- When spike carrier stats are provided, analyze carrier death rates and plant success. High carrier death rate before plant suggests predictable spike pathing or poor support.
- When momentum stats are provided, analyze streak patterns. Teams with high resilience scores recover well from losses. Low momentum scores with many loss streaks indicate tilt susceptibility.
- Identify streak triggers (clutch wins, eco steals) and breakers (throws, economy resets) to understand psychological patterns.
- When critical round stats are provided, focus VOD review on low-winrate critical situations (match point, close score, clutches). These are highest-leverage improvement opportunities.
- When execute pattern stats are provided, analyze site preferences and timing. High predictability scores suggest teams are readable and need variation.
- Teams with low dry entry win rates but high flash-supported rates are over-reliant on utility. Teams with high early execute success should lean into fast plays.
- When performance trend stats are provided, identify fatigue indicators. Late game dropoffs suggest stamina issues or need for tactical adjustments post-round-18.
- Declining headshot trends mid-match indicate mechanical fatigue. Stable trends with struggling phases indicate tactical rather than mechanical issues.
- When composition stats are provided, analyze agent flexibility. Low flexibility with high win rates indicates a refined, optimized pool. Low flexibility with low win rates suggests inflexibility hurting adaptation.
- Compare map-specific compositions to identify where agent experimentation may be needed.

Output format (STRICTLY follow this markdown structure with ## headers):

## EVIDENCE
- List 3-5 key data points with specific numbers from the stats above
- Include player names and percentages where relevant (e.g., "Xeppaa achieved 64% opening duel win rate (7K/4D)")
- Focus on: first blood conversion, plant success, isolated deaths, clutch performance, economy, trades, opening duels, weapon performance, engagement range, tempo, save round discipline, anti-eco performance, half adaptation, utility impact, post-plant positioning, player matchups, map control, pistol rounds, man advantage conversion, retakes, entry fragging, spike carrier, momentum/streaks, critical rounds, execute patterns, performance trends, composition effectiveness

## INSIGHT
- 2-4 bullet points explaining what these patterns mean for team performance
- Connect evidence to tactical decisions, positioning issues, or coordination gaps
- Highlight both strengths to maintain and weaknesses to address

## RECOMMENDATION
- 3-5 specific, actionable practice items for the coaching staff to implement
- Reference the evidence (e.g., "Given the 25% eco round win rate, develop specific eco strats for each site")
- Prioritize by impact: what changes would most improve round win rate?

IMPORTANT: Use exactly "## EVIDENCE", "## INSIGHT", "## RECOMMENDATION" as section headers (two hashtags, not three).
  `.trim()
}

export async function generateCoachingReport(
  analytics: MatchAnalytics,
  evidence?: EvidenceV1 | null
): Promise<string> {
  const prompt = buildCoachPrompt(analytics, evidence)
  return callLLM(prompt)
}
