import { useState, useEffect, useRef } from 'react'
import { streamChat, MODELS } from '../lib/api.ts'
import type { ModelTier } from '../lib/api.ts'
import { getExerciseName, registerExerciseCatalog } from '../data/exercises.ts'
import {
  buildSystemPrompt,
  buildHistoryContext,
  buildUpcomingPlannedContext,
  needsGoalReview,
  getWeekKey,
  getToday,
  RECENT_HISTORY_DAYS,
} from '../lib/context.ts'
import { useApiKey } from '../App.tsx'
import {
  getGoals,
  saveGoals,
  saveWorkout,
  getWorkoutById,
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
  isEntryInProgress,
  isSetCompleted,
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
import {
  PROPOSE_GOALS_TOOL,
  PROPOSE_WORKOUT_TOOL,
  ADD_EXERCISE_TOOL,
  REMOVE_EXERCISE_TOOL,
  DELETE_FUTURE_WORKOUTS_TOOL,
  EDIT_WORKOUT_TOOL,
  SWAP_EXERCISE_TOOL,
  looksLikeFakeToolNarration,
  addDays,
  getToolSchemaHint,
  resolveToolCall,
} from '../lib/chatTools.ts'
import type { PendingTool, ToolCardState, ToolExecution } from '../lib/chatTools.ts'

const MAX_FAKE_TOOL_RETRIES = 2
const MAX_TOOL_VALIDATION_RETRIES = 2
const ONBOARDING_WELCOME_MESSAGE = `Welcome to Track Train Live! I'm your AI personal trainer.

Here's how it works: we'll start with a short conversation about your goals and fitness background. From there, I'll build a personalised workout plan — view upcoming sessions on the **Workouts** tab. On the day of a workout, use the **Today** tab to record how it went. Past sessions are saved to the **Log** tab. Come back here anytime to adjust your plan.

To get started: what's your current experience with exercise or training? Are you just getting started, coming back after a break, or already training consistently?`

function buildEditWorkoutFollowupPrompt(outcome: string): string {
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

function buildSwapExerciseFollowupPrompt(outcome: string): string {
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

// ─── Message rendering ─────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  // Tool result messages are not shown in the UI
  if (message.role === 'tool') return null
  // Internal messages (e.g. retry instructions) — sent to the API but not shown
  if (message.hidden) return null
  // Skip empty assistant bubbles (can happen when provider returns no text)
  if (message.role === 'assistant' && !message.content.trim()) return null
  // Keep existing behavior for most tools, but hide edit_workout tool-call turns
  // so users see the post-edit confirmation instead of pre-tool filler text.
  if (message.role === 'assistant' && message.toolCall?.name === 'edit_workout') return null

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
  onNewResponse?: () => void
  isActive?: boolean
  seedMessage?: string
  onSeedConsumed?: () => void
}

export default function Chat({ onStreamingChange, onNewResponse, isActive = true, seedMessage, onSeedConsumed }: ChatProps) {
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
  // Capture seed on mount — survives the prop being cleared by onSeedConsumed
  const seedMessageRef = useRef<string | null>(seedMessage ?? null)
  const isActiveRef = useRef(isActive)
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

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  // Notify App that the seed message has been consumed so it isn't re-applied on next mount.
  useEffect(() => {
    if (seedMessage) onSeedConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Captured once on mount — survives the prop being cleared by onSeedConsumed.
   * Prepended as a hidden instruction on the first send when Chat is launched
   * from the post-workout debrief modal.
   */
  const debriefInstructionRef = useRef<Message | null>(
    seedMessage
      ? {
          role: 'user',
          hidden: true,
          content:
            'The user just finished a workout and tapped "Talk to my trainer" from the completion screen. ' +
            'Do NOT summarize or recap the workout — they just did it and already know what happened. ' +
            'Acknowledge how it went in one sentence at most (e.g. "Solid session" or "Tough one with those failures"). ' +
            'Then close with ONE specific, forward-looking question. Good examples: ' +
            '"Want to look over your next session together?" or ' +
            '"Anything specific you want me to adjust going forward?" ' +
            'Do NOT ask vague questions like "How did it feel overall?" — be concrete and action-oriented. ' +
            'Keep the entire response to 2–3 sentences max.',
        }
      : null,
  )

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

  // Auto-send seed message (e.g. post-workout debrief) once the thread is ready.
  useEffect(() => {
    const seed = seedMessageRef.current
    if (!initialized || !seed || streaming || !model) return
    seedMessageRef.current = null
    const instruction = debriefInstructionRef.current
    debriefInstructionRef.current = null
    const userMsg: Message = { role: 'user', content: seed }
    const thread: Message[] = instruction ? [instruction, userMsg] : [userMsg]
    setMessages(thread)
    const capturedGoals = goals
    const capturedMode = mode
    const capturedModel = model
    persistConv(thread, conv, capturedMode).then((savedConv) => {
      doStream(thread, savedConv, capturedMode, capturedGoals, capturedModel, customExercises)
    })
    // Intentionally omit doStream/persistConv — stable within this effect's lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized])

  // ─── Streaming ───────────────────────────────────────────────────────────────

  async function executeToolAction(exec: ToolExecution): Promise<string> {
    if (exec.kind === 'add_exercise') {
      // Duplicate check — ID collision
      if (customExercises.some((e) => e.id === exec.exercise.id)) {
        return `Exercise with id "${exec.exercise.id}" already exists in the catalog.`
      }
      // Duplicate check — name collision (case-insensitive)
      const nameLower = exec.exercise.name.toLowerCase()
      const nameMatch = customExercises.find((e) => e.name.toLowerCase() === nameLower)
      if (nameMatch) {
        return `An exercise called "${nameMatch.name}" already exists (id: ${nameMatch.id}). Use that id instead of adding a duplicate.`
      }
      await saveCustomExercise(exec.exercise)
      const updated = await getCustomExercises()
      setCustomExercises(updated)
      registerExerciseCatalog(updated)
      return `Added exercise "${exec.exercise.name}" (${exec.exercise.id}) to your catalog.`
    }

    if (exec.kind === 'remove_exercise') {
      await deleteCustomExercise(exec.id)
      const updated = await getCustomExercises()
      setCustomExercises(updated)
      registerExerciseCatalog(updated)
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
      const isKnownExercise = customExercises.some((e) => e.id === exec.toExerciseId)
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
          ? [PROPOSE_WORKOUT_TOOL, EDIT_WORKOUT_TOOL, SWAP_EXERCISE_TOOL, DELETE_FUTURE_WORKOUTS_TOOL, ADD_EXERCISE_TOOL, REMOVE_EXERCISE_TOOL]
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
        if (!isActiveRef.current) onNewResponse?.()

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
              ]
              if (resolved.execution.kind === 'edit_workout' || resolved.execution.kind === 'swap_exercise') {
                // Add a hidden nudge with explicit extracted details to avoid generic confirmations.
                const followupPrompt =
                  resolved.execution.kind === 'edit_workout'
                    ? buildEditWorkoutFollowupPrompt(outcome)
                    : buildSwapExerciseFollowupPrompt(outcome)
                const threadWithNudge: Message[] = [
                  ...finalMessages,
                  {
                    role: 'user',
                    hidden: true,
                    content: followupPrompt,
                  },
                ]
                setMessages(finalMessages)
                const savedConv = await persistConv(threadWithNudge, currentConv, currentMode)
                await doStream(threadWithNudge, savedConv, currentMode, currentGoals, currentModel, currentCustomExercises)
                return
              }
              finalMessages = [
                ...finalMessages,
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
    // Prepend debrief instruction on the very first send from the post-workout modal, then clear it
    const prefix: Message[] = debriefInstructionRef.current && messages.length === 0 ? [debriefInstructionRef.current] : []
    debriefInstructionRef.current = null
    const newThread = [...messages, ...prefix, userMsg]
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
