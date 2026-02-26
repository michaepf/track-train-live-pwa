import { useState, useEffect, useRef } from 'react'
import { streamChat, MODELS } from '../lib/api.ts'
import type { ModelTier } from '../lib/api.ts'
import { EXERCISE_MAP, registerCustomExercises } from '../data/exercises.ts'
import {
  buildSystemPrompt,
  buildHistoryContext,
  buildUpcomingPlannedContext,
  needsGoalReview,
  getWeekKey,
  getPlanningWindow,
  getToday,
  RECENT_HISTORY_DAYS,
} from '../lib/context.ts'
import { useApiKey } from '../App.tsx'
import {
  getGoals,
  saveGoals,
  saveWorkout,
  saveConversation,
  listConversations,
  listWorkouts,
  deleteWorkout,
  getSummary,
  getSetting,
  setSetting,
  getCustomExercises,
  saveCustomExercise,
  deleteCustomExercise,
} from '../lib/db.ts'
import type { Exercise } from '../data/exercises.ts'
import {
  GoalsSchema,
  WorkoutSchema,
  ProposeGoalsPayloadSchema,
  ProposeWorkoutsPayloadSchema,
} from '../lib/schemas/index.ts'
import type {
  Goals,
  Conversation,
  Message,
  ConversationType,
  ProposeWorkoutsPayload,
} from '../lib/schemas/index.ts'
import type { StreamResult } from '../lib/api.ts'
import {
  ProposeGoalsCard,
  ProposeWorkoutCard,
  ToolErrorCard,
} from '../components/ToolCard.tsx'
import MarkdownText from '../components/MarkdownText.tsx'

// ─── Tool definitions ──────────────────────────────────────────────────────────

const PROPOSE_GOALS_TOOL = {
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

const PROPOSE_WORKOUT_TOOL = {
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

const ADD_EXERCISE_TOOL = {
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

const REMOVE_EXERCISE_TOOL = {
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

const DELETE_FUTURE_WORKOUTS_TOOL = {
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

type PendingTool = {
  id: string
  name: string
  arguments: string
}

type ToolCardState =
  | { kind: 'goals'; text: string }
  | { kind: 'workouts'; workouts: ProposeWorkoutsPayload }
  | { kind: 'error'; toolName: string; message: string }

type ToolExecution =
  | {
      kind: 'delete_future_workouts'
      fromDate?: string
      toDate?: string
      includeToday?: boolean
    }
  | { kind: 'add_exercise'; exercise: Exercise }
  | { kind: 'remove_exercise'; id: string }

const MAX_FAKE_TOOL_RETRIES = 2
const MAX_TOOL_VALIDATION_RETRIES = 2
const ONBOARDING_WELCOME_MESSAGE = `Welcome to Track Train Live! I'm your AI personal trainer.

Here's how it works: we'll start with a short conversation about your goals and fitness background. From there, I'll build a personalised workout plan — view upcoming sessions on the **Workouts** tab. On the day of a workout, use the **Today** tab to record how it went. Past sessions are saved to the **Log** tab. Come back here anytime to adjust your plan.

To get started: what's your current experience with exercise or training? Are you just getting started, coming back after a break, or already training consistently?`

function looksLikeFakeToolNarration(text: string): boolean {
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

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}


function getToolSchemaHint(toolName: string): string {
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
  return `Strict schema reminder: emit a valid ${toolName} tool call with correctly typed JSON arguments.`
}

// ─── Tool call resolution (synchronous) ───────────────────────────────────────

/**
 * Validates and categorizes an incoming tool call from the model.
 * Returns either a "card" (needs user interaction) or an "error"
 * (already resolved — should be appended to the thread as a tool result).
 *
 * This is synchronous so onDone can build the final message array in one pass
 * before calling persistConv once.
 */
function resolveToolCall(tc: PendingTool, customExerciseIds: Set<string> = new Set()):
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
  // Unknown tool — auto-error so input never deadlocks
  return { kind: 'error', message: `Unknown tool: ${tc.name}`, toolName: tc.name }
}

// ─── Message rendering ─────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  // Tool result messages are not shown in the UI
  if (message.role === 'tool') return null
  // Internal messages (e.g. retry instructions) — sent to the API but not shown
  if (message.hidden) return null
  // Skip empty assistant bubbles (can happen when provider returns no text)
  if (message.role === 'assistant' && !message.content.trim()) return null
  // Assistant messages with a tool call but no text content have nothing to show
  if (message.role === 'assistant' && message.toolCall && !message.content) return null

  return (
    <div className={`chat-message chat-message--${message.role}`}>
      <div className="chat-bubble">
        <MarkdownText text={message.content} />
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

interface ChatProps {
  onStreamingChange?: (streaming: boolean) => void
}

export default function Chat({ onStreamingChange }: ChatProps) {
  const apiKey = useApiKey()

  const [goals, setGoals] = useState<Goals | null>(null)
  const [customExercises, setCustomExercises] = useState<Exercise[]>([])
  const [conv, setConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [mode, setMode] = useState<ConversationType>('planning')
  const [model, setModel] = useState('')

  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const [toolActionBusy, setToolActionBusy] = useState(false)

  const [input, setInput] = useState('')
  const [toolCard, setToolCard] = useState<ToolCardState | null>(null)
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null)

  const [menuOpen, setMenuOpen] = useState(false)
  const [resetArmed, setResetArmed] = useState(false)

  const [initialized, setInitialized] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fakeToolRetryRef = useRef(0)
  const toolValidationRetryRef = useRef(0)

  // ─── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const [goalsData, modelSetting, conversations, customEx] = await Promise.all([
        getGoals(),
        getSetting('model'),
        listConversations(20),
        getCustomExercises(),
      ])
      setCustomExercises(customEx)

      const convMode: ConversationType = !goalsData
        ? 'onboarding'
        : needsGoalReview(goalsData)
          ? 'goal_review'
          : 'planning'

      setGoals(goalsData)
      setMode(convMode)
      setModel(modelSetting === 'premium' ? MODELS.premium : MODELS.affordable)

      // Restore most recent conversation of this type, if any
      const existing = conversations.find((c) => c.type === convMode)
      if (existing) {
        setConv(existing)
        setMessages(existing.messages)
      } else if (convMode === 'onboarding') {
        // On first-run onboarding, seed a local welcome message so users can
        // reply immediately without waiting for a model kickoff turn.
        setMessages([{ role: 'assistant', content: ONBOARDING_WELCOME_MESSAGE }])
      }

      setInitialized(true)
    }

    init()
  }, [])

  // Auto-scroll to bottom on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Cleanup on unmount — abort any in-flight stream
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    onStreamingChange?.(streaming)
  }, [streaming, onStreamingChange])

  // Safety net: if pendingTool exists but no actionable goals card is visible,
  // clear pending state so input never stays locked.
  useEffect(() => {
    const hasActionableCard = toolCard?.kind === 'goals' || toolCard?.kind === 'workouts'
    if (pendingTool && !hasActionableCard) {
      setPendingTool(null)
    }
  }, [pendingTool, toolCard])

  // Auto-start greeting for goal_review with empty thread.
  // Onboarding uses a local seeded welcome message instead.
  useEffect(() => {
    if (
      initialized &&
      mode === 'goal_review' &&
      messages.length === 0 &&
      !streaming &&
      model
    ) {
      // Capture current state values at effect time to pass explicitly
      const capturedGoals = goals
      const capturedMode = mode
      const capturedModel = model
      doStream([], null, capturedMode, capturedGoals, capturedModel, customExercises)
    }
    // Intentionally omit doStream — stable within this effect's lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized])

  // ─── Streaming ───────────────────────────────────────────────────────────────

  async function executeToolAction(exec: ToolExecution): Promise<string> {
    if (exec.kind === 'add_exercise') {
      await saveCustomExercise(exec.exercise)
      const updated = await getCustomExercises()
      setCustomExercises(updated)
      registerCustomExercises(updated)
      return `Added exercise "${exec.exercise.name}" (${exec.exercise.id}) to your catalog.`
    }

    if (exec.kind === 'remove_exercise') {
      // Silently no-op if it's a built-in exercise
      if (exec.id in EXERCISE_MAP) {
        return `"${exec.id}" is a built-in exercise and cannot be removed.`
      }
      await deleteCustomExercise(exec.id)
      const updated = await getCustomExercises()
      setCustomExercises(updated)
      registerCustomExercises(updated)
      return `Removed exercise "${exec.id}" from your catalog.`
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

  /**
   * Core stream function. All mutable state is passed explicitly to avoid
   * stale closure bugs — mode, goals, conv all change across the session.
   *
   * onDone builds the final message array in one pass, then calls persistConv
   * once. Tool calls are resolved synchronously (resolveToolCall) before persist,
   * so there is no race between tool-error persistence and the main persist call.
   */
  async function doStream(
    thread: Message[],
    currentConv: Conversation | null,
    currentMode: ConversationType,
    currentGoals: Goals | null,
    currentModel: string,
    currentCustomExercises: Exercise[] = [],
  ) {
    if (!apiKey || !currentModel) {
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setStreaming(true)
    setStreamingContent('')
    setStreamError(null)
    setToolCard(null)

    // Build history context for planning (inject recent workout data)
    let historyContext = ''
    let upcomingContext = ''
    if (currentMode === 'planning') {
      const knownWorkouts = await listWorkouts(100)
      const summaryMap = new Map<string, string>()
      // Load summaries for weeks older than 3 weeks (knownWorkouts is sorted desc)
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - RECENT_HISTORY_DAYS)
      const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: tz })
      const olderWeekKeys = [
        ...new Set(
          knownWorkouts.filter((w) => w.date < cutoffStr).map((w) => getWeekKey(w.date)),
        ),
      ]
      for (const wk of olderWeekKeys) {
        const summary = await getSummary(wk)
        if (summary) summaryMap.set(wk, summary)
      }
      historyContext = buildHistoryContext(knownWorkouts, summaryMap)
      upcomingContext = buildUpcomingPlannedContext(knownWorkouts)
    }

    const tools =
      currentMode === 'onboarding' || currentMode === 'goal_review'
        ? [PROPOSE_GOALS_TOOL]
        : currentMode === 'planning'
          ? [PROPOSE_WORKOUT_TOOL, DELETE_FUTURE_WORKOUTS_TOOL, ADD_EXERCISE_TOOL, REMOVE_EXERCISE_TOOL]
          : []

    await streamChat({
      apiKey,
      model: currentModel,
      messages: thread,
      tools,
      toolChoice: currentMode === 'planning' ? 'auto' : undefined,
      systemPrompt: buildSystemPrompt(currentGoals, currentMode, historyContext, upcomingContext, currentCustomExercises),
      signal: abortRef.current.signal,

      onDelta: (text) => {
        setStreamingContent((prev) => prev + text)
      },

      onDone: async (result: StreamResult) => {
        setStreamingContent('')
        setStreaming(false)

        if (result.toolCall) {
          fakeToolRetryRef.current = 0
        }

        const assistantMsg: Message = {
          role: 'assistant',
          content: result.content,
          ...(result.toolCall ? { toolCall: result.toolCall } : {}),
          ...(result.thinkingBlocks?.length ? { thinkingBlocks: result.thinkingBlocks } : {}),
        }

        // Build the final thread in one pass before persisting
        let finalMessages: Message[] = [...thread, assistantMsg]

        if (result.toolCall) {
          const tc: PendingTool = result.toolCall
          const resolved = resolveToolCall(tc, new Set(currentCustomExercises.map((e) => e.id)))
          if (resolved.kind === 'error') {
            // Auto-resolve: append tool error result so the thread stays valid.
            // Input remains enabled — user can keep chatting.
            finalMessages = [
              ...finalMessages,
              {
                role: 'tool' as const,
                content: `Error: ${resolved.message}`,
                toolCallId: tc.id,
              },
            ]
            setToolCard({ kind: 'error', toolName: resolved.toolName, message: resolved.message })

            if (toolValidationRetryRef.current < MAX_TOOL_VALIDATION_RETRIES) {
              toolValidationRetryRef.current += 1
              const retryInstruction: Message = {
                role: 'user',
                hidden: true,
                content:
                  `The previous ${tc.name} tool call was invalid: ${resolved.message}. ` +
                  `Please retry now by emitting a valid ${tc.name} tool call with corrected arguments. ` +
                  'Do not respond with plain text.\n\n' +
                  getToolSchemaHint(tc.name),
              }
              const retryThread = [...finalMessages, retryInstruction]
              setMessages(retryThread)
              const savedConv = await persistConv(retryThread, currentConv, currentMode)
              await doStream(retryThread, savedConv, currentMode, currentGoals, currentModel, currentCustomExercises)
              return
            }
            // Retry cap reached — leave error visible and keep input enabled.
          } else if (resolved.kind === 'execute') {
            try {
              const outcome = await executeToolAction(resolved.execution)
              finalMessages = [
                ...finalMessages,
                {
                  role: 'tool' as const,
                  content: outcome,
                  toolCallId: tc.id,
                },
                {
                  role: 'assistant',
                  content: outcome,
                },
              ]
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err)
              finalMessages = [
                ...finalMessages,
                {
                  role: 'tool' as const,
                  content: `Error: ${detail}`,
                  toolCallId: tc.id,
                },
              ]
              setToolCard({ kind: 'error', toolName: tc.name, message: detail })
            }
          } else {
            // Valid tool call — user must accept or reject before thread continues
            toolValidationRetryRef.current = 0
            setPendingTool(tc)
            setToolCard(resolved.cardState)
            // Do NOT append a tool result yet; that happens on accept/reject
          }
        }

        setMessages(finalMessages)
        await persistConv(finalMessages, currentConv, currentMode)

        // Keep tool-driven flows conversational, but recover if the model
        // narrates a fake tool call in plain text instead of emitting tool_calls.
        if (
          !result.toolCall &&
          (currentMode === 'onboarding' || currentMode === 'goal_review' || currentMode === 'planning') &&
          looksLikeFakeToolNarration(result.content)
        ) {
          const expectedTool = currentMode === 'planning' ? 'propose_workout' : 'propose_goals'
          if (fakeToolRetryRef.current < MAX_FAKE_TOOL_RETRIES) {
            fakeToolRetryRef.current += 1
            setToolCard({
              kind: 'error',
              toolName: expectedTool,
              message:
                'Model narrated a tool call instead of emitting one. Press Send to retry with a strict tool-call request.',
            })

            // Queue a strict follow-up prompt in the input instead of auto-retrying.
            // This keeps the UI responsive and avoids retry loops that feel frozen.
            setInput(
              currentMode === 'planning'
                ? 'Please emit an actual propose_workout tool call now. Do not describe the tool call in plain text.'
                : 'Please emit an actual propose_goals tool call now. Do not describe the tool call in plain text.',
            )
            return
          }

          setToolCard({
            kind: 'error',
            toolName: expectedTool,
            message:
              currentMode === 'planning'
                ? 'Model did not emit a real tool call. Send a message asking it to call propose_workout.'
                : 'Model did not emit a real tool call. Send a message asking it to call propose_goals.',
          })
          return
        }

      },

      onError: (err: Error) => {
        setStreamingContent('')
        setStreaming(false)
        setStreamError(err.message)
      },
    })
  }

  // ─── Conversation persistence ─────────────────────────────────────────────────

  async function persistConv(
    msgs: Message[],
    currentConv: Conversation | null,
    currentMode: ConversationType,
  ): Promise<Conversation> {
    const now = new Date().toISOString()
    if (currentConv) {
      const updated = await saveConversation({
        ...currentConv,
        type: currentMode,
        messages: msgs,
        updatedAt: now,
      })
      setConv(updated)
      return updated
    } else {
      const created = await saveConversation({
        _v: 1,
        type: currentMode,
        messages: msgs,
        createdAt: now,
        updatedAt: now,
      })
      setConv(created)
      return created
    }
  }

  // ─── User send ────────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim()
    if (!text || streaming || pendingTool) return

    const userMsg: Message = { role: 'user', content: text }
    const newThread = [...messages, userMsg]
    setMessages(newThread)
    setInput('')
    toolValidationRetryRef.current = 0

    const savedConv = await persistConv(newThread, conv, mode)
    await doStream(newThread, savedConv, mode, goals, model, customExercises)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleModelToggle(tier: ModelTier) {
    const newModel = MODELS[tier]
    setModel(newModel)
    await setSetting('model', tier)
  }

  function closeMenu() {
    setMenuOpen(false)
    setResetArmed(false)
  }

  // ─── Tool card actions ────────────────────────────────────────────────────────

  async function handleAcceptGoals(text: string) {
    if (!pendingTool) return

    const now = new Date().toISOString()
    const newGoals = GoalsSchema.parse({ text, updatedAt: now, pendingReview: false })
    await saveGoals(newGoals)
    setGoals(newGoals)

    const toolResult: Message = {
      role: 'tool',
      content: 'Goals accepted.',
      toolCallId: pendingTool.id,
    }
    const confirmMsg: Message = {
      role: 'assistant',
      content:
        'Great — your goals are saved. I\'m now building your first week of workouts. You can ask me anytime to adjust any part of your plan.',
    }
    const newMessages = [...messages, toolResult, confirmMsg]
    setMessages(newMessages)
    setToolCard(null)
    setPendingTool(null)

    const nextMode: ConversationType = 'planning'
    setMode(nextMode)

    const savedConv = await persistConv(newMessages, conv, nextMode)
    fakeToolRetryRef.current = 0
    toolValidationRetryRef.current = 0
    // Continue — model acknowledges acceptance
    await doStream(newMessages, savedConv, nextMode, newGoals, model, customExercises)
  }

  async function handleAcceptWorkouts(workouts: ProposeWorkoutsPayload) {
    if (!pendingTool || toolActionBusy) return
    const currentPending = pendingTool

    setToolActionBusy(true)
    setStreamError(null)
    try {
      const now = new Date().toISOString()
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

      for (const proposal of workouts) {
        const workoutToSave = WorkoutSchema.parse({
          ...proposal,
          timezone,
          generatedAt: now,
        })
        // Always-append policy for AI-proposed workouts (never overwrite existing records).
        await saveWorkout(workoutToSave)
      }

      const toolResult: Message = {
        role: 'tool',
        content: `Workouts accepted and saved (${workouts.length}).`,
        toolCallId: currentPending.id,
      }
      const confirmMsg: Message = {
        role: 'assistant',
        content:
          `Saved ${workouts.length} workout${workouts.length === 1 ? '' : 's'} to your plan. ` +
          'You can view them on the **Workouts** tab. Feel free to ask me anytime if you\'d like to make any changes.',
      }
      const newMessages = [...messages, toolResult, confirmMsg]
      setMessages(newMessages)
      setToolCard(null)
      setPendingTool(null)

      const savedConv = await persistConv(newMessages, conv, mode)
      fakeToolRetryRef.current = 0
      toolValidationRetryRef.current = 0
      // Stop here after accept. Auto-follow-up in planning can force another
      // propose_workout turn and produce confusing retry prompts.
      setConv(savedConv)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      setStreamError(`Failed to save accepted workouts: ${detail}`)
    } finally {
      setToolActionBusy(false)
    }
  }

  async function handleRequestChanges(feedback: string) {
    if (!pendingTool) return

    const toolResult: Message = {
      role: 'tool',
      content: 'User requested changes.',
      toolCallId: pendingTool.id,
    }
    const userMsg: Message = { role: 'user', content: feedback }
    const newMessages = [...messages, toolResult, userMsg]

    setMessages(newMessages)
    setToolCard(null)
    setPendingTool(null)

    const savedConv = await persistConv(newMessages, conv, mode)
    fakeToolRetryRef.current = 0
    toolValidationRetryRef.current = 0
    await doStream(newMessages, savedConv, mode, goals, model, customExercises)
  }

  // ─── New conversation ─────────────────────────────────────────────────────────

  async function handleNewConversation() {
    abortRef.current?.abort()
    // Persist empty messages before clearing state so remount doesn't restore the old thread
    if (conv) {
      await persistConv([], conv, mode)
    }
    setConv(null)
    setMessages([])
    setStreamingContent('')
    setStreamError(null)
    setToolCard(null)
    setPendingTool(null)
    setStreaming(false)
    setToolActionBusy(false)
    fakeToolRetryRef.current = 0
    toolValidationRetryRef.current = 0
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  const inputPlaceholder =
    mode === 'onboarding'
      ? 'Tell me about yourself…'
      : mode === 'goal_review'
        ? 'Discuss your goals…'
        : 'Ask your trainer…'

  const inputDisabled =
    streaming ||
    toolActionBusy ||
    (pendingTool !== null &&
      (toolCard?.kind === 'goals' || toolCard?.kind === 'workouts'))

  return (
    <div className="chat-screen">
      {/* Header */}
      <div className="chat-header">
        <span className="chat-mode-label">
          {mode === 'onboarding' ? 'Setup' : mode === 'goal_review' ? 'Goal Review' : 'Planning'}
        </span>
        <div className="chat-header-right">
          <button className="chat-menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Chat options">
            ⋮
          </button>
          {menuOpen && (
            <>
              <div className="chat-menu-backdrop" onClick={closeMenu} />
              <div className="chat-menu-dropdown">
                <div className="chat-menu-section-label">Model</div>
                {(['affordable', 'premium'] as ModelTier[]).map((tier) => (
                  <button
                    key={tier}
                    className={`chat-menu-option${model === MODELS[tier] ? ' chat-menu-option--active' : ''}`}
                    onClick={() => { handleModelToggle(tier); closeMenu() }}
                  >
                    <span className="chat-menu-option-name">
                      {tier === 'affordable' ? 'Affordable' : 'Premium'}
                    </span>
                    <span className="chat-menu-option-desc">
                      {tier === 'affordable' ? 'GLM · lower cost' : 'Claude Sonnet · higher cost'}
                    </span>
                  </button>
                ))}
                <div className="chat-menu-divider" />
                {!resetArmed ? (
                  <button
                    className="chat-menu-option chat-menu-option--danger"
                    onClick={() => setResetArmed(true)}
                  >
                    <span className="chat-menu-option-name">Reset Chat</span>
                    <span className="chat-menu-option-desc">Start a new conversation</span>
                  </button>
                ) : (
                  <div className="chat-menu-confirm">
                    <span className="chat-menu-confirm-label">Reset conversation?</span>
                    <div className="chat-menu-confirm-row">
                      <button className="chat-menu-cancel-btn" onClick={() => setResetArmed(false)}>
                        Cancel
                      </button>
                      <button
                        className="chat-menu-reset-btn"
                        onClick={() => { handleNewConversation(); closeMenu() }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Message list */}
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}

        {/* Streaming partial response */}
        {streaming && streamingContent && (
          <div className="chat-message chat-message--assistant">
            <div className="chat-bubble">
              <MarkdownText text={streamingContent} />
              <span className="chat-cursor" />
            </div>
          </div>
        )}

        {/* Thinking indicator (streaming but no text yet) */}
        {streaming && !streamingContent && (
          <div className="chat-message chat-message--assistant">
            <div className="chat-bubble chat-bubble--thinking">
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
            </div>
          </div>
        )}

        {/* Tool errors stay in-thread */}
        {toolCard?.kind === 'error' && (
          <ToolErrorCard toolName={toolCard.toolName} message={toolCard.message} />
        )}

        {/* Stream error */}
        {streamError && <div className="chat-error">{streamError}</div>}

        <div ref={bottomRef} />
      </div>

      {/* Goals proposal panel is fixed above input so it is always visible/clickable */}
      {toolCard?.kind === 'goals' && (
        <div className="chat-tool-panel">
          <ProposeGoalsCard
            proposedText={toolCard.text}
            onAccept={() => handleAcceptGoals(toolCard.text)}
            onRequestChanges={handleRequestChanges}
          />
        </div>
      )}

      {toolCard?.kind === 'workouts' && (
        <div className="chat-tool-panel">
          <ProposeWorkoutCard
            workouts={toolCard.workouts}
            onAccept={() => handleAcceptWorkouts(toolCard.workouts)}
            onRequestChanges={handleRequestChanges}
            disabled={toolActionBusy}
          />
        </div>
      )}

      {/* Input bar */}
      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={inputPlaceholder}
          rows={2}
          disabled={inputDisabled}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || inputDisabled}
        >
          Send
        </button>
      </div>
    </div>
  )
}
