const GRID_STATS_FEED_ENDPOINT = 'https://api-op.grid.gg/statistics-feed/graphql'

export interface TeamWinStat {
  value: boolean
  count: number
  percentage: number
  streak: { min: number; max: number; current: number }
}

export interface AggregateInt {
  sum: number
  min: number
  max: number
  avg: number
}

export interface TeamTournamentStats {
  series: {
    count: number
    kills: AggregateInt
    deaths: AggregateInt
    wins: TeamWinStat[]
  }
  game: {
    count: number
    kills: AggregateInt
    deaths: AggregateInt
    wins: TeamWinStat[]
  }
}

type GraphQLResponse<T> = {
  data?: T
  errors?: Array<{ message: string }>
}

async function gridStatsRequest<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const apiKey = process.env.GRID_API_KEY
  if (!apiKey) {
    throw new Error(
      'GRID_API_KEY is not set. Add it to .env.local to enable GRID Stats Feed access.'
    )
  }

  const response = await fetch(GRID_STATS_FEED_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(
      `GRID Stats Feed request failed: ${response.status} ${response.statusText} - ${bodyText}`
    )
  }

  const json = (await response.json()) as GraphQLResponse<T>

  if (json.errors && json.errors.length > 0) {
    throw new Error(`GRID Stats Feed GraphQL error: ${json.errors[0].message}`)
  }

  if (!json.data) {
    throw new Error('GRID Stats Feed response missing data field')
  }

  return json.data
}

const TEAM_STATS_QUERY = `
  query TeamStats($teamId: ID!, $tournamentIds: [ID!]) {
    teamStatistics(
      teamId: $teamId
      filter: { tournamentIds: { in: $tournamentIds } }
    ) {
      series {
        count
        kills { sum min max avg }
        deaths { sum min max avg }
        wins {
          value
          count
          percentage
          streak { min max current }
        }
      }
      game {
        count
        kills { sum min max avg }
        deaths { sum min max avg }
        wins {
          value
          count
          percentage
          streak { min max current }
        }
      }
    }
  }
`

export async function getTeamTournamentStats(
  teamId: string,
  tournamentIds: string[]
): Promise<{ teamStatistics: TeamTournamentStats }> {
  return gridStatsRequest<{ teamStatistics: TeamTournamentStats }>(
    TEAM_STATS_QUERY,
    { teamId, tournamentIds }
  )
}
