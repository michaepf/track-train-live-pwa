import type { ToolExecution } from './chatTools.ts'

export type ToolOperationCode = ToolExecution['kind']
export type ToolOutcomeStatus = 'succeeded' | 'no_change' | 'partially_succeeded' | 'failed'
export type ToolStateChanged = boolean | 'unknown'
export type ToolRecovery =
  | 'none'
  | 'model_correction'
  | 'permanent_conflict'
  | 'retry_safe'
  | 'refresh_before_retry'
  | 'unknown_state'

export type ToolFailureCode =
  | 'workout_not_found'
  | 'workout_completed'
  | 'workout_protected'
  | 'entry_not_found'
  | 'set_not_found'
  | 'set_completed'
  | 'entry_in_progress'
  | 'exercise_not_found'
  | 'storage_failure'
  | 'catalog_refresh_failed'
  | 'workout_delete_failed'
  | 'unknown'

export type ToolOutcomeCode =
  | 'exercise_added'
  | 'exercise_already_exists'
  | 'exercise_removed'
  | 'exercise_not_present'
  | 'workout_edited'
  | 'workout_unchanged'
  | 'exercise_swapped'
  | 'future_workouts_deleted'
  | 'future_workouts_deleted_with_skips'
  | 'no_matching_workouts'
  | 'operation_failed'

export type ToolUserDetails =
  | { kind: 'exercise'; exerciseName?: string }
  | {
      kind: 'workout'
      changedSetCount?: number
      changes?: Array<{ exerciseName: string; changes: string[] }>
    }
  | { kind: 'swap'; fromName: string; toName: string }
  | {
      kind: 'workout_batch'
      matchedCount: number
      affectedCount: number
      protectedCount: number
      failedCount: number
    }

interface ToolOutcomeBase {
  operation: ToolOperationCode
  code: ToolOutcomeCode
  stateChanged: ToolStateChanged
  recovery: ToolRecovery
  modelDetail: string
  userDetails: ToolUserDetails
}

export type ToolOperationOutcome =
  | (ToolOutcomeBase & { status: 'succeeded'; stateChanged: true; recovery: 'none' })
  | (ToolOutcomeBase & { status: 'no_change'; stateChanged: false })
  | (ToolOutcomeBase & {
      status: 'partially_succeeded'
      stateChanged: true
      failureCode: ToolFailureCode
    })
  | (ToolOutcomeBase & {
      status: 'failed'
      code: 'operation_failed'
      failureCode: ToolFailureCode
    })

/** Model protocol payload. User-facing UI must use userDetails instead. */
export function serializeToolOutcomeForModel(outcome: ToolOperationOutcome): string {
  return JSON.stringify(outcome)
}
