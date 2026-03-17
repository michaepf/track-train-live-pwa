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
import { isSetCompleted, isEntryInProgress } from './schemas/index.ts'
import { getToday } from './context.ts'
import { addDays } from './formatters.ts'
import type { ToolExecution } from './chatTools.ts'
import type { Exercise } from '../data/exercises.ts'

// ─── Context interface ──────────────────────────────────────────────────────

export interface ToolExecutorContext {
  customExercises: Exercise[]
  onExercisesChanged: (updated: Exercise[]) => void
}

// ─── Tool execution ─────────────────────────────────────────────────────────

export async function executeToolAction(
  exec: ToolExecution,
  ctx: ToolExecutorContext,
): Promise<string> {
  if (exec.kind === 'add_exercise') {
    if (ctx.customExercises.some((e) => e.id === exec.exercise.id)) {
      return `Exercise with id "${exec.exercise.id}" already exists in the catalog.`
    }
    const nameLower = exec.exercise.name.toLowerCase()
    const nameMatch = ctx.customExercises.find((e) => e.name.toLowerCase() === nameLower)
    if (nameMatch) {
      return `An exercise called "${nameMatch.name}" already exists (id: ${nameMatch.id}). Use that id instead of adding a duplicate.`
    }
    await saveCustomExercise(exec.exercise)
    const updated = await getCustomExercises()
    ctx.onExercisesChanged(updated)
    return `Added exercise "${exec.exercise.name}" (${exec.exercise.id}) to your catalog.`
  }

  if (exec.kind === 'remove_exercise') {
    await deleteCustomExercise(exec.id)
    const updated = await getCustomExercises()
    ctx.onExercisesChanged(updated)
    return `Removed exercise "${exec.id}" from your catalog.`
  }

  if (exec.kind === 'edit_workout') {
    const workout = await getWorkoutById(exec.workoutId)
    if (!workout) throw new Error(`Workout ${exec.workoutId} not found`)
    if (workout.status === 'completed') throw new Error(`Workout ${exec.workoutId} is completed and cannot be edited`)

    let updatedEntries = workout.entries ? [...workout.entries] : []
    const changedSets: Array<{
      entryIndex: number
      setIndex: number
      exerciseId: string
      changes: string[]
    }> = []
    for (const entryPatch of exec.patches.entries ?? []) {
      const entry = updatedEntries[entryPatch.entryIndex]
      if (!entry) throw new Error(`Entry index ${entryPatch.entryIndex} not found`)
      let updatedSets = [...entry.sets]
      for (const setPatch of entryPatch.sets ?? []) {
        const set = updatedSets[setPatch.setIndex]
        if (!set) throw new Error(`Set index ${setPatch.setIndex} not found in entry ${entryPatch.entryIndex}`)
        if (isSetCompleted(set)) throw new Error(`Set ${setPatch.setIndex} in entry ${entryPatch.entryIndex} already has difficulty logged`)
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

    const updated = {
      ...workout,
      entries: updatedEntries,
    }
    await saveWorkout(updated)
    return JSON.stringify({
      ok: true,
      action: 'edit_workout',
      workoutId: exec.workoutId,
      changedSetCount: changedSets.length,
      changedSets,
    })
  }

  if (exec.kind === 'swap_exercise') {
    const workout = await getWorkoutById(exec.workoutId)
    if (!workout) throw new Error(`Workout ${exec.workoutId} not found`)
    if (workout.status === 'completed') throw new Error(`Workout ${exec.workoutId} is completed and cannot be edited`)

    const entries = workout.entries ? [...workout.entries] : []
    const entry = entries[exec.entryIndex]
    if (!entry) throw new Error(`Entry index ${exec.entryIndex} not found`)
    if (isEntryInProgress(entry)) {
      throw new Error(`Entry ${exec.entryIndex} already has progress and cannot be swapped`)
    }
    const isKnownExercise = ctx.customExercises.some((e) => e.id === exec.toExerciseId)
    if (!isKnownExercise) {
      throw new Error(`Unknown exerciseId: ${exec.toExerciseId}`)
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
    await saveWorkout(updated)
    return JSON.stringify({
      ok: true,
      action: 'swap_exercise',
      workoutId: exec.workoutId,
      entryIndex: exec.entryIndex,
      fromExerciseId: entry.exerciseId,
      toExerciseId: exec.toExerciseId,
      fromName: oldName,
      toName: newName,
    })
  }

  const allWorkouts = await listWorkouts(10000)
  const today = getToday()

  if (exec.kind === 'delete_future_workouts') {
    const start = exec.fromDate ?? (exec.includeToday ? today : addDays(today, 1))
    const end = exec.toDate ?? '9999-12-31'

    let deleted = 0
    let skipped = 0
    for (const workout of allWorkouts) {
      if (workout.date < start || workout.date > end) continue
      if (!workout.id) continue
      try {
        await deleteWorkout(workout.id)
        deleted += 1
      } catch {
        skipped += 1
      }
    }

    return `Deleted ${deleted} future workout${deleted === 1 ? '' : 's'} (skipped ${skipped} completed).`
  }

  return 'No action.'
}

// ─── Followup prompt builders ───────────────────────────────────────────────

export function buildEditWorkoutFollowupPrompt(outcome: string): string {
  try {
    const parsed = JSON.parse(outcome) as {
      workoutId?: number
      changedSetCount?: number
      changedSets?: Array<{
        entryIndex: number
        setIndex: number
        exerciseId: string
        changes: string[]
      }>
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
    return (
      'edit_workout completed. Read the tool result carefully and give the user a concise, specific summary of what changed.'
    )
  }
}

export function buildSwapExerciseFollowupPrompt(outcome: string): string {
  try {
    const parsed = JSON.parse(outcome) as {
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
    return 'swap_exercise completed. Read the tool result and give a concise user-facing confirmation.'
  }
}
