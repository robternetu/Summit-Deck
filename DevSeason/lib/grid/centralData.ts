import { gridGraphQL } from './client'

const CENTRAL_DATA_URL =
  process.env.GRID_CENTRAL_DATA_URL ||
  'https://api-op.grid.gg/central-data/graphql'

export interface GridTeam {
  id: string
  name: string
  colorPrimary?: string | null
  colorSecondary?: string | null
  logoUrl?: string | null
}

export interface GridSeriesSummary {
  id: string
  tournamentId: string
  tournamentName: string
  startTimeScheduled: string | null
  teams: {
    id: string
    name: string
  }[]
}

export async function getSeriesForTeamAndTitle(
  titleId: string,
  teamId: string
): Promise<GridSeriesSummary[]> {
  const PAGE_SIZE = 25
  let after: string | null = null
  const nodes: any[] = []

  const query = /* GraphQL */ `
    query C9ValorantSeries($first: Int!, $after: Cursor) {
      allSeries(
        first: $first
        after: $after
        orderBy: StartTimeScheduled
        filter: {
          titleIds: { in: ["6"] }
          teamIds: { in: ["79"] }
        }
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            startTimeScheduled
            tournament {
              id
              name
            }
            teams {
              baseInfo {
                id
                name
              }
            }
          }
        }
      }
    }
  `

  type AllSeriesResponse = {
    allSeries: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      edges: Array<{ node: any }>
    }
  }

  for (let page = 0; page < 10; page++) {
    const res: AllSeriesResponse = await gridGraphQL<AllSeriesResponse>(
      CENTRAL_DATA_URL,
      query,
      {
        first: PAGE_SIZE,
        after,
      }
    )

    const pageInfo = res.allSeries.pageInfo
    const edges = res.allSeries.edges
    nodes.push(...edges.map((e: { node: any }) => e.node))

    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break
    after = pageInfo.endCursor
  }

  return nodes.map((node) => ({
    id: node.id,
    tournamentId: node.tournament?.id ?? '',
    tournamentName: node.tournament?.name ?? 'Unknown event',
    startTimeScheduled: node.startTimeScheduled ?? null,
    teams:
      node.teams?.map((t: any) => ({
        id: t.baseInfo?.id ?? '',
        name: t.baseInfo?.name ?? 'Unknown',
      })) ?? [],
  }))
}

const GET_TEAMS_QUERY = `
  query GetTeams($first: Int!, $after: Cursor) {
    teams(first: $first, after: $after) {
      totalCount
      pageInfo {
        hasPreviousPage
        hasNextPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          id
          name
          colorPrimary
          colorSecondary
          logoUrl
          externalLinks {
            dataProvider {
              name
            }
            externalEntity {
              id
            }
          }
        }
      }
    }
  }
`

type GetTeamsResponse = {
  teams: {
    totalCount: number
    pageInfo: {
      hasPreviousPage: boolean
      hasNextPage: boolean
      startCursor: string | null
      endCursor: string | null
    }
    edges: Array<{
      cursor: string
      node: {
        id: string
        name: string
        colorPrimary: string | null
        colorSecondary: string | null
        logoUrl: string | null
      }
    }>
  }
}

export async function listTeams(
  first: number,
  after?: string | null
): Promise<{
  teams: GridTeam[]
  pageInfo: {
    hasNextPage: boolean
    endCursor: string | null
  }
}> {
  const data = await gridGraphQL<GetTeamsResponse>(
    CENTRAL_DATA_URL,
    GET_TEAMS_QUERY,
    { first, after: after ?? null }
  )

  const teams: GridTeam[] = data.teams.edges.map((edge) => ({
    id: edge.node.id,
    name: edge.node.name,
    colorPrimary: edge.node.colorPrimary,
    colorSecondary: edge.node.colorSecondary,
    logoUrl: edge.node.logoUrl,
  }))

  return {
    teams,
    pageInfo: {
      hasNextPage: data.teams.pageInfo.hasNextPage,
      endCursor: data.teams.pageInfo.endCursor,
    },
  }
}
