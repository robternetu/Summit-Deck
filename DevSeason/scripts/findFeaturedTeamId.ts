import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { listTeams } from '../lib/grid/centralData'

async function main() {
  const searchTerm = (process.env.GRID_TEAM_SEARCH || '').trim().toLowerCase()

  if (!searchTerm) {
    console.error('Set GRID_TEAM_SEARCH to the team name or keyword you want to scan for.')
    process.exit(1)
  }

  console.log(`Searching for teams matching "${searchTerm}" in GRID Central Data...\n`)

  let after: string | null = null
  let pageCount = 0
  let totalTeamsScanned = 0
  let foundCount = 0

  do {
    pageCount++
    const result = await listTeams(50, after)

    for (const team of result.teams) {
      totalTeamsScanned++
      if (team.name.toLowerCase().includes(searchTerm)) {
        foundCount++
        console.log(`Found candidate: id=${team.id}, name=${team.name}`)
      }
    }

    after = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null

    // Log progress every 10 pages
    if (pageCount % 10 === 0) {
      console.log(`... scanned ${totalTeamsScanned} teams so far (page ${pageCount})`)
    }
  } while (after !== null)

  console.log(`\nDone. Scanned ${totalTeamsScanned} teams across ${pageCount} pages.`)
  console.log(`Found ${foundCount} matching candidate(s).`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Error searching for teams:')
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
