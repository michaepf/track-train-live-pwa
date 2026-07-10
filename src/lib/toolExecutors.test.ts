import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { _resetDB, getWorkoutById, saveWorkout } from './db.ts'
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

    expect(result).toBe('Exercise with id "bench-press" already exists in the catalog.')
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

    expect(result).toBe(
      'An exercise called "Bench Press" already exists (id: bench-press). Use that id instead of adding a duplicate.',
    )
    expect(ctx.onExercisesChanged).not.toHaveBeenCalled()
  })

  it('rejects edits to an explicitly completed workout', async () => {
    const saved = await saveWorkout(workout({ status: 'completed' }))

    await expect(executeToolAction({
      kind: 'edit_workout',
      workoutId: saved.id!,
      patches: {
        entries: [{
          entryIndex: 0,
          sets: [{ setIndex: 0, plannedReps: 10 }],
        }],
      },
    }, executorContext())).rejects.toThrow(
      `Workout ${saved.id} is completed and cannot be edited`,
    )
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

    await expect(executeToolAction({
      kind: 'edit_workout',
      workoutId: saved.id!,
      patches: {
        entries: [{
          entryIndex: 0,
          sets: [{ setIndex: 0, plannedReps: 10 }],
        }],
      },
    }, executorContext())).rejects.toThrow(
      'Set 0 in entry 0 already has difficulty logged',
    )
  })

  it('reports a valid same-value edit as success with zero effective changes', async () => {
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

    expect(JSON.parse(result)).toEqual({
      ok: true,
      action: 'edit_workout',
      workoutId: saved.id,
      changedSetCount: 0,
      changedSets: [],
    })
    expect(await getWorkoutById(saved.id!)).toEqual(saved)
  })
})
