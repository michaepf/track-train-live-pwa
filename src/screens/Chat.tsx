import { useState, useEffect, useRef } from 'react'
import { streamChat, MODELS } from '../lib/api.ts'
import type { ModelTier } from '../lib/api.ts'
import { registerExerciseCatalog } from '../data/exercises.ts'
import {
  buildSystemPrompt,
  buildHistoryContext,
  buildUpcomingPlannedContext,
  needsGoalReview,
  needsPlanReview,
  getWeekKey,
  getToday,
  RECENT_HISTORY_DAYS,
} from '../lib/context.ts'
import { useApiKey } from '../App.tsx'
import {
  getGoals,
  saveGoals,
  getProfile,
  saveProfile,
  getTrainingPlan,
  saveTrainingPlan,
  saveWorkout,
  saveConversation,
  listConversations,
  listWorkouts,
  getSummary,
  getSetting,
  setSetting,
  getCustomExercises,
} from '../lib/db.ts'
import type { Exercise } from '../data/exercises.ts'
import {
  GoalsSchema,
  UserProfileSchema,
  TrainingPlanSchema,
  WorkoutSchema,
} from '../lib/schemas/index.ts'
import type {
  Goals,
  UserProfile,
  TrainingPlan,
  Conversation,
  Message,
  ConversationType,
  ProposeProfilePayload,
  ProposeTrainingPlanPayload,
  ProposeWorkoutsPayload,
} from '../lib/schemas/index.ts'
import type { StreamResult } from '../lib/api.ts'
import {
  ProposeProfileCard,
  ProposeGoalsCard,
  ProposeTrainingPlanCard,
  ProposeWorkoutCard,
  ToolErrorCard,
} from '../components/ToolCard.tsx'
import MarkdownText from '../components/MarkdownText.tsx'
import {
  PROPOSE_PROFILE_TOOL,
  PROPOSE_GOALS_TOOL,
  PROPOSE_TRAINING_PLAN_TOOL,
  PROPOSE_WORKOUT_TOOL,
  ADD_EXERCISE_TOOL,
  REMOVE_EXERCISE_TOOL,
  DELETE_FUTURE_WORKOUTS_TOOL,
  EDIT_WORKOUT_TOOL,
  SWAP_EXERCISE_TOOL,
  looksLikeFakeToolNarration,
  getToolSchemaHint,
  resolveToolCall,
} from '../lib/chatTools.ts'
import type { PendingTool, ToolCardState } from '../lib/chatTools.ts'
import { executeToolAction, buildEditWorkoutFollowupPrompt, buildSwapExerciseFollowupPrompt } from '../lib/toolExecutors.ts'

const MAX_FAKE_TOOL_RETRIES = 2
const MAX_TOOL_VALIDATION_RETRIES = 2
const ONBOARDING_WELCOME_MESSAGE = `Welcome to Track Train Live! I'm your AI personal trainer.

Here's how it works: we'll start with a short conversation about your goals and fitness background. From there, I'll build a personalised workout plan — view upcoming sessions on the **Workouts** tab. On the day of a workout, use the **Today** tab to record how it went. Past sessions are saved to the **Log** tab. Come back here anytime to adjust your plan.

To get started: what's your current experience with exercise or training? Are you just getting started, coming back after a break, or already training consistently?`

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
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan | null>(null)
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
      const [goalsData, profileData, planData, modelSetting, conversations, customEx] = await Promise.all([
        getGoals(),
        getProfile(),
        getTrainingPlan(),
        getSetting('model'),
        listConversations(20),
        getCustomExercises(),
      ])
      setCustomExercises(customEx)

      // Checkpoint-based mode selection:
      // No profile → onboarding (start with profile)
      // Profile exists, no goals → onboarding (focus on goals)
      // Goals exist, no plan → goal_review (focus on creating plan)
      // needsGoalReview or needsPlanReview → goal_review
      // All present, nothing stale → planning
      let convMode: ConversationType
      if (!profileData) {
        convMode = 'onboarding'
      } else if (!goalsData) {
        convMode = 'onboarding'
      } else if (needsGoalReview(goalsData)) {
        convMode = 'goal_review'
      } else if (needsPlanReview(planData, goalsData)) {
        convMode = 'goal_review'
      } else {
        convMode = 'planning'
      }

      setGoals(goalsData)
      setProfile(profileData)
      setTrainingPlan(planData)
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
    const hasActionableCard = toolCard?.kind === 'profile' || toolCard?.kind === 'goals' || toolCard?.kind === 'trainingPlan' || toolCard?.kind === 'workouts'
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
      doStream([], null, capturedMode, capturedGoals, capturedModel, customExercises, profile, trainingPlan)
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
      doStream(thread, savedConv, capturedMode, capturedGoals, capturedModel, customExercises, profile, trainingPlan)
    })
    // Intentionally omit doStream/persistConv — stable within this effect's lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized])

  // ─── Streaming ───────────────────────────────────────────────────────────────

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
    currentProfile: UserProfile | null = null,
    currentPlan: TrainingPlan | null = null,
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

    // Build history context — planning always, goal_review always, onboarding if workout data exists
    let historyContext = ''
    let upcomingContext = ''
    const includeHistory = currentMode === 'planning' || currentMode === 'goal_review' || currentMode === 'onboarding'
    if (includeHistory) {
      const knownWorkouts = await listWorkouts(100)
      if (knownWorkouts.length > 0 || currentMode === 'planning') {
        const summaryMap = new Map<string, string>()
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
        if (currentMode === 'planning') {
          upcomingContext = buildUpcomingPlannedContext(knownWorkouts)
        }
      }
    }

    const tools =
      currentMode === 'onboarding'
        ? [PROPOSE_PROFILE_TOOL, PROPOSE_GOALS_TOOL, PROPOSE_TRAINING_PLAN_TOOL]
        : currentMode === 'goal_review'
          ? [PROPOSE_PROFILE_TOOL, PROPOSE_GOALS_TOOL, PROPOSE_TRAINING_PLAN_TOOL]
          : currentMode === 'planning'
            ? [PROPOSE_WORKOUT_TOOL, EDIT_WORKOUT_TOOL, SWAP_EXERCISE_TOOL, DELETE_FUTURE_WORKOUTS_TOOL, ADD_EXERCISE_TOOL, REMOVE_EXERCISE_TOOL, PROPOSE_TRAINING_PLAN_TOOL]
            : []

    await streamChat({
      apiKey,
      model: currentModel,
      messages: thread,
      tools,
      toolChoice: currentMode === 'planning' ? 'auto' : undefined,
      systemPrompt: buildSystemPrompt(currentGoals, currentMode, historyContext, upcomingContext, currentCustomExercises, currentProfile, currentPlan),
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
          console.log('[chat] tool call received:', tc.name, 'id:', tc.id, 'args length:', tc.arguments.length)
          const resolved = resolveToolCall(tc, new Set(currentCustomExercises.map((e) => e.id)))
          console.log('[chat] resolveToolCall result:', resolved.kind, resolved.kind === 'card' ? resolved.cardState.kind : resolved.kind === 'error' ? resolved.message : '')
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
              await doStream(retryThread, savedConv, currentMode, currentGoals, currentModel, currentCustomExercises, currentProfile, currentPlan)
              return
            }
            // Retry cap reached — show error and keep input enabled.
            setToolCard({ kind: 'error', toolName: resolved.toolName, message: resolved.message })
          } else if (resolved.kind === 'execute') {
            try {
              const outcome = await executeToolAction(resolved.execution, {
                customExercises: currentCustomExercises,
                onExercisesChanged: (updated) => {
                  setCustomExercises(updated)
                  registerExerciseCatalog(updated)
                },
              })
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
                await doStream(threadWithNudge, savedConv, currentMode, currentGoals, currentModel, currentCustomExercises, currentProfile, currentPlan)
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
    await doStream(newThread, savedConv, mode, goals, model, customExercises, profile, trainingPlan)
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

    // If training plan exists and not pending review, switch to planning
    // Otherwise, stay in current mode so AI continues toward training plan
    const hasValidPlan = trainingPlan && !trainingPlan.pendingReview
    const nextMode: ConversationType = hasValidPlan ? 'planning' : mode
    const confirmMsg: Message = {
      role: 'assistant',
      content: hasValidPlan
        ? 'Great — your goals are saved. I\'m now building your workouts. You can ask me anytime to adjust any part of your plan.'
        : 'Great — your goals are saved. Now let\'s put together a training plan based on your profile and goals.',
    }
    const newMessages = [...messages, toolResult, confirmMsg]
    setMessages(newMessages)
    setToolCard(null)
    setPendingTool(null)
    setMode(nextMode)

    const savedConv = await persistConv(newMessages, conv, nextMode)
    fakeToolRetryRef.current = 0
    toolValidationRetryRef.current = 0
    await doStream(newMessages, savedConv, nextMode, newGoals, model, customExercises, profile, trainingPlan)
  }

  async function handleAcceptProfile(profilePayload: ProposeProfilePayload) {
    if (!pendingTool) return

    const now = new Date().toISOString()
    const newProfile = UserProfileSchema.parse({ ...profilePayload, updatedAt: now })
    await saveProfile(newProfile)
    setProfile(newProfile)

    // If a training plan exists, mark it for review since profile changed
    if (trainingPlan) {
      const updatedPlan = { ...trainingPlan, pendingReview: true, updatedAt: now }
      await saveTrainingPlan(updatedPlan)
      setTrainingPlan(updatedPlan)
    }

    const toolResult: Message = {
      role: 'tool',
      content: 'Profile accepted.',
      toolCallId: pendingTool.id,
    }
    const confirmMsg: Message = {
      role: 'assistant',
      content: goals
        ? 'Profile updated. Let\'s review your goals and training plan next.'
        : 'Profile saved! Now let\'s talk about your training goals.',
    }
    const newMessages = [...messages, toolResult, confirmMsg]
    setMessages(newMessages)
    setToolCard(null)
    setPendingTool(null)

    const savedConv = await persistConv(newMessages, conv, mode)
    fakeToolRetryRef.current = 0
    toolValidationRetryRef.current = 0
    await doStream(newMessages, savedConv, mode, goals, model, customExercises, newProfile, trainingPlan)
  }

  async function handleAcceptTrainingPlan(planPayload: ProposeTrainingPlanPayload) {
    if (!pendingTool) return

    const now = new Date().toISOString()
    const newPlan = TrainingPlanSchema.parse({
      ...planPayload,
      startDate: planPayload.startDate ?? getToday(),
      status: 'active',
      pendingReview: false,
      createdAt: now,
      updatedAt: now,
    })
    await saveTrainingPlan(newPlan)
    setTrainingPlan(newPlan)

    const toolResult: Message = {
      role: 'tool',
      content: 'Training plan accepted.',
      toolCallId: pendingTool.id,
    }
    const confirmMsg: Message = {
      role: 'assistant',
      content:
        `Your training plan "${newPlan.name}" is set. I'm now ready to build your workouts. ` +
        'You can ask me anytime to adjust your plan or schedule.',
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
    await doStream(newMessages, savedConv, nextMode, goals, model, customExercises, profile, newPlan)
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
    await doStream(newMessages, savedConv, mode, goals, model, customExercises, profile, trainingPlan)
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
      (toolCard?.kind === 'profile' || toolCard?.kind === 'goals' || toolCard?.kind === 'trainingPlan' || toolCard?.kind === 'workouts'))

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

      {/* Proposal panels are fixed above input so they are always visible/clickable */}
      {toolCard?.kind === 'profile' && (
        <div className="chat-tool-panel">
          <ProposeProfileCard
            profile={toolCard.profile}
            onAccept={() => handleAcceptProfile(toolCard.profile)}
            onRequestChanges={handleRequestChanges}
          />
        </div>
      )}

      {toolCard?.kind === 'goals' && (
        <div className="chat-tool-panel">
          <ProposeGoalsCard
            proposedText={toolCard.text}
            onAccept={() => handleAcceptGoals(toolCard.text)}
            onRequestChanges={handleRequestChanges}
          />
        </div>
      )}

      {toolCard?.kind === 'trainingPlan' && (
        <div className="chat-tool-panel">
          <ProposeTrainingPlanCard
            plan={toolCard.plan}
            onAccept={() => handleAcceptTrainingPlan(toolCard.plan)}
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
