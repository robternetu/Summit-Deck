import { Schema, model, models } from 'mongoose'

const GeminiKeyUsageSchema = new Schema(
  {
    keyId: { type: String, required: true, unique: true },
    keyLabel: { type: String, required: true },
    minuteWindowStart: { type: Date, required: true },
    minuteCount: { type: Number, required: true, default: 0 },
    dayWindowStart: { type: Date, required: true },
    dayCount: { type: Number, required: true, default: 0 },
    totalCount: { type: Number, required: true, default: 0 },
    lastUsedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
)

const GeminiKeyRotationStateSchema = new Schema(
  {
    _id: { type: String, required: true },
    nextIndex: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
)

export type GeminiKeyUsageDocument = {
  keyId: string
  keyLabel: string
  minuteWindowStart: Date
  minuteCount: number
  dayWindowStart: Date
  dayCount: number
  totalCount: number
  lastUsedAt: Date
  createdAt: Date
  updatedAt: Date
}

export type GeminiKeyRotationStateDocument = {
  _id: string
  nextIndex: number
  createdAt: Date
  updatedAt: Date
}

export const GeminiKeyUsage =
  models.GeminiKeyUsage || model('GeminiKeyUsage', GeminiKeyUsageSchema)

export const GeminiKeyRotationState =
  models.GeminiKeyRotationState || model('GeminiKeyRotationState', GeminiKeyRotationStateSchema)
