import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { _resetDB, deleteWorkout, getWorkoutById, saveWorkout } from './db.ts'
import { executeToolAction, type ToolExecutorContext } from './toolExecutors.ts'
import type { Exercise } from '../data/exercises.ts'
import type { Workout } from './schemas/index.ts'

const benchPress: Exercise = {
  id: 'bench-press',
  name: 'Bench Press',
  description: 'A horizontal press.',
  tags: ['chest'],
}

function executorContext(customExercises: Exercise[] = [benchPress]): ToolExecutorContext {
  return {
    customExercises,
    onExercisesChanged: vi.fn(),
  }
}

function workout(overrides: Partial<Workout> = {}): Workout {
  return {
    _v: 1,
    date: '2026-07-10',
    workoutType: 'strength',
    entries: [{
      exerciseId: 'bench-press',
      sets: [{ plannedReps: 8, plannedWeight: 135 }],
    }],
    cardioMode: 'pick_one',
    feedback: [],
    ...overrides,
  }
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  _resetDB()
})

describe('executeToolAction', () => {
  it('treats a duplicate exercise id as a successful no-op message', async () => {
    const ctx = executorContext()

    const result = await executeToolAction({
      kind: 'add_exercise',
      exercise: {
        id: 'bench-press',
        name: 'Different Display Name',
        description: '',
        tags: [],
      },
    }, ctx)

    expect(result).toMatchObject({
      status: 'no_change',
      operation: 'add_exercise',
      code: 'exercise_already_exists',
      stateChanged: false,
      recovery: 'none',
    })
    expect(ctx.onExercisesChanged).not.toHaveBeenCalled()
  })

  it('treats a case-insensitive duplicate exercise name as a successful no-op message', async () => {
    const ctx = executorContext()

    const result = await executeToolAction({
      kind: 'add_exercise',
      exercise: {
        id: 'barbell-bench',
        name: 'bench press',
        description: '',
        tags: [],
      },
    }, ctx)

    expect(result).toMatchObject({
      status: 'no_change',
      code: 'exercise_already_exists',
      userDetails: { kind: 'exercise', exerciseName: 'Bench Press' },
    })
    expect(ctx.onExercisesChanged).not.toHaveBeenCalled()
  })

  it('rejects edits to an explicitly completed workout', async () => {
    const saved = await saveWorkout(workout({ status: 'completed' }))

    const result = await executeToolAction({
      kind: 'edit_workout',
      workoutId: saved.id!,
      patches: {
        entries: [{
          entryIndex: 0,
          sets: [{ setIndex: 0, plannedReps: 10 }],
        }],
      },
    }, executorContext())

    expect(result).toMatchObject({
      status: 'failed',
      failureCode: 'workout_completed',
      stateChanged: false,
      recovery: 'permanent_conflict',
    })
    expect(await getWorkoutById(saved.id!)).toEqual(saved)
  })

  it('rejects edits to sets that already have difficulty logged', async () => {
    const saved = await saveWorkout(workout({
      entries: [{
        exerciseId: 'bench-press',
        sets: [{
          plannedReps: 8,
          plannedWeight: 135,
          difficulty: 'completed',
        }],
      }],
    }))

    const result = await executeToolAction({
      kind: 'edit_workout',
      workoutId: saved.id!,
      patches: {
        entries: [{
          entryIndex: 0,
          sets: [{ setIndex: 0, plannedReps: 10 }],
        }],
      },
    }, executorContext())

    expect(result).toMatchObject({
      status: 'failed',
      failureCode: 'set_completed',
      stateChanged: false,
      recovery: 'permanent_conflict',
    })
    expect(await getWorkoutById(saved.id!)).toEqual(saved)
  })

  it('reports a valid same-value edit as no change', async () => {
    const saved = await saveWorkout(workout())

    const result = await executeToolAction({
      kind: 'edit_workout',
      workoutId: saved.id!,
      patches: {
        entries: [{
          entryIndex: 0,
          sets: [{ setIndex: 0, plannedReps: 8, plannedWeight: 135 }],
        }],
      },
    }, executorContext())

    expect(result).toMatchObject({
      status: 'no_change',
      operation: 'edit_workout',
      code: 'workout_unchanged',
      stateChanged: false,
      userDetails: { kind: 'workout', changedSetCount: 0, changes: [] },
    })
    expect(await getWorkoutById(saved.id!)).toEqual(saved)
  })

  it('returns a verified structured success after persisting an edit', async () => {
    const saved = await saveWorkout(workout({
      feedback: [{
        source: 'user',
        note: 'Keep this field while editing sets.',
        timestamp: '2026-07-10T12:00:00.000Z',
      }],
    }))

    const result = await executeToolAction({
      kind: 'edit_workout',
      workoutId: saved.id!,
      patches: {
        entries: [{
          entryIndex: 0,
          sets: [{ setIndex: 0, plannedReps: 10 }],
        }],
      },
    }, executorContext())

    expect(result).toMatchObject({
      status: 'succeeded',
      operation: 'edit_workout',
      code: 'workout_edited',
      stateChanged: true,
      recovery: 'none',
      userDetails: { kind: 'workout', changedSetCount: 1 },
    })
    expect(await getWorkoutById(saved.id!)).toMatchObject({
      feedback: saved.feedback,
      entries: [{
        exerciseId: 'bench-press',
        sets: [{ plannedReps: 10, plannedWeight: 135 }],
      }],
    })
  })

  it('reports completed skips separately from genuine batch deletion failures', async () => {
    const deletedWorkout = await saveWorkout(workout({ date: '2026-07-11' }))
    const protectedWorkout = await saveWorkout(workout({
      date: '2026-07-12',
      entries: [{
        exerciseId: 'bench-press',
        sets: [{ plannedReps: 8, plannedWeight: 135, difficulty: 'completed' }],
      }],
    }))
    const failedWorkout = await saveWorkout(workout({ date: '2026-07-13' }))
    const ctx = executorContext()
    ctx.deleteWorkout = async (id) => {
      if (id === failedWorkout.id) throw new Error('Injected transaction failure')
      await deleteWorkout(id)
    }

    const result = await executeToolAction({
      kind: 'delete_future_workouts',
      fromDate: '2026-07-11',
      toDate: '2026-07-13',
    }, ctx)

    expect(result).toMatchObject({
      status: 'partially_succeeded',
      failureCode: 'workout_delete_failed',
      stateChanged: true,
      recovery: 'refresh_before_retry',
      userDetails: {
        kind: 'workout_batch',
        matchedCount: 3,
        affectedCount: 1,
        protectedCount: 1,
        failedCount: 1,
      },
    })
    expect(await getWorkoutById(deletedWorkout.id!)).toBeNull()
    expect(await getWorkoutById(protectedWorkout.id!)).not.toBeNull()
    expect(await getWorkoutById(failedWorkout.id!)).not.toBeNull()
  })
})
