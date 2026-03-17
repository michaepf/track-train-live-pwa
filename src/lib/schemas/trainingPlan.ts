import { z } from 'zod'

export const TRAINING_PLAN_SCHEMA_VERSION = 1

export const TrainingPlanSchema = z.object({
  _v: z.number().default(TRAINING_PLAN_SCHEMA_VERSION),
  name: z.string().min(1).max(200),
  split: z.string().min(1).max(200),
  daysPerWeek: z.number().int().min(1).max(7),
  durationWeeks: z.number().int().min(1).max(52),
  focus: z.string().min(1).max(200),
  strategy: z.string().min(1).max(3000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  status: z.enum(['active', 'completed']).default('active'),
  pendingReview: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type TrainingPlan = z.infer<typeof TrainingPlanSchema>

/** Payload the AI returns in a propose_training_plan tool call — coerce numbers for model tolerance */
export const ProposeTrainingPlanPayloadSchema = z.object({
  name: z.string().min(1, 'Plan name cannot be empty').max(200),
  split: z.string().min(1, 'Split cannot be empty').max(200),
  daysPerWeek: z.coerce.number().int().min(1).max(7),
  durationWeeks: z.coerce.number().int().min(1, 'Duration must be at least 1 week').max(52),
  focus: z.string().min(1, 'Focus cannot be empty').max(200),
  strategy: z.string().min(1, 'Strategy cannot be empty').max(3000, 'Strategy too long (max 3000 chars)'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
})

export type ProposeTrainingPlanPayload = z.infer<typeof ProposeTrainingPlanPayloadSchema>

/** Migrate a raw record read from IndexedDB to the current TrainingPlan shape */
export function migrateTrainingPlan(raw: unknown): TrainingPlan {
  const record = raw as Record<string, unknown>
  if (!record._v) record._v = 1
  return TrainingPlanSchema.parse(record)
}
