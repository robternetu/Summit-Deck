import { gridGraphQL } from './client'

const SERIES_STATE_URL = 'https://api-op.grid.gg/live-data-feed/series-state/graphql'

export interface SeriesStatePlayer {
  id: string
  name: string
  kills: number
  deaths: number
}

export interface SeriesStateTeam {
  id: string
  name: string
  won: boolean
  players: SeriesStatePlayer[]
}

export interface SeriesStateGame {
  id: string
  mapName?: string | null
  teams: SeriesStateTeam[]
}

export interface SeriesState {
  id: string
  started: boolean
  finished: boolean
  teams: SeriesStateTeam[]
  games: SeriesStateGame[]
}

const SERIES_STATE_QUERY = `
  query SeriesState($seriesId: ID!) {
    seriesState(id: $seriesId) {
      id
      started
      finished
      teams {
        id
        name
        won
        players {
          id
          name
          kills
          deaths
        }
      }
      games {
        id
        map {
          name
        }
        teams {
          id
          name
          won
          players {
            id
            name
            kills
            deaths
          }
        }
      }
    }
  }
`

type SeriesStateResponse = {
  seriesState: {
    id: string
    started: boolean
    finished: boolean
    teams: Array<{
      id: string
      name: string
      won: boolean
      players: Array<{
        id: string
        name: string
        kills: number
        deaths: number
      }>
    }>
    games: Array<{
      id: string
      map?: {
        name: string
      } | null
      teams: Array<{
        id: string
        name: string
        won: boolean
        players: Array<{
          id: string
          name: string
          kills: number
          deaths: number
        }>
      }>
    }>
  }
}

export async function fetchSeriesState(seriesId: string): Promise<SeriesState> {
  const data = await gridGraphQL<SeriesStateResponse>(
    SERIES_STATE_URL,
    SERIES_STATE_QUERY,
    { seriesId }
  )

  const state = data.seriesState

  return {
    id: state.id,
    started: state.started,
    finished: state.finished,
    teams: state.teams.map((t) => ({
      id: t.id,
      name: t.name,
      won: t.won,
      players: t.players.map((p) => ({
        id: p.id,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
      })),
    })),
    games: state.games.map((g) => ({
      id: g.id,
      mapName: g.map?.name ?? null,
      teams: g.teams.map((t) => ({
        id: t.id,
        name: t.name,
        won: t.won,
        players: t.players.map((p) => ({
          id: p.id,
          name: p.name,
          kills: p.kills,
          deaths: p.deaths,
        })),
      })),
    })),
  }
}
