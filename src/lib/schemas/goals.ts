import { z } from 'zod'

export const GOALS_SCHEMA_VERSION = 1

export const GoalsSchema = z.object({
  _v: z.number().default(GOALS_SCHEMA_VERSION),
  text: z.string().min(1).max(2000),
  updatedAt: z.string().datetime(),
  pendingReview: z.boolean().default(false),
})

export type Goals = z.infer<typeof GoalsSchema>

/** Payload the AI returns in a propose_goals tool call — subset of Goals */
export const ProposeGoalsPayloadSchema = z.object({
  text: z.string().min(1, 'Goals text cannot be empty').max(2000, 'Goals text too long (max 2000 chars)'),
})

export type ProposeGoalsPayload = z.infer<typeof ProposeGoalsPayloadSchema>

/** Migrate a raw record read from IndexedDB to the current Goals shape */
export function migrateGoals(raw: unknown): Goals {
  const record = raw as Record<string, unknown>
  // v0 → v1: no structural changes; just ensure _v is set
  if (!record._v) record._v = 1
  return GoalsSchema.parse(record)
}
