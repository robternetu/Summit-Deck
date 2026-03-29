import { Schema, model, models, type InferSchemaType } from 'mongoose'

const TeamSchema = new Schema(
  {
    name: { type: String, required: true },
    region: { type: String, required: true },
  },
  { timestamps: true }
)

export type TeamDocument = InferSchemaType<typeof TeamSchema> & { _id: any }

export const Team = models.Team || model('Team', TeamSchema)
