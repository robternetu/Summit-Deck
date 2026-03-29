import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { connectToDB } from '../lib/db'
import { Match } from '../models/Match'
import { Team } from '../models/Team'
import { getSeriesForTeamAndTitle, GridSeriesSummary } from '../lib/grid/centralData'
import { fetchSeriesState } from '../lib/grid/seriesState'
import { listSeriesFiles } from '../lib/grid/fileDownload'
import mongoose from 'mongoose'
import { PRIMARY_TEAM_NAME } from '../lib/branding'

const VALORANT_TITLE_ID = process.env.GRID_TITLE_ID || '6'
const C9_TEAM_ID = process.env.GRID_TEAM_ID || '79'

async function main() {
  await connectToDB()
  console.log('Connected to MongoDB')

  // Find or create the featured team document to satisfy the required team ref
  let c9TeamDoc = await Team.findOne({ name: PRIMARY_TEAM_NAME })
  if (!c9TeamDoc) {
    c9TeamDoc = await Team.create({ name: PRIMARY_TEAM_NAME, region: 'NA' })
    console.log(`Created featured team document: ${c9TeamDoc._id}`)
  }

  console.log(`Fetching featured-team Valorant series (title=${VALORANT_TITLE_ID}, team=${C9_TEAM_ID})...`)

  const allC9Series: GridSeriesSummary[] = await getSeriesForTeamAndTitle(
    VALORANT_TITLE_ID,
    C9_TEAM_ID
  )

  console.log(`Found ${allC9Series.length} featured-team series from Central Data`)

  const filteredSeries = allC9Series

  let ingested = 0
  let skipped = 0
  let failed = 0

  for (const series of filteredSeries) {
    try {
      const existing = await Match.findOne({ gridSeriesId: series.id })
      if (existing) {
        skipped++
        continue
      }

      let state
      try {
        state = await fetchSeriesState(series.id)
      } catch (err) {
        console.warn(
          `Could not fetch series state for ${series.id}: ${err instanceof Error ? err.message : err}`
        )
        failed++
        continue
      }

      const c9Team = state.teams.find((t) => t.id === C9_TEAM_ID)
      const oppTeam = state.teams.find((t) => t.id !== C9_TEAM_ID)

      if (!c9Team || !oppTeam) {
        console.warn(
          `Could not identify C9/opponent teams for series ${series.id}, skipping.`
        )
        failed++
        continue
      }

      // Basic map info (first game)
      const firstGame = state.games[0]
      const mapName = firstGame?.mapName ?? 'Unknown'

      const teamRoundsWon = state.games.filter((g) =>
        g.teams.some((t) => t.id === C9_TEAM_ID && t.won)
      ).length
      const teamRoundsLost = state.games.length - teamRoundsWon

      // Aggregate player stats across games
      const playerMap = new Map<
        string,
        {
          playerId: string
          playerName: string
          kills: number
          deaths: number
          assists: number
        }
      >()

      for (const game of state.games) {
        const team = game.teams.find((t) => t.id === C9_TEAM_ID)
        if (!team) continue
        for (const p of team.players) {
          const key = p.id
          const existingPlayer = playerMap.get(key) ?? {
            playerId: p.id,
            playerName: p.name,
            kills: 0,
            deaths: 0,
            assists: 0, // Default to 0 - assists not available from GRID Series State API
          }
          existingPlayer.kills += p.kills
          existingPlayer.deaths += p.deaths
          // assists not available from GRID Series State API
          playerMap.set(key, existingPlayer)
        }
      }

      const players = Array.from(playerMap.values())

      // Optional: confirm that state-grid file exists
      let hasStateGrid = false
      try {
        const files = await listSeriesFiles(series.id)
        hasStateGrid = files.files.some((f) => f.id === 'state-grid')
      } catch {
        // File list not critical, continue without it
      }

      const doc = await Match.create({
        gridMatchId: series.id,
        gridSeriesId: series.id,
        team: c9TeamDoc._id,
        tournamentId: series.tournamentId,
        titleId: VALORANT_TITLE_ID,
        map: mapName,
        eventName: series.tournamentName,
        opponentName: oppTeam.name,
        date: series.startTimeScheduled
          ? new Date(series.startTimeScheduled)
          : new Date(),
        teamRoundsWon,
        teamRoundsLost,
        players,
        rawData: { hasStateGrid },
      })

      console.log(
        `Ingested: ${series.id} vs ${oppTeam.name} (${series.tournamentName}) -> ${doc._id}`
      )
      ingested++
    } catch (err) {
      console.error('Error ingesting series', series.id, ':', err)
      failed++
    }
  }

  console.log(`\nIngestion complete: ${ingested} ingested, ${skipped} skipped, ${failed} failed`)
  await mongoose.connection.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('Ingestion error:', err)
  process.exit(1)
})
