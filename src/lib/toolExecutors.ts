/**
 * Tool execution logic extracted from Chat.tsx.
 * Pure async functions with no React dependencies.
 */

import { getExerciseName } from '../data/exercises.ts'
import {
  saveCustomExercise,
  getCustomExercises,
  deleteCustomExercise,
  getWorkoutById,
  saveWorkout,
  listWorkouts,
  deleteWorkout,
} from './db.ts'
import { isSetCompleted, isEntryInProgress, isWorkoutCompleted } from './schemas/index.ts'
import { getToday } from './context.ts'
import { addDays } from './formatters.ts'
import type { ToolExecution } from './chatTools.ts'
import type { Exercise } from '../data/exercises.ts'
import type {
  ToolFailureCode,
  ToolOperationCode,
  ToolOperationOutcome,
  ToolRecovery,
  ToolUserDetails,
} from './toolOutcomes.ts'

// ─── Context interface ──────────────────────────────────────────────────────

export interface ToolExecutorContext {
  customExercises: Exercise[]
  onExercisesChanged: (updated: Exercise[]) => void
  /** Deterministic seam for exercising batch partial failures without a live browser. */
  deleteWorkout?: (id: number) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failed(
  operation: ToolOperationCode,
  failureCode: ToolFailureCode,
  recovery: ToolRecovery,
  modelDetail: string,
  userDetails: ToolUserDetails,
  stateChanged: false | 'unknown' = false,
): ToolOperationOutcome {
  return {
    status: 'failed',
    operation,
    code: 'operation_failed',
    failureCode,
    stateChanged,
    recovery,
    modelDetail,
    userDetails,
  }
}

function fallbackUserDetails(exec: ToolExecution): ToolUserDetails {
  if (exec.kind === 'add_exercise') {
    return { kind: 'exercise', exerciseName: exec.exercise.name }
  }
  if (exec.kind === 'remove_exercise') return { kind: 'exercise' }
  if (exec.kind === 'delete_future_workouts') {
    return {
      kind: 'workout_batch',
      matchedCount: 0,
      affectedCount: 0,
      protectedCount: 0,
      failedCount: 0,
    }
  }
  return { kind: 'workout' }
}

// ─── Tool execution ─────────────────────────────────────────────────────────

export async function executeToolAction(
  exec: ToolExecution,
  ctx: ToolExecutorContext,
): Promise<ToolOperationOutcome> {
  try {
    return await executeToolActionInternal(exec, ctx)
  } catch (error: unknown) {
    return failed(
      exec.kind,
      'unknown',
      'unknown_state',
      `Unexpected ${exec.kind} failure: ${errorMessage(error)}`,
      fallbackUserDetails(exec),
      'unknown',
    )
  }
}

async function executeToolActionInternal(
  exec: ToolExecution,
  ctx: ToolExecutorContext,
): Promise<ToolOperationOutcome> {
  if (exec.kind === 'add_exercise') {
    if (ctx.customExercises.some((e) => e.id === exec.exercise.id)) {
      return {
        status: 'no_change', operation: exec.kind, code: 'exercise_already_exists',
        stateChanged: false, recovery: 'none',
        modelDetail: `Exercise with id "${exec.exercise.id}" already exists in the catalog.`,
        userDetails: { kind: 'exercise', exerciseName: exec.exercise.name },
      }
    }
    const nameLower = exec.exercise.name.toLowerCase()
    const nameMatch = ctx.customExercises.find((e) => e.name.toLowerCase() === nameLower)
    if (nameMatch) {
      return {
        status: 'no_change', operation: exec.kind, code: 'exercise_already_exists',
        stateChanged: false, recovery: 'none',
        modelDetail: `An exercise called "${nameMatch.name}" already exists (id: ${nameMatch.id}). Use that id instead of adding a duplicate.`,
        userDetails: { kind: 'exercise', exerciseName: nameMatch.name },
      }
    }
    try {
      await saveCustomExercise(exec.exercise)
    } catch (error: unknown) {
      return failed(exec.kind, 'storage_failure', 'unknown_state', `Could not save exercise ${exec.exercise.id}: ${errorMessage(error)}`, { kind: 'exercise', exerciseName: exec.exercise.name }, 'unknown')
    }
    try {
      const updated = await getCustomExercises()
      ctx.onExercisesChanged(updated)
    } catch (error: unknown) {
      return {
        status: 'partially_succeeded', operation: exec.kind, code: 'exercise_added',
        failureCode: 'catalog_refresh_failed', stateChanged: true, recovery: 'refresh_before_retry',
        modelDetail: `Exercise ${exec.exercise.id} was saved, but the catalog could not be refreshed: ${errorMessage(error)}`,
        userDetails: { kind: 'exercise', exerciseName: exec.exercise.name },
      }
    }
    return {
      status: 'succeeded', operation: exec.kind, code: 'exercise_added', stateChanged: true,
      recovery: 'none', modelDetail: `Added exercise "${exec.exercise.name}" (${exec.exercise.id}) to the catalog.`,
      userDetails: { kind: 'exercise', exerciseName: exec.exercise.name },
    }
  }

  if (exec.kind === 'remove_exercise') {
    const existing = ctx.customExercises.find((exercise) => exercise.id === exec.id)
    if (!existing) {
      return {
        status: 'no_change', operation: exec.kind, code: 'exercise_not_present', stateChanged: false,
        recovery: 'none', modelDetail: `Exercise ${exec.id} is not present in the catalog.`,
        userDetails: { kind: 'exercise' },
      }
    }
    try {
      await deleteCustomExercise(exec.id)
    } catch (error: unknown) {
      return failed(exec.kind, 'storage_failure', 'unknown_state', `Could not remove exercise ${exec.id}: ${errorMessage(error)}`, { kind: 'exercise', exerciseName: existing.name }, 'unknown')
    }
    try {
      const updated = await getCustomExercises()
      ctx.onExercisesChanged(updated)
    } catch (error: unknown) {
      return {
        status: 'partially_succeeded', operation: exec.kind, code: 'exercise_removed',
        failureCode: 'catalog_refresh_failed', stateChanged: true, recovery: 'refresh_before_retry',
        modelDetail: `Exercise ${exec.id} was removed, but the catalog could not be refreshed: ${errorMessage(error)}`,
        userDetails: { kind: 'exercise', exerciseName: existing.name },
      }
    }
    return {
      status: 'succeeded', operation: exec.kind, code: 'exercise_removed', stateChanged: true,
      recovery: 'none', modelDetail: `Removed exercise "${existing.name}" (${exec.id}) from the catalog.`,
      userDetails: { kind: 'exercise', exerciseName: existing.name },
    }
  }

  if (exec.kind === 'edit_workout') {
    let workout
    try {
      workout = await getWorkoutById(exec.workoutId)
    } catch (error: unknown) {
      return failed(exec.kind, 'storage_failure', 'retry_safe', `Could not read workout ${exec.workoutId}: ${errorMessage(error)}`, { kind: 'workout' })
    }
    if (!workout) return failed(exec.kind, 'workout_not_found', 'model_correction', `Workout ${exec.workoutId} not found`, { kind: 'workout' })
    if (workout.status === 'completed') return failed(exec.kind, 'workout_completed', 'permanent_conflict', `Workout ${exec.workoutId} is completed and cannot be edited`, { kind: 'workout' })

    let updatedEntries = workout.entries ? [...workout.entries] : []
    const changedSets: Array<{
      entryIndex: number
      setIndex: number
      exerciseId: string
      changes: string[]
    }> = []
    for (const entryPatch of exec.patches.entries ?? []) {
      const entry = updatedEntries[entryPatch.entryIndex]
      if (!entry) return failed(exec.kind, 'entry_not_found', 'model_correction', `Entry index ${entryPatch.entryIndex} not found in workout ${exec.workoutId}`, { kind: 'workout' })
      let updatedSets = [...entry.sets]
      for (const setPatch of entryPatch.sets ?? []) {
        const set = updatedSets[setPatch.setIndex]
        if (!set) return failed(exec.kind, 'set_not_found', 'model_correction', `Set index ${setPatch.setIndex} not found in entry ${entryPatch.entryIndex} of workout ${exec.workoutId}`, { kind: 'workout' })
        if (isSetCompleted(set)) return failed(exec.kind, 'set_completed', 'permanent_conflict', `Set ${setPatch.setIndex} in entry ${entryPatch.entryIndex} already has difficulty logged`, { kind: 'workout' })
        const nextSet = {
          ...set,
          ...(setPatch.plannedReps !== undefined ? { plannedReps: setPatch.plannedReps } : {}),
          ...(setPatch.plannedWeight !== undefined ? { plannedWeight: setPatch.plannedWeight } : {}),
          ...(setPatch.targetSeconds !== undefined ? { targetSeconds: setPatch.targetSeconds } : {}),
        }
        const changes: string[] = []
        if (setPatch.plannedReps !== undefined && set.plannedReps !== nextSet.plannedReps) {
          changes.push(`plannedReps ${set.plannedReps ?? 'unset'} -> ${nextSet.plannedReps ?? 'unset'}`)
        }
        if (setPatch.plannedWeight !== undefined && set.plannedWeight !== nextSet.plannedWeight) {
          changes.push(`plannedWeight ${set.plannedWeight ?? 'unset'} -> ${nextSet.plannedWeight ?? 'unset'}`)
        }
        if (setPatch.targetSeconds !== undefined && set.targetSeconds !== nextSet.targetSeconds) {
          changes.push(`targetSeconds ${set.targetSeconds ?? 'unset'} -> ${nextSet.targetSeconds ?? 'unset'}`)
        }
        if (changes.length > 0) {
          changedSets.push({
            entryIndex: entryPatch.entryIndex,
            setIndex: setPatch.setIndex,
            exerciseId: entry.exerciseId,
            changes,
          })
        }
        updatedSets = [
          ...updatedSets.slice(0, setPatch.setIndex),
          nextSet,
          ...updatedSets.slice(setPatch.setIndex + 1),
        ]
      }
      updatedEntries = [
        ...updatedEntries.slice(0, entryPatch.entryIndex),
        { ...entry, sets: updatedSets },
        ...updatedEntries.slice(entryPatch.entryIndex + 1),
      ]
    }

    if (changedSets.length === 0) {
      return {
        status: 'no_change', operation: exec.kind, code: 'workout_unchanged', stateChanged: false,
        recovery: 'none', modelDetail: `edit_workout completed for workout ${exec.workoutId}, but no set values changed.`,
        userDetails: { kind: 'workout', changedSetCount: 0, changes: [] },
      }
    }
    const updated = {
      ...workout,
      entries: updatedEntries,
    }
    try {
      await saveWorkout(updated)
    } catch (error: unknown) {
      return failed(exec.kind, 'storage_failure', 'unknown_state', `Could not save workout ${exec.workoutId}: ${errorMessage(error)}`, { kind: 'workout' }, 'unknown')
    }
    return {
      status: 'succeeded', operation: exec.kind, code: 'workout_edited', stateChanged: true,
      recovery: 'none',
      modelDetail: JSON.stringify({ action: exec.kind, workoutId: exec.workoutId, changedSetCount: changedSets.length, changedSets }),
      userDetails: {
        kind: 'workout', changedSetCount: changedSets.length,
        changes: changedSets.map((change) => ({ exerciseName: getExerciseName(change.exerciseId), changes: change.changes })),
      },
    }
  }

  if (exec.kind === 'swap_exercise') {
    let workout
    try { workout = await getWorkoutById(exec.workoutId) } catch (error: unknown) {
      return failed(exec.kind, 'storage_failure', 'retry_safe', `Could not read workout ${exec.workoutId}: ${errorMessage(error)}`, { kind: 'workout' })
    }
    if (!workout) return failed(exec.kind, 'workout_not_found', 'model_correction', `Workout ${exec.workoutId} not found`, { kind: 'workout' })
    if (workout.status === 'completed') return failed(exec.kind, 'workout_completed', 'permanent_conflict', `Workout ${exec.workoutId} is completed and cannot be edited`, { kind: 'workout' })

    const entries = workout.entries ? [...workout.entries] : []
    const entry = entries[exec.entryIndex]
    if (!entry) return failed(exec.kind, 'entry_not_found', 'model_correction', `Entry index ${exec.entryIndex} not found in workout ${exec.workoutId}`, { kind: 'workout' })
    if (isEntryInProgress(entry)) {
      return failed(exec.kind, 'entry_in_progress', 'permanent_conflict', `Entry ${exec.entryIndex} already has progress and cannot be swapped`, { kind: 'workout' })
    }
    const isKnownExercise = ctx.customExercises.some((e) => e.id === exec.toExerciseId)
    if (!isKnownExercise) {
      return failed(exec.kind, 'exercise_not_found', 'model_correction', `Unknown exerciseId: ${exec.toExerciseId}`, { kind: 'workout' })
    }

    const oldName = getExerciseName(entry.exerciseId)
    const newName = getExerciseName(exec.toExerciseId)
    entries[exec.entryIndex] = {
      ...entry,
      exerciseId: exec.toExerciseId,
      aiNotes: undefined,
    }
    const updated = {
      ...workout,
      entries,
      feedback: [
        ...(workout.feedback ?? []),
        {
          source: 'ai' as const,
          note: `Swapped ${oldName} -> ${newName}`,
          timestamp: new Date().toISOString(),
        },
      ],
    }
    try { await saveWorkout(updated) } catch (error: unknown) {
      return failed(exec.kind, 'storage_failure', 'unknown_state', `Could not save workout ${exec.workoutId}: ${errorMessage(error)}`, { kind: 'swap', fromName: oldName, toName: newName }, 'unknown')
    }
    return {
      status: 'succeeded', operation: exec.kind, code: 'exercise_swapped', stateChanged: true,
      recovery: 'none',
      modelDetail: JSON.stringify({ action: exec.kind, workoutId: exec.workoutId, entryIndex: exec.entryIndex, fromExerciseId: entry.exerciseId, toExerciseId: exec.toExerciseId, fromName: oldName, toName: newName }),
      userDetails: { kind: 'swap', fromName: oldName, toName: newName },
    }
  }

  let allWorkouts
  try { allWorkouts = await listWorkouts(10000) } catch (error: unknown) {
    return failed(exec.kind, 'storage_failure', 'retry_safe', `Could not list workouts: ${errorMessage(error)}`, { kind: 'workout_batch', matchedCount: 0, affectedCount: 0, protectedCount: 0, failedCount: 0 })
  }
  const today = getToday()

  if (exec.kind === 'delete_future_workouts') {
    const start = exec.fromDate ?? (exec.includeToday ? today : addDays(today, 1))
    const end = exec.toDate ?? '9999-12-31'

    let deleted = 0
    let protectedCount = 0
    const failures: string[] = []
    let matched = 0
    for (const workout of allWorkouts) {
      if (workout.date < start || workout.date > end) continue
      matched += 1
      if (!workout.id) { failures.push('Matched workout has no id'); continue }
      if (isWorkoutCompleted(workout)) { protectedCount += 1; continue }
      try {
        await (ctx.deleteWorkout ?? deleteWorkout)(workout.id)
        deleted += 1
      } catch (error: unknown) {
        failures.push(`Workout ${workout.id}: ${errorMessage(error)}`)
      }
    }
    const userDetails: ToolUserDetails = { kind: 'workout_batch', matchedCount: matched, affectedCount: deleted, protectedCount, failedCount: failures.length }
    const detail = `Deleted ${deleted}; skipped ${protectedCount} started or completed; ${failures.length} failed.${failures.length ? ` Failures: ${failures.join(' | ')}` : ''}`
    if (matched === 0) return { status: 'no_change', operation: exec.kind, code: 'no_matching_workouts', stateChanged: false, recovery: 'none', modelDetail: 'No workouts matched the requested date range.', userDetails }
    if (deleted === 0 && failures.length === 0) return { status: 'no_change', operation: exec.kind, code: 'future_workouts_deleted_with_skips', stateChanged: false, recovery: 'permanent_conflict', modelDetail: detail, userDetails }
    if (deleted === 0) return failed(exec.kind, 'workout_delete_failed', 'unknown_state', detail, userDetails, 'unknown')
    if (protectedCount > 0 || failures.length > 0) return {
      status: 'partially_succeeded', operation: exec.kind, code: 'future_workouts_deleted_with_skips', stateChanged: true,
      failureCode: failures.length > 0 ? 'workout_delete_failed' : 'workout_protected',
      recovery: failures.length > 0 ? 'refresh_before_retry' : 'permanent_conflict', modelDetail: detail, userDetails,
    }
    return { status: 'succeeded', operation: exec.kind, code: 'future_workouts_deleted', stateChanged: true, recovery: 'none', modelDetail: detail, userDetails }
  }

  const exhaustive: never = exec
  throw new Error(`Unsupported tool execution: ${String(exhaustive)}`)
}

// ─── Followup prompt builders ───────────────────────────────────────────────

export function buildEditWorkoutFollowupPrompt(outcome: ToolOperationOutcome): string {
  try {
    const parsed = JSON.parse(outcome.modelDetail) as {
      workoutId?: number
      changedSetCount?: number
      changedSets?: Array<{ entryIndex: number; setIndex: number; exerciseId: string; changes: string[] }>
    }
    const changes = parsed.changedSets ?? []
    if (changes.length === 0) {
      return (
        `edit_workout completed for workout ${parsed.workoutId ?? 'unknown'}, but there were no effective value changes. ` +
        'Tell the user no set values changed.'
      )
    }

    const lines = changes.map((c) => {
      const changeText = c.changes.join('; ')
      return `- E${c.entryIndex} S${c.setIndex + 1} (${c.exerciseId}): ${changeText}`
    })
    return [
      `edit_workout applied to workout ${parsed.workoutId ?? 'unknown'}.`,
      `Changed sets (${parsed.changedSetCount ?? changes.length}):`,
      ...lines,
      'Respond to the user with a concise natural-language confirmation that references these exact changes.',
    ].join('\n')
  } catch {
    return `edit_workout result: ${outcome.modelDetail}`
  }
}

export function buildSwapExerciseFollowupPrompt(outcome: ToolOperationOutcome): string {
  try {
    const parsed = JSON.parse(outcome.modelDetail) as {
      workoutId?: number
      entryIndex?: number
      fromName?: string
      toName?: string
      fromExerciseId?: string
      toExerciseId?: string
    }
    return [
      `swap_exercise applied to workout ${parsed.workoutId ?? 'unknown'}.`,
      `Entry E${parsed.entryIndex ?? '?'} changed from ${parsed.fromName ?? parsed.fromExerciseId ?? 'unknown'} to ${parsed.toName ?? parsed.toExerciseId ?? 'unknown'}.`,
      'Respond to the user with a concise natural-language confirmation of this change.',
    ].join('\n')
  } catch {
    return `swap_exercise result: ${outcome.modelDetail}`
  }
}

export function buildDeleteFutureWorkoutsFollowupPrompt(outcome: ToolOperationOutcome): string {
  return [
    `delete_future_workouts result: ${outcome.modelDetail}`,
    'If the user asked you to replace or change these workouts, immediately continue now by calling propose_workout with the replacement plan — do not stop and wait for the user to ask again.',
    'If the user only asked you to remove workouts with no replacement, just give a brief confirmation instead.',
  ].join('\n')
}
