import { describe, expect, it, vi } from 'vitest'
import { runToolOperation, type ToolRetryCounts } from './toolRuntime.ts'
import type { PendingTool, ToolExecution } from './chatTools.ts'
import type { ToolOperationOutcome } from './toolOutcomes.ts'

const noRetries: ToolRetryCounts = { validation: 0, execution: 0 }

function call(name: string, args: unknown): PendingTool {
  return { id: 'call-1', name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }
}

function addExerciseCall(): PendingTool {
  return call('add_exercise', {
    id: 'split-squat',
    name: 'Split Squat',
    description: 'A unilateral leg exercise.',
    tags: ['legs'],
  })
}

function outcome(overrides: Partial<ToolOperationOutcome> = {}): ToolOperationOutcome {
  return {
    status: 'succeeded',
    operation: 'add_exercise',
    code: 'exercise_added',
    stateChanged: true,
    recovery: 'none',
    modelDetail: 'Added split-squat.',
    userDetails: { kind: 'exercise', exerciseName: 'Split Squat' },
    ...overrides,
  } as ToolOperationOutcome
}

describe('runToolOperation', () => {
  it('requests a bounded model retry for invalid arguments', async () => {
    const result = await runToolOperation({
      toolCall: call('edit_workout', { workoutId: 0, patches: {} }),
      customExerciseIds: new Set(),
      retries: noRetries,
      execute: vi.fn(),
    })

    expect(result.kind).toBe('retry_model')
    if (result.kind !== 'retry_model') return
    expect(result.reason).toBe('validation')
    expect(result.retries.validation).toBe(1)
    expect(result.toolResult).toContain('workoutId must be a positive integer')
    expect(result.activity).toEqual({ status: 'correcting', message: 'Correcting the workout request...' })
  })

  it('stops validation correction after two attempts with user-safe copy', async () => {
    const result = await runToolOperation({
      toolCall: call('edit_workout', { workoutId: 0, patches: {} }),
      customExerciseIds: new Set(),
      retries: { validation: 2, execution: 0 },
      execute: vi.fn(),
    })

    expect(result.kind).toBe('terminal_failure')
    if (result.kind !== 'terminal_failure') return
    expect(result.activity.status).toBe('failed')
    expect(result.activity.message).not.toContain('edit_workout')
    expect(result.recoveryAction).toBe('ask_trainer')
  })

  it('routes proposals to approval without executing them', async () => {
    const execute = vi.fn()
    const result = await runToolOperation({
      toolCall: call('propose_goals', { text: 'Build strength.' }),
      customExerciseIds: new Set(),
      retries: noRetries,
      execute,
    })

    expect(result.kind).toBe('awaiting_approval')
    expect(execute).not.toHaveBeenCalled()
    if (result.kind === 'awaiting_approval') expect(result.activity.status).toBe('awaiting_approval')
  })

  it('announces running state and returns verified success', async () => {
    const onActivity = vi.fn()
    const result = await runToolOperation({
      toolCall: addExerciseCall(),
      customExerciseIds: new Set(),
      retries: noRetries,
      execute: async (_execution: ToolExecution) => outcome(),
      onActivity,
    })

    expect(onActivity).toHaveBeenCalledWith({ status: 'running', message: 'Adding an exercise to your catalog...' })
    expect(result.kind).toBe('completed')
    if (result.kind === 'completed') {
      expect(result.activity).toEqual({ status: 'succeeded', message: 'Split Squat was added to your catalog.' })
      expect(JSON.parse(result.toolResult)).toMatchObject({ status: 'succeeded', stateChanged: true })
    }
  })

  it('returns model-correctable execution failures for another bounded attempt', async () => {
    const result = await runToolOperation({
      toolCall: addExerciseCall(),
      customExerciseIds: new Set(),
      retries: noRetries,
      execute: async () => outcome({
        status: 'failed',
        code: 'operation_failed',
        stateChanged: false,
        recovery: 'model_correction',
        failureCode: 'exercise_not_found',
        modelDetail: 'The requested exercise no longer exists.',
      }),
    })

    expect(result.kind).toBe('retry_model')
    if (result.kind === 'retry_model') {
      expect(result.reason).toBe('execution')
      expect(result.retries.execution).toBe(1)
      expect(result.activity.status).toBe('correcting')
    }
  })

  it('does not retry permanent conflicts', async () => {
    const result = await runToolOperation({
      toolCall: call('edit_workout', { workoutId: 1, patches: { entries: [] } }),
      customExerciseIds: new Set(),
      retries: noRetries,
      execute: async () => outcome({
        status: 'failed',
        operation: 'edit_workout',
        code: 'operation_failed',
        stateChanged: false,
        recovery: 'permanent_conflict',
        failureCode: 'workout_completed',
        modelDetail: 'Workout 1 is completed.',
        userDetails: { kind: 'workout' },
      }),
    })

    expect(result.kind).toBe('terminal_failure')
    if (result.kind === 'terminal_failure') {
      expect(result.activity).toMatchObject({
        status: 'failed',
        message: "Couldn't update the workout.",
      })
      expect(result.recoveryAction).toBeUndefined()
    }
  })

  it('reports partial batch results without exposing record ids', async () => {
    const result = await runToolOperation({
      toolCall: call('delete_future_workouts', { fromDate: '2026-07-11' }),
      customExerciseIds: new Set(),
      retries: noRetries,
      execute: async () => outcome({
        status: 'partially_succeeded',
        operation: 'delete_future_workouts',
        code: 'future_workouts_deleted_with_skips',
        stateChanged: true,
        recovery: 'permanent_conflict',
        failureCode: 'workout_protected',
        modelDetail: 'Deleted workout 12; skipped workout 13.',
        userDetails: {
          kind: 'workout_batch',
          matchedCount: 2,
          affectedCount: 1,
          protectedCount: 1,
          failedCount: 0,
        },
      }),
    })

    expect(result.kind).toBe('completed')
    if (result.kind === 'completed') {
      expect(result.activity.status).toBe('partially_succeeded')
      expect(result.activity.message).toBe('Removed 1 future workout.')
      expect(result.activity.detail).not.toMatch(/12|13/)
    }
  })
})
