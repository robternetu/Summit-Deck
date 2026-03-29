import { Schema, model, models, Types } from 'mongoose'
import type { EvidenceV1, EvidenceV1Meta } from '@/lib/types/evidence'

const PlayerStatsSchema = new Schema(
  {
    playerId: { type: String, required: true },
    playerName: { type: String, required: true },
    agent: { type: String, required: false },
    kills: { type: Number, required: true },
    deaths: { type: Number, required: true },
    assists: { type: Number, required: false, default: 0 },
    rating: { type: Number, required: false },
  },
  { _id: false }
)

const MatchSchema = new Schema(
  {
    // Existing fields
    gridMatchId: { type: String, required: true, unique: true },
    team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    opponentName: { type: String, required: true },
    map: { type: String, required: true },
    eventName: { type: String, required: true },
    date: { type: Date, required: true },
    rawData: { type: Schema.Types.Mixed, required: false, default: null },

    // GRID integration fields (all optional for backwards compatibility)
    gridSeriesId: { type: String, required: false },
    tournamentId: { type: String, required: false },
    titleId: { type: String, required: false },
    teamRoundsWon: { type: Number, required: false },
    teamRoundsLost: { type: Number, required: false },
    attackRoundsWon: { type: Number, required: false },
    defenseRoundsWon: { type: Number, required: false },
    players: { type: [PlayerStatsSchema], required: false, default: undefined },
    startTime: { type: Date, required: false }, // Real match start time from manifest

    // Analytics fields (optional, backward compatible)
    analytics: {
      type: {
        evidence_v1: { type: Schema.Types.Mixed, required: false },
        evidence_v1_meta: {
          type: {
            extractedAt: { type: String, required: false },
            version: { type: String, required: false },
            extractor: { type: String, required: false },
          },
          required: false,
        },
      },
      required: false,
      default: undefined,
    },
  },
  { timestamps: true }
)

// Index for dashboard query performance
MatchSchema.index(
  {
    'analytics.evidence_v1.derived.mapsStats': 1,
    'gridSeriesId': 1,
    '_id': -1
  },
  {
    sparse: true,
    name: 'dashboard_query_index'
  }
)

export type PlayerStats = {
  playerId: string
  playerName: string
  agent?: string
  kills: number
  deaths: number
  assists?: number
  rating?: number
}

// Re-export evidence types for convenience
export type { EvidenceV1, EvidenceV1Meta } from '@/lib/types/evidence'

export type MatchDocument = {
  _id: Types.ObjectId
  gridMatchId: string
  team: Types.ObjectId
  opponentName: string
  map: string
  eventName: string
  date: Date
  rawData?: unknown

  // GRID integration fields (optional)
  gridSeriesId?: string
  tournamentId?: string
  titleId?: string
  teamRoundsWon?: number
  teamRoundsLost?: number
  attackRoundsWon?: number
  defenseRoundsWon?: number
  players?: PlayerStats[]
  startTime?: Date // Real match start time from manifest

  // Analytics fields (optional)
  analytics?: {
    evidence_v1?: EvidenceV1
    evidence_v1_meta?: EvidenceV1Meta
  }

  createdAt: Date
  updatedAt: Date
}

export const Match = models.Match || model('Match', MatchSchema)
