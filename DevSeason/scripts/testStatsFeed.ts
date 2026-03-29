import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { getTeamTournamentStats } from '../lib/grid/statsFeed'

const TOURNAMENT_IDS = [
  '757371',
  '757481',
  '774782',
  '775516',
  '800675',
  '826660',
  '757614',
]

// TODO: Fill in the actual featured-team Valorant team ID from the GRID portal
const FEATURED_VAL_TEAM_ID = 'TODO_FILL_FROM_GRID_PORTAL'

async function main() {
  console.log('Fetching featured-team Valorant tournament stats from GRID Stats Feed...')
  console.log(`Team ID: ${FEATURED_VAL_TEAM_ID}`)
  console.log(`Tournament IDs: ${TOURNAMENT_IDS.join(', ')}`)
  console.log('')

  const result = await getTeamTournamentStats(FEATURED_VAL_TEAM_ID, TOURNAMENT_IDS)
  const stats = result.teamStatistics

  console.log('=== Team Tournament Stats Summary ===')
  console.log('')

  // Series stats
  console.log('--- Series Stats ---')
  console.log(`Total series: ${stats.series.count}`)
  console.log(`Avg kills per series: ${stats.series.kills.avg.toFixed(2)}`)
  console.log(`Avg deaths per series: ${stats.series.deaths.avg.toFixed(2)}`)
  if (stats.series.wins.length > 0) {
    const seriesWins = stats.series.wins.find((w) => w.value === true)
    if (seriesWins) {
      console.log(`Series win rate: ${seriesWins.percentage.toFixed(2)}%`)
      console.log(`Series wins: ${seriesWins.count}`)
    }
  }
  console.log('')

  // Game stats
  console.log('--- Game Stats ---')
  console.log(`Total games: ${stats.game.count}`)
  console.log(`Avg kills per game: ${stats.game.kills.avg.toFixed(2)}`)
  console.log(`Avg deaths per game: ${stats.game.deaths.avg.toFixed(2)}`)
  if (stats.game.wins.length > 0) {
    const gameWins = stats.game.wins.find((w) => w.value === true)
    if (gameWins) {
      console.log(`Game win rate: ${gameWins.percentage.toFixed(2)}%`)
      console.log(`Game wins: ${gameWins.count}`)
      console.log(
        `Win streak: current=${gameWins.streak.current}, max=${gameWins.streak.max}`
      )
    }
  }
}

main().catch((err) => {
  console.error('Error fetching stats:')
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
