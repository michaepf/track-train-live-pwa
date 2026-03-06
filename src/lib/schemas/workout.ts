import { z } from 'zod'

export const WORKOUT_SCHEMA_VERSION = 1

const DifficultySchema = z.enum(['could_not_complete', 'completed', 'too_easy'])
const WorkoutStatusSchema = z.enum(['planned', 'completed'])

const SetSchema = z.object({
  // Reps-based or timed — one of these must be present (validated at the model layer, not enforced here)
  plannedReps: z.number().int().positive().optional(),
  targetSeconds: z.number().int().positive().optional(),
  plannedDuration: z.string().optional(), // legacy "30 sec" format from original app
  plannedWeight: z.number().nonnegative().optional(),
  rpeTarget: z.number().min(1).max(10).optional(),
  difficulty: DifficultySchema.optional(),
})

const EntrySchema = z.object({
  exerciseId: z.string().min(1),
  aiNotes: z.string().max(500).optional(),
  notes: z.string().max(1000).nullable().optional(),
  sets: z.array(SetSchema).min(1),
})

const CardioOptionSchema = z.object({
  label: z.string().min(1).max(200),
  target: z.string().max(200).optional(),
  aiNotes: z.string().max(500).optional(),
  notes: z.string().max(1000).nullable().optional(),
  difficulty: DifficultySchema.optional(),
  selected: z.boolean().optional(),
})

const ChecklistItemSchema = z.object({
  exercise: z.string().optional(),
  name: z.string().optional(),
  reps: z.string().optional(),
  duration: z.string().optional(),
  done: z.boolean().default(false),
})

const WarmupSchema = z.object({
  cardio: z.union([
    // Object format: single cardio descriptor
    z.object({
      type: z.string(),
      duration: z.string(),
      intensity: z.string().optional(),
      notes: z.string().optional(),
    }),
    // Array format: list of cardio options (legacy)
    z.array(ChecklistItemSchema),
  ]).optional(),
  cardioOptions: z.array(ChecklistItemSchema).optional(),
  mobility: z.array(ChecklistItemSchema).optional(),
})

const CooldownSchema = z.union([
  z.object({
    stretching: z.array(ChecklistItemSchema).optional(),
    notes: z.string().optional(),
  }),
  z.array(ChecklistItemSchema),
])

const FeedbackEntrySchema = z.object({
  timestamp: z.string().datetime(),
  note: z.string(),
  source: z.enum(['user', 'ai']),
})

export const WorkoutSchema = z.object({
  _v: z.number().default(WORKOUT_SCHEMA_VERSION),
  // id is assigned by IndexedDB auto-increment; absent before first save
  id: z.number().int().positive().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  timezone: z.string().optional(),
  generatedAt: z.string().optional(),
  workoutType: z.string().optional(),
  phase: z.number().int().positive().optional(),
  week: z.number().int().positive().optional(),
  session: z.string().optional(),
  status: WorkoutStatusSchema.optional(),
  completedAt: z.string().datetime().optional(),
  warmup: WarmupSchema.optional(),
  entries: z.array(EntrySchema).optional(),
  cardioOptions: z.array(CardioOptionSchema).optional(),
  cardioMode: z.enum(['pick_one', 'pick_many']).default('pick_one'),
  cooldown: CooldownSchema.optional(),
  feedback: z.array(FeedbackEntrySchema).default([]),
})

export type Workout = z.infer<typeof WorkoutSchema>
export type WorkoutEntry = z.infer<typeof EntrySchema>
export type WorkoutSet = z.infer<typeof SetSchema>
export type CardioOption = z.infer<typeof CardioOptionSchema>
export type Difficulty = z.infer<typeof DifficultySchema>
export type WorkoutStatus = z.infer<typeof WorkoutStatusSchema>

/** Derived display status — distinct from the persisted WorkoutStatus field. */
export type SessionStatus = 'not_started' | 'in_progress' | 'completed'

export function getWorkoutStatus(workout: Workout): SessionStatus {
  if (workout.status === 'completed') return 'completed'

  const entriesStarted = (workout.entries ?? []).some((e) =>
    e.sets.some((s) => s.difficulty !== undefined),
  )
  const cardioStarted = (workout.cardioOptions ?? []).some(
    (o) => o.difficulty !== undefined,
  )

  return entriesStarted || cardioStarted ? 'in_progress' : 'not_started'
}

/**
 * Returns true if a workout has any recorded difficulty values — i.e. the user
 * has started logging it. Completed workouts must never be overwritten.
 */
/**
 * Returns true if a workout has any logged progress — blocks deletion.
 * Equivalent to: status is 'in_progress' or 'completed'.
 */
export function isWorkoutCompleted(workout: Workout): boolean {
  return getWorkoutStatus(workout) !== 'not_started'
}

/**
 * What the AI returns in a propose_workout tool call — one workout in the array.
 * Stricter than WorkoutSchema:
 * - date is required and must come from the D0–D6 planning window (range validated at accept time)
 * - requires at least one of entries or cardioOptions
 */
export const ProposeWorkoutPayloadSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    workoutType: z.string().min(1).max(100),
    session: z.string().max(100).optional(),
    warmup: WarmupSchema.optional(),
    entries: z.array(EntrySchema).optional(),
    cardioOptions: z.array(CardioOptionSchema).optional(),
    cardioMode: z.enum(['pick_one', 'pick_many']).optional(),
    cooldown: CooldownSchema.optional(),
  })
  .refine(
    (data) =>
      (data.entries && data.entries.length > 0) ||
      (data.cardioOptions && data.cardioOptions.length > 0),
    { message: 'Workout must have at least one entry or cardio option' },
  )

export type ProposeWorkoutPayload = z.infer<typeof ProposeWorkoutPayloadSchema>

/** The full tool call payload — an array of one or more workouts */
export const ProposeWorkoutsPayloadSchema = z
  .array(ProposeWorkoutPayloadSchema)
  .min(1, 'Must propose at least one workout')
  .max(7, 'Cannot propose more than 7 workouts at once')

export type ProposeWorkoutsPayload = z.infer<typeof ProposeWorkoutsPayloadSchema>

/** Migrate a raw record read from IndexedDB to the current Workout shape */
export function migrateWorkout(raw: unknown): Workout {
  const record = raw as Record<string, unknown>
  // v0 → v1: no structural changes; just ensure _v is set
  if (!record._v) record._v = 1
  return WorkoutSchema.parse(record)
}
