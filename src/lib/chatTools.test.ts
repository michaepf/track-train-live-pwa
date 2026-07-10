import { describe, expect, it } from 'vitest'
import { getPlanningWindow } from './context.ts'
import { resolveToolCall, type PendingTool } from './chatTools.ts'

function toolCall(name: string, argumentsValue: unknown): PendingTool {
  return {
    id: 'call-1',
    name,
    arguments: typeof argumentsValue === 'string'
      ? argumentsValue
      : JSON.stringify(argumentsValue),
  }
}

describe('resolveToolCall', () => {
  it('routes valid proposal tools to review cards', () => {
    const result = resolveToolCall(toolCall('propose_goals', {
      text: 'Build strength while training consistently.',
    }))

    expect(result).toEqual({
      kind: 'card',
      cardState: {
        kind: 'goals',
        text: 'Build strength while training consistently.',
      },
    })
  })

  it('routes valid action tools to immediate execution', () => {
    const result = resolveToolCall(toolCall('add_exercise', {
      id: 'split-squat',
      name: 'Split Squat',
      description: 'A unilateral leg exercise.',
      tags: ['legs', 'dumbbells'],
    }))

    expect(result).toEqual({
      kind: 'execute',
      execution: {
        kind: 'add_exercise',
        exercise: {
          id: 'split-squat',
          name: 'Split Squat',
          description: 'A unilateral leg exercise.',
          tags: ['legs', 'dumbbells'],
        },
      },
    })
  })

  it('returns the existing parse error for malformed proposal JSON', () => {
    const result = resolveToolCall(toolCall('propose_goals', '{not-json'))

    expect(result).toEqual({
      kind: 'error',
      message: 'Failed to parse goals proposal',
      toolName: 'propose_goals',
    })
  })

  it('returns representative argument validation errors without executing', () => {
    expect(resolveToolCall(toolCall('add_exercise', {
      name: 'Missing ID',
      description: '',
      tags: [],
    }))).toEqual({
      kind: 'error',
      message: 'add_exercise: id is required',
      toolName: 'add_exercise',
    })

    expect(resolveToolCall(toolCall('edit_workout', {
      workoutId: 0,
      patches: {},
    }))).toEqual({
      kind: 'error',
      message: 'edit_workout: workoutId must be a positive integer',
      toolName: 'edit_workout',
    })

    expect(resolveToolCall(toolCall('delete_future_workouts', {
      fromDate: '2026-07-12',
      toDate: '2026-07-11',
    }))).toEqual({
      kind: 'error',
      message: 'fromDate must be <= toDate',
      toolName: 'delete_future_workouts',
    })
  })

  it('rejects workout proposals outside the planning window', () => {
    const result = resolveToolCall(toolCall('propose_workout', {
      workouts: [{
        date: '1999-01-01',
        workoutType: 'strength',
        entries: [{
          exerciseId: 'bench-press',
          sets: [{ plannedReps: 8 }],
        }],
      }],
    }), new Set(['bench-press']))

    expect(result).toEqual({
      kind: 'error',
      message: 'Workout dates must be in the D0-D6 planning window. Invalid date(s): 1999-01-01',
      toolName: 'propose_workout',
    })
  })

  it('rejects unknown exercise ids in otherwise valid workout proposals', () => {
    const today = getPlanningWindow()[0].date
    const result = resolveToolCall(toolCall('propose_workout', {
      workouts: [{
        date: today,
        workoutType: 'strength',
        entries: [{
          exerciseId: 'invented-press',
          sets: [{ plannedReps: 8 }],
        }],
      }],
    }), new Set(['bench-press']))

    expect(result).toEqual({
      kind: 'error',
      message: 'Unknown exerciseId(s): invented-press. Use only IDs from the Exercise Catalog in the system prompt.',
      toolName: 'propose_workout',
    })
  })

  it('returns an error result for an unknown tool so callers do not deadlock', () => {
    const result = resolveToolCall(toolCall('invented_tool', {}))

    expect(result).toEqual({
      kind: 'error',
      message: 'Unknown tool: invented_tool',
      toolName: 'invented_tool',
    })
  })
})
