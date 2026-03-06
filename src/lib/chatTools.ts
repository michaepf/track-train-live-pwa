/**
 * chatTools.ts — Pure tool definitions, normalization, and resolution logic.
 * No React dependencies. Extracted from Chat.tsx for modularity.
 */

import { EXERCISE_MAP } from '../data/exercises.ts'
import type { Exercise } from '../data/exercises.ts'
import { ProposeGoalsPayloadSchema, ProposeWorkoutsPayloadSchema } from './schemas/index.ts'
import type { ProposeWorkoutsPayload } from './schemas/index.ts'
import { getPlanningWindow } from './context.ts'

// ─── Tool definitions ──────────────────────────────────────────────────────────

export const PROPOSE_GOALS_TOOL = {
  name: 'propose_goals',
  description:
    "Propose a concise goals summary for the user to review. Call this when you have gathered enough information to write a useful goals statement.",
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: "A clear, concise summary of the user's training goals (max 2000 characters).",
        maxLength: 2000,
      },
    },
    required: ['text'],
  },
}

export const PROPOSE_WORKOUT_TOOL = {
  name: 'propose_workout',
  description:
    'Propose one or more workouts for the D0-D6 planning window. Use one array item per planned day. Each entry exerciseId must be a valid ID from the Exercise Catalog in the system prompt.',
  parameters: {
    type: 'object',
    properties: {
      workouts: {
        type: 'array',
        minItems: 1,
        maxItems: 7,
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Workout date in YYYY-MM-DD format within D0-D6.' },
            workoutType: { type: 'string' },
            session: { type: 'string' },
            warmup: { type: 'object' },
            entries: { type: 'array', description: 'Array of { exerciseId: string, sets: [{ plannedReps?: number, plannedWeight?: number, targetSeconds?: number }] }. Include multiple set objects per exercise (typically 3).' },
            cardioOptions: { type: 'array' },
            cardioMode: { type: 'string', enum: ['pick_one', 'pick_many'] },
            cooldown: { type: ['array', 'object'] },
          },
          required: ['date', 'workoutType'],
        },
      },
    },
    required: ['workouts'],
  },
}

export const ADD_EXERCISE_TOOL = {
  name: 'add_exercise',
  description:
    'Add a new exercise to the user\'s custom exercise catalog. Use when the user asks to add an exercise not in the built-in list, or when you need an exercise that does not exist yet.',
  parameters: {
    type: 'object',
    properties: {
      id:          { type: 'string', description: 'kebab-case slug, e.g. "bulgarian-split-squat"' },
      name:        { type: 'string', description: 'Display name, e.g. "Bulgarian Split Squat"' },
      description: { type: 'string', description: 'Brief description of the exercise' },
      tags:        { type: 'array', items: { type: 'string' }, description: 'Category tags, e.g. ["legs","dumbbells"]' },
    },
    required: ['id', 'name', 'description', 'tags'],
  },
}

export const REMOVE_EXERCISE_TOOL = {
  name: 'remove_exercise',
  description:
    'Remove a custom exercise from the user\'s catalog. Cannot remove built-in exercises — those are permanent.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The exercise id to remove' },
    },
    required: ['id'],
  },
}

export const EDIT_WORKOUT_TOOL = {
  name: 'edit_workout',
  description:
    'Patch the planned values (reps, weight, duration) of sets in an existing workout. ' +
    'Cannot edit sets that already have difficulty logged, or workouts with status "completed". ' +
    'Do not change workout title/session/date via this tool. Use delete_future_workouts + propose_workout to replace an entire workout instead.',
  parameters: {
    type: 'object',
    properties: {
      workoutId: {
        type: 'integer',
        description: 'The numeric id of the workout to edit.',
      },
      patches: {
        type: 'object',
        description: 'Set-level planned value updates only.',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                entryIndex: { type: 'integer', description: 'Zero-based index into workout.entries.' },
                sets: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      setIndex: { type: 'integer', description: 'Zero-based index into entry.sets.' },
                      plannedReps: { type: 'integer' },
                      plannedWeight: { type: 'number' },
                      targetSeconds: { type: 'integer' },
                    },
                    required: ['setIndex'],
                  },
                },
              },
              required: ['entryIndex'],
            },
          },
        },
      },
    },
    required: ['workoutId', 'patches'],
  },
}

export const SWAP_EXERCISE_TOOL = {
  name: 'swap_exercise',
  description:
    'Swap one exercise in an existing workout entry. ' +
    'Only allowed when that entry has no sets with difficulty logged, and the workout status is not "completed".',
  parameters: {
    type: 'object',
    properties: {
      workoutId: {
        type: 'integer',
        description: 'The numeric id of the workout to edit.',
      },
      entryIndex: {
        type: 'integer',
        description: 'Zero-based index into workout.entries.',
      },
      toExerciseId: {
        type: 'string',
        description: 'Target exerciseId from the Exercise Catalog.',
      },
    },
    required: ['workoutId', 'entryIndex', 'toExerciseId'],
  },
}

export const DELETE_FUTURE_WORKOUTS_TOOL = {
  name: 'delete_future_workouts',
  description:
    'Delete uncompleted planned workouts in a future date range. Use when the user asks to clear or replace upcoming workouts.',
  parameters: {
    type: 'object',
    properties: {
      fromDate: { type: 'string', description: 'Optional inclusive start date YYYY-MM-DD.' },
      toDate: { type: 'string', description: 'Optional inclusive end date YYYY-MM-DD.' },
      includeToday: { type: 'boolean', description: 'If true, include D0 in deletion range.' },
    },
  },
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PendingTool = {
  id: string
  name: string
  arguments: string
}

export type ToolCardState =
  | { kind: 'goals'; text: string }
  | { kind: 'workouts'; workouts: ProposeWorkoutsPayload }
  | { kind: 'error'; toolName: string; message: string }

export type EditWorkoutSetPatch = {
  setIndex: number
  plannedReps?: number
  plannedWeight?: number
  targetSeconds?: number
}

export type EditWorkoutPatches = {
  entries?: Array<{
    entryIndex: number
    sets?: EditWorkoutSetPatch[]
  }>
}

export type ToolExecution =
  | {
      kind: 'delete_future_workouts'
      fromDate?: string
      toDate?: string
      includeToday?: boolean
    }
  | { kind: 'add_exercise'; exercise: Exercise }
  | { kind: 'remove_exercise'; id: string }
  | { kind: 'edit_workout'; workoutId: number; patches: EditWorkoutPatches }
  | { kind: 'swap_exercise'; workoutId: number; entryIndex: number; toExerciseId: string }

// ─── Utilities ─────────────────────────────────────────────────────────────────

export function looksLikeFakeToolNarration(text: string): boolean {
  const t = text.toLowerCase()
  return (
    t.includes('propose_goals') ||
    t.includes('propose_workout') ||
    t.includes('calling the tool') ||
    t.includes('call the tool') ||
    t.includes('function propose_goals') ||
    t.includes('function propose_workout')
  )
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

export function getToolSchemaHint(toolName: string): string {
  if (toolName === 'propose_workout') {
    return [
      'Strict schema reminder for propose_workout:',
      '- arguments must be JSON: {"workouts":[...]} (or equivalent array payload).',
      '- each workout must include: date (YYYY-MM-DD within D0-D6) and workoutType (string).',
      '- entries (if present) must be: [{ exerciseId: string, sets: [...] }] where exerciseId must exactly match a catalog ID from the system prompt.',
      '- cardioOptions (if present) must be: [{ label: string, target?: string }].',
      '- each workout must include at least one of entries or cardioOptions.',
    ].join('\n')
  }
  if (toolName === 'propose_goals') {
    return [
      'Strict schema reminder for propose_goals:',
      '- arguments must be JSON object with { "text": string }.',
      '- text must be non-empty and <= 2000 chars.',
    ].join('\n')
  }
  if (toolName === 'edit_workout') {
    return [
      'Strict schema reminder for edit_workout:',
      '- arguments must be JSON object: {"workoutId": number, "patches": {...}}.',
      '- workoutId must be a positive integer existing workout id.',
      '- patches only supports entries: [{ entryIndex, sets: [{ setIndex, plannedReps?, plannedWeight?, targetSeconds? }] }].',
      '- do not include date/session/workoutType changes.',
      '- only patch planned values for sets that are not yet completed (no difficulty logged).',
    ].join('\n')
  }
  if (toolName === 'swap_exercise') {
    return [
      'Strict schema reminder for swap_exercise:',
      '- arguments must be JSON object: {"workoutId": number, "entryIndex": number, "toExerciseId": string}.',
      '- workoutId must be a positive integer existing workout id.',
      '- entryIndex must be a valid zero-based index for workout.entries.',
      '- toExerciseId must match an exercise id from the Exercise Catalog.',
      '- do not call this for completed workouts or entries already in progress.',
    ].join('\n')
  }
  return `Strict schema reminder: emit a valid ${toolName} tool call with correctly typed JSON arguments.`
}

// ─── Normalization helpers (internal) ──────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function parseIntFromValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }
  if (typeof value === 'string') {
    const match = value.match(/\d+/)
    if (match) return Number(match[0])
  }
  return undefined
}

function slugifyExerciseId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildLooseSet(
  setLike: Record<string, unknown>,
  fallbackReps?: number,
): { plannedReps?: number; targetSeconds?: number; plannedDuration?: string; plannedWeight?: number; rpeTarget?: number } {
  const plannedReps = parseIntFromValue(setLike.plannedReps) ?? parseIntFromValue(setLike.reps) ?? fallbackReps
  const targetSeconds = parseIntFromValue(setLike.targetSeconds) ?? parseIntFromValue(setLike.seconds)
  const plannedDuration = asString(setLike.plannedDuration) ?? asString(setLike.duration)
  const plannedWeight = parseIntFromValue(setLike.plannedWeight) ?? parseIntFromValue(setLike.load)
  const rpeTarget = parseIntFromValue(setLike.rpeTarget)

  const normalized = {
    ...(plannedReps ? { plannedReps } : {}),
    ...(targetSeconds ? { targetSeconds } : {}),
    ...(plannedDuration ? { plannedDuration } : {}),
    ...(plannedWeight ? { plannedWeight } : {}),
    ...(rpeTarget ? { rpeTarget } : {}),
  }

  return Object.keys(normalized).length > 0 ? normalized : { plannedReps: fallbackReps ?? 8 }
}

function normalizeWorkoutEntries(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined

  const normalized = value
    .map((entryRaw) => {
      if (typeof entryRaw === 'string') {
        const exerciseId = slugifyExerciseId(entryRaw)
        if (!exerciseId) return null
        return { exerciseId, sets: [{ plannedReps: 8 }] }
      }

      const entry = asRecord(entryRaw)
      if (!entry) return null

      const exerciseName = asString(entry.exerciseId) ?? asString(entry.exercise) ?? asString(entry.name)
      if (!exerciseName) return null

      const exerciseId = slugifyExerciseId(exerciseName)
      if (!exerciseId) return null

      const fallbackReps = parseIntFromValue(entry.reps)
      let sets: unknown[] = []
      if (Array.isArray(entry.sets)) {
        sets = entry.sets
          .map((setRaw) => {
            const setObj = asRecord(setRaw)
            return setObj ? buildLooseSet(setObj, fallbackReps) : null
          })
          .filter((setValue): setValue is Record<string, unknown> => !!setValue)
      } else if (typeof entry.sets === 'number' && entry.sets > 0) {
        const setCount = Math.min(Math.round(entry.sets), 8)
        sets = Array.from({ length: setCount }, () => buildLooseSet(entry, fallbackReps))
      } else {
        sets = [buildLooseSet(entry, fallbackReps)]
      }

      const noteParts = [asString(entry.load), asString(entry.notes), asString(entry.description)].filter(
        (x): x is string => !!x,
      )

      return {
        exerciseId,
        sets,
        ...(noteParts.length > 0 ? { aiNotes: noteParts.join(' | ').slice(0, 500) } : {}),
      }
    })
    .filter(Boolean)

  return normalized.length > 0 ? normalized : undefined
}

function normalizeCardioOptions(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined

  const normalized = value
    .map((optionRaw) => {
      if (typeof optionRaw === 'string') {
        const label = optionRaw.trim()
        return label ? { label } : null
      }

      const option = asRecord(optionRaw)
      if (!option) return null
      const label = asString(option.label) ?? asString(option.name) ?? asString(option.exercise)
      if (!label) return null

      return {
        label,
        ...(asString(option.target) ? { target: asString(option.target) } : {}),
        ...(asString(option.notes) ? { aiNotes: asString(option.notes)?.slice(0, 500) } : {}),
      }
    })
    .filter(Boolean)

  return normalized.length > 0 ? normalized : undefined
}

function normalizeWorkoutPayloads(candidate: unknown): unknown {
  if (!Array.isArray(candidate)) return candidate

  return candidate.map((workoutRaw) => {
    const workout = asRecord(workoutRaw)
    if (!workout) return workoutRaw

    const entries = normalizeWorkoutEntries(workout.entries)
    const cardioOptions = normalizeCardioOptions(workout.cardioOptions)
    const workoutType = asString(workout.workoutType) ?? 'general'
    const session = asString(workout.session)
    const date = asString(workout.date)
    const cardioMode = asString(workout.cardioMode)

    return {
      ...(date ? { date } : {}),
      workoutType,
      ...(session ? { session } : {}),
      ...(entries ? { entries } : {}),
      ...(cardioOptions ? { cardioOptions } : {}),
      ...(cardioMode === 'pick_one' || cardioMode === 'pick_many'
        ? { cardioMode }
        : {}),
    }
  })
}

function summarizeSchemaIssues(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  const snippets = error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'payload'
    return `${path}: ${issue.message}`
  })
  if (snippets.length === 0) return 'Invalid workout proposal'
  return `Invalid workout proposal. ${snippets.join(' | ')}`
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function validateWorkoutDatesInPlanningWindow(
  workouts: ProposeWorkoutsPayload,
): string | null {
  const allowedDates = new Set(getPlanningWindow().map((d) => d.date))
  const invalidDates = workouts
    .map((w) => w.date)
    .filter((date) => !allowedDates.has(date))

  if (invalidDates.length === 0) return null
  const unique = [...new Set(invalidDates)]
  return `Workout dates must be in the D0-D6 planning window. Invalid date(s): ${unique.join(', ')}`
}

function validateExerciseIds(workouts: ProposeWorkoutsPayload, customIds: Set<string>): string | null {
  const unknown: string[] = []
  for (const workout of workouts) {
    for (const entry of workout.entries ?? []) {
      if (!(entry.exerciseId in EXERCISE_MAP) && !customIds.has(entry.exerciseId)) {
        unknown.push(entry.exerciseId)
      }
    }
  }
  if (unknown.length === 0) return null
  const unique = [...new Set(unknown)]
  return `Unknown exerciseId(s): ${unique.join(', ')}. Use only IDs from the Exercise Catalog in the system prompt.`
}

// ─── Tool call resolution ──────────────────────────────────────────────────────

/**
 * Validates and categorizes an incoming tool call from the model.
 * Returns either a "card" (needs user interaction), an "execute"
 * (run immediately), or an "error" (auto-resolved tool result).
 *
 * Synchronous so onDone can build the final message array in one pass
 * before calling persistConv once.
 */
export function resolveToolCall(tc: PendingTool, customExerciseIds: Set<string> = new Set()):
  | { kind: 'card'; cardState: ToolCardState }
  | { kind: 'execute'; execution: ToolExecution }
  | { kind: 'error'; message: string; toolName: string } {
  if (tc.name === 'propose_goals') {
    try {
      const raw = JSON.parse(tc.arguments)
      const result = ProposeGoalsPayloadSchema.safeParse(raw)
      if (result.success) {
        return { kind: 'card', cardState: { kind: 'goals', text: result.data.text } }
      }
      const msg = result.error.issues[0]?.message ?? 'Invalid goals proposal'
      return { kind: 'error', message: msg, toolName: tc.name }
    } catch {
      return { kind: 'error', message: 'Failed to parse goals proposal', toolName: tc.name }
    }
  }
  if (tc.name === 'propose_workout') {
    try {
      const raw = JSON.parse(tc.arguments) as unknown
      const candidate =
        Array.isArray(raw) || raw === null
          ? raw
          : (raw as { workouts?: unknown }).workouts
      const strictResult = ProposeWorkoutsPayloadSchema.safeParse(candidate)

      const result = strictResult.success
        ? strictResult
        : ProposeWorkoutsPayloadSchema.safeParse(normalizeWorkoutPayloads(candidate))

      if (!result.success) {
        return {
          kind: 'error',
          message: summarizeSchemaIssues(result.error),
          toolName: tc.name,
        }
      }

      const dateIssue = validateWorkoutDatesInPlanningWindow(result.data)
      if (dateIssue) {
        return { kind: 'error', message: dateIssue, toolName: tc.name }
      }

      const exerciseIssue = validateExerciseIds(result.data, customExerciseIds)
      if (exerciseIssue) {
        return { kind: 'error', message: exerciseIssue, toolName: tc.name }
      }

      return { kind: 'card', cardState: { kind: 'workouts', workouts: result.data } }
    } catch {
      return { kind: 'error', message: 'Failed to parse workout proposal', toolName: tc.name }
    }
  }
  if (tc.name === 'add_exercise') {
    try {
      const raw = JSON.parse(tc.arguments) as unknown
      const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const id = asString(p.id)
      const name = asString(p.name)
      const description = asString(p.description) ?? ''
      const tags = Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : []
      if (!id) return { kind: 'error', message: 'add_exercise: id is required', toolName: tc.name }
      if (!name) return { kind: 'error', message: 'add_exercise: name is required', toolName: tc.name }
      return { kind: 'execute', execution: { kind: 'add_exercise', exercise: { id, name, description, tags } } }
    } catch {
      return { kind: 'error', message: 'Failed to parse add_exercise arguments', toolName: tc.name }
    }
  }
  if (tc.name === 'remove_exercise') {
    try {
      const raw = JSON.parse(tc.arguments) as unknown
      const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const id = asString(p.id)
      if (!id) return { kind: 'error', message: 'remove_exercise: id is required', toolName: tc.name }
      return { kind: 'execute', execution: { kind: 'remove_exercise', id } }
    } catch {
      return { kind: 'error', message: 'Failed to parse remove_exercise arguments', toolName: tc.name }
    }
  }
  if (tc.name === 'delete_future_workouts') {
    try {
      const raw = JSON.parse(tc.arguments) as unknown
      const payload = (raw && typeof raw === 'object' ? raw : {}) as {
        fromDate?: unknown
        toDate?: unknown
        includeToday?: unknown
      }

      if (payload.fromDate !== undefined && !isIsoDate(payload.fromDate)) {
        return { kind: 'error', message: 'fromDate must be YYYY-MM-DD', toolName: tc.name }
      }
      if (payload.toDate !== undefined && !isIsoDate(payload.toDate)) {
        return { kind: 'error', message: 'toDate must be YYYY-MM-DD', toolName: tc.name }
      }
      if (payload.fromDate && payload.toDate && payload.fromDate > payload.toDate) {
        return { kind: 'error', message: 'fromDate must be <= toDate', toolName: tc.name }
      }
      return {
        kind: 'execute',
        execution: {
          kind: 'delete_future_workouts',
          fromDate: payload.fromDate,
          toDate: payload.toDate,
          includeToday: payload.includeToday === true,
        },
      }
    } catch {
      return { kind: 'error', message: 'Failed to parse delete request', toolName: tc.name }
    }
  }
  if (tc.name === 'edit_workout') {
    try {
      const raw = JSON.parse(tc.arguments) as unknown
      const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const workoutId = typeof p.workoutId === 'number' && Number.isInteger(p.workoutId) && p.workoutId > 0
        ? p.workoutId
        : undefined
      if (!workoutId) {
        return { kind: 'error', message: 'edit_workout: workoutId must be a positive integer', toolName: tc.name }
      }
      const patchesRaw = (p.patches && typeof p.patches === 'object' ? p.patches : {}) as Record<string, unknown>
      const patches: EditWorkoutPatches = {}
      if (Array.isArray(patchesRaw.entries)) {
        patches.entries = patchesRaw.entries
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
          .map((e) => ({
            entryIndex: typeof e.entryIndex === 'number' ? Math.round(e.entryIndex) : 0,
            sets: Array.isArray(e.sets)
              ? (e.sets as Record<string, unknown>[])
                  .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
                  .map((s) => {
                    const patch: EditWorkoutSetPatch = {
                      setIndex: typeof s.setIndex === 'number' ? Math.round(s.setIndex) : 0,
                    }
                    if (typeof s.plannedReps === 'number' && s.plannedReps > 0) patch.plannedReps = Math.round(s.plannedReps)
                    if (typeof s.plannedWeight === 'number' && s.plannedWeight >= 0) patch.plannedWeight = s.plannedWeight
                    if (typeof s.targetSeconds === 'number' && s.targetSeconds > 0) patch.targetSeconds = Math.round(s.targetSeconds)
                    return patch
                  })
              : undefined,
          }))
      }
      return { kind: 'execute', execution: { kind: 'edit_workout', workoutId, patches } }
    } catch {
      return { kind: 'error', message: 'Failed to parse edit_workout arguments', toolName: tc.name }
    }
  }
  if (tc.name === 'swap_exercise') {
    try {
      const raw = JSON.parse(tc.arguments) as unknown
      const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const workoutId = typeof p.workoutId === 'number' && Number.isInteger(p.workoutId) && p.workoutId > 0
        ? p.workoutId
        : undefined
      const entryIndex = typeof p.entryIndex === 'number' && Number.isInteger(p.entryIndex) && p.entryIndex >= 0
        ? p.entryIndex
        : undefined
      const toExerciseId = typeof p.toExerciseId === 'string' ? p.toExerciseId.trim() : ''
      if (!workoutId) {
        return { kind: 'error', message: 'swap_exercise: workoutId must be a positive integer', toolName: tc.name }
      }
      if (entryIndex === undefined) {
        return { kind: 'error', message: 'swap_exercise: entryIndex must be a non-negative integer', toolName: tc.name }
      }
      if (!toExerciseId) {
        return { kind: 'error', message: 'swap_exercise: toExerciseId is required', toolName: tc.name }
      }
      return {
        kind: 'execute',
        execution: { kind: 'swap_exercise', workoutId, entryIndex, toExerciseId },
      }
    } catch {
      return { kind: 'error', message: 'Failed to parse swap_exercise arguments', toolName: tc.name }
    }
  }
  // Unknown tool — auto-error so input never deadlocks
  return { kind: 'error', message: `Unknown tool: ${tc.name}`, toolName: tc.name }
}
