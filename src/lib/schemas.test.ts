import { describe, it, expect } from 'vitest'
import {
  GoalsSchema,
  ProposeGoalsPayloadSchema,
  migrateGoals,
  WorkoutSchema,
  ProposeWorkoutPayloadSchema,
  ProposeWorkoutsPayloadSchema,
  isWorkoutCompleted,
  migrateWorkout,
  ConversationSchema,
  migrateConversation,
} from './schemas/index.ts'

// ─── Goals schemas ────────────────────────────────────────────────────────────

describe('GoalsSchema', () => {
  it('accepts valid goals', () => {
    const result = GoalsSchema.safeParse({
      text: 'Get stronger',
      updatedAt: '2026-02-21T10:00:00.000Z',
      pendingReview: false,
    })
    expect(result.success).toBe(true)
    expect(result.data?._v).toBe(1) // default applied
  })

  it('rejects empty text', () => {
    const result = GoalsSchema.safeParse({
      text: '',
      updatedAt: '2026-02-21T10:00:00.000Z',
      pendingReview: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects text over 2000 chars', () => {
    const result = GoalsSchema.safeParse({
      text: 'a'.repeat(2001),
      updatedAt: '2026-02-21T10:00:00.000Z',
      pendingReview: false,
    })
    expect(result.success).toBe(false)
  })
})

describe('ProposeGoalsPayloadSchema', () => {
  it('accepts valid payload', () => {
    expect(ProposeGoalsPayloadSchema.safeParse({ text: 'My goals' }).success).toBe(true)
  })

  it('rejects empty text', () => {
    expect(ProposeGoalsPayloadSchema.safeParse({ text: '' }).success).toBe(false)
  })

  it('rejects text over 2000 chars', () => {
    expect(
      ProposeGoalsPayloadSchema.safeParse({ text: 'x'.repeat(2001) }).success,
    ).toBe(false)
  })
})

describe('migrateGoals', () => {
  it('adds _v to records missing it (v0 → v1)', () => {
    const raw = {
      text: 'Old goals',
      updatedAt: '2026-02-21T10:00:00.000Z',
      pendingReview: false,
    }
    const migrated = migrateGoals(raw)
    expect(migrated._v).toBe(1)
    expect(migrated.text).toBe('Old goals')
  })
})

// ─── Workout schemas ──────────────────────────────────────────────────────────

const validWorkout = {
  date: '2026-02-21',
  workoutType: 'strength',
  entries: [
    { exerciseId: 'bench-press', sets: [{ plannedReps: 8, plannedWeight: 135 }] },
  ],
}

describe('WorkoutSchema', () => {
  it('accepts valid workout', () => {
    const result = WorkoutSchema.safeParse(validWorkout)
    expect(result.success).toBe(true)
    expect(result.data?._v).toBe(1)
    expect(result.data?.cardioMode).toBe('pick_one') // default applied
    expect(result.data?.feedback).toEqual([]) // default applied
  })

  it('rejects invalid date format', () => {
    const result = WorkoutSchema.safeParse({ ...validWorkout, date: '21-02-2026' })
    expect(result.success).toBe(false)
  })
})

describe('isWorkoutCompleted', () => {
  it('returns false when no sets have difficulty', () => {
    const workout = WorkoutSchema.parse(validWorkout)
    expect(isWorkoutCompleted(workout)).toBe(false)
  })

  it('returns true when any set has difficulty', () => {
    const workout = WorkoutSchema.parse({
      ...validWorkout,
      entries: [
        {
          exerciseId: 'bench-press',
          sets: [{ plannedReps: 8, difficulty: 'completed' }],
        },
      ],
    })
    expect(isWorkoutCompleted(workout)).toBe(true)
  })

  it('returns true when a cardio option has difficulty', () => {
    const workout = WorkoutSchema.parse({
      date: '2026-02-21',
      workoutType: 'cardio',
      cardioOptions: [{ label: 'Run', difficulty: 'completed' }],
    })
    expect(isWorkoutCompleted(workout)).toBe(true)
  })

  it('returns false for cardio with no difficulty recorded', () => {
    const workout = WorkoutSchema.parse({
      date: '2026-02-21',
      workoutType: 'cardio',
      cardioOptions: [{ label: 'Run' }],
    })
    expect(isWorkoutCompleted(workout)).toBe(false)
  })
})

describe('ProposeWorkoutPayloadSchema', () => {
  it('accepts workout with entries', () => {
    const result = ProposeWorkoutPayloadSchema.safeParse({
      date: '2026-02-21',
      workoutType: 'strength',
      entries: [{ exerciseId: 'squat', sets: [{ plannedReps: 5 }] }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts workout with cardioOptions only', () => {
    const result = ProposeWorkoutPayloadSchema.safeParse({
      date: '2026-02-21',
      workoutType: 'cardio',
      cardioOptions: [{ label: 'Run 20 min' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects workout with neither entries nor cardioOptions', () => {
    const result = ProposeWorkoutPayloadSchema.safeParse({
      date: '2026-02-21',
      workoutType: 'strength',
    })
    expect(result.success).toBe(false)
  })

  it('rejects workout with empty entries array', () => {
    const result = ProposeWorkoutPayloadSchema.safeParse({
      date: '2026-02-21',
      workoutType: 'strength',
      entries: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('ProposeWorkoutsPayloadSchema', () => {
  const oneWorkout = {
    date: '2026-02-21',
    workoutType: 'strength',
    entries: [{ exerciseId: 'squat', sets: [{ plannedReps: 5 }] }],
  }

  it('accepts array of 1', () => {
    expect(ProposeWorkoutsPayloadSchema.safeParse([oneWorkout]).success).toBe(true)
  })

  it('accepts array of 7', () => {
    const days = Array.from({ length: 7 }, (_, i) => ({
      ...oneWorkout,
      date: `2026-02-${String(i + 21).padStart(2, '0')}`,
    }))
    expect(ProposeWorkoutsPayloadSchema.safeParse(days).success).toBe(true)
  })

  it('rejects empty array', () => {
    expect(ProposeWorkoutsPayloadSchema.safeParse([]).success).toBe(false)
  })

  it('rejects array of 8', () => {
    const days = Array.from({ length: 8 }, (_, i) => ({
      ...oneWorkout,
      date: `2026-02-${String(i + 21).padStart(2, '0')}`,
    }))
    expect(ProposeWorkoutsPayloadSchema.safeParse(days).success).toBe(false)
  })
})

describe('migrateWorkout', () => {
  it('adds _v to records missing it (v0 → v1)', () => {
    const migrated = migrateWorkout({ date: '2026-02-21', workoutType: 'strength' })
    expect(migrated._v).toBe(1)
  })
})

// ─── Conversation schemas ─────────────────────────────────────────────────────

describe('ConversationSchema', () => {
  it('accepts valid conversation', () => {
    const result = ConversationSchema.safeParse({
      type: 'planning',
      createdAt: '2026-02-21T10:00:00.000Z',
      updatedAt: '2026-02-21T10:00:00.000Z',
    })
    expect(result.success).toBe(true)
    expect(result.data?._v).toBe(1)
    expect(result.data?.messages).toEqual([])
  })

  it('rejects invalid conversation type', () => {
    const result = ConversationSchema.safeParse({
      type: 'unknown',
      createdAt: '2026-02-21T10:00:00.000Z',
      updatedAt: '2026-02-21T10:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('migrateConversation', () => {
  it('adds _v to records missing it (v0 → v1)', () => {
    const migrated = migrateConversation({
      type: 'planning',
      messages: [],
      createdAt: '2026-02-21T10:00:00.000Z',
      updatedAt: '2026-02-21T10:00:00.000Z',
    })
    expect(migrated._v).toBe(1)
  })
})
