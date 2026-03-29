import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { getSeriesForTeamAndTitle } from '../lib/grid/centralData'

const VALORANT_TITLE_ID = process.env.GRID_TITLE_ID || '6'
const C9_TEAM_ID = process.env.GRID_TEAM_ID || '79'

async function main() {
  const tournamentIdsEnv = process.env.GRID_TOURNAMENT_IDS
  const tournamentIds = tournamentIdsEnv
    ? tournamentIdsEnv.split(',').map((id) => id.trim()).filter(Boolean)
    : []

  console.log(`Fetching featured-team Valorant series for title ${VALORANT_TITLE_ID}...`)
  if (tournamentIds.length > 0) {
    console.log(`Will filter to tournament IDs: ${tournamentIds.join(', ')}\n`)
  } else {
    console.log('No tournament filter specified, showing all featured-team series.\n')
  }

  try {
    const allC9Series = await getSeriesForTeamAndTitle(VALORANT_TITLE_ID, C9_TEAM_ID)
    console.log(`Fetched ${allC9Series.length} featured-team series for title ${VALORANT_TITLE_ID}\n`)

    const filteredByTournament =
      tournamentIds.length > 0
        ? allC9Series.filter((s) => tournamentIds.includes(s.tournamentId))
        : allC9Series

    console.log(`${filteredByTournament.length} series in allowed tournaments\n`)

    if (filteredByTournament.length === 0) {
      console.log('No featured-team series found.')
    } else {
      for (const series of filteredByTournament) {
        const scheduled = series.startTimeScheduled
          ? new Date(series.startTimeScheduled).toLocaleString()
          : 'TBD'
        const teamNames = series.teams.map((t) => t.name).join(' vs ')
        console.log(
          `Series ${series.id} - ${series.tournamentName} - ${teamNames} - ${scheduled}`
        )
      }
    }

    console.log('\nDone.')
    process.exit(0)
  } catch (err) {
    console.error('Error fetching series:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
