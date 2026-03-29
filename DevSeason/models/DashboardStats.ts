import { Schema, model, models, Types } from 'mongoose'
import { DASHBOARD_STATS_ID } from '@/lib/branding'

// Series result structure for recent series display
const SeriesResultSchema = new Schema(
  {
    seriesId: { type: String, required: true },
    opponent: { type: String, required: true },
    c9MapsWon: { type: Number, required: true },
    opponentMapsWon: { type: Number, required: true },
    isWin: { type: Boolean, required: true },
    tournamentName: { type: String },
    matchDate: { type: String },
    games: [
      {
        mapName: { type: String, required: true },
        c9Rounds: { type: Number, required: true },
        opponentRounds: { type: Number, required: true },
      },
    ],
  },
  { _id: false }
)

// Opponent record for "struggling against" display
const OpponentRecordSchema = new Schema(
  {
    name: { type: String, required: true },
    seriesWins: { type: Number, required: true },
    seriesLosses: { type: Number, required: true },
    mapsWon: { type: Number, required: true },
    mapsLost: { type: Number, required: true },
  },
  { _id: false }
)

// Main dashboard stats schema
const DashboardStatsSchema = new Schema(
  {
    // Use a stable singleton id for the featured team snapshot
    _id: { type: String, required: true, default: DASHBOARD_STATS_ID },

    // Core statistics
    totalSeries: { type: Number, required: true },
    seriesWins: { type: Number, required: true },
    seriesLosses: { type: Number, required: true },

    // Map breakdown
    mapsPlayed: { type: Map, of: Number, required: true },

    // Side win rates
    attackWinRate: { type: Number, required: true },
    defenseWinRate: { type: Number, required: true },

    // Recent series (last 10)
    recentSeries: [SeriesResultSchema],

    // Struggling opponents (teams with more losses)
    strugglingAgainst: [OpponentRecordSchema],

    // Metadata
    lastUpdated: { type: Date, required: true },
    matchesProcessed: { type: Number, required: true },
  },
  { timestamps: true }
)

export type SeriesResult = {
  seriesId: string
  opponent: string
  c9MapsWon: number
  opponentMapsWon: number
  isWin: boolean
  tournamentName?: string
  matchDate?: string
  games: Array<{
    mapName: string
    c9Rounds: number
    opponentRounds: number
  }>
}

export type OpponentRecord = {
  name: string
  seriesWins: number
  seriesLosses: number
  mapsWon: number
  mapsLost: number
}

export type DashboardStatsDocument = {
  _id: string
  totalSeries: number
  seriesWins: number
  seriesLosses: number
  mapsPlayed: Map<string, number>
  attackWinRate: number
  defenseWinRate: number
  recentSeries: SeriesResult[]
  strugglingAgainst: OpponentRecord[]
  lastUpdated: Date
  matchesProcessed: number
  createdAt: Date
  updatedAt: Date
}

export const DashboardStats =
  models.DashboardStats || model('DashboardStats', DashboardStatsSchema)
