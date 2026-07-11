import { useState, useEffect, useRef } from 'react'
import { streamChat, MODELS, MODEL_DISPLAY_NAMES } from '../lib/api.ts'
import type { ModelTier } from '../lib/api.ts'
import { registerExerciseCatalog } from '../data/exercises.ts'
import {
  buildSystemPrompt,
  buildHistoryContext,
  buildUpcomingPlannedContext,
  needsGoalReview,
  needsPlanReview,
  getWeekKey,
  RECENT_HISTORY_DAYS,
} from '../lib/context.ts'
import { useApiKey } from '../App.tsx'
import {
  getGoals,
  getProfile,
  getTrainingPlan,
  saveConversation,
  listConversations,
  listWorkouts,
  getSummary,
  getSetting,
  setSetting,
  getCustomExercises,
} from '../lib/db.ts'
import type { Exercise } from '../data/exercises.ts'
import type {
  Goals,
  UserProfile,
  TrainingPlan,
  Conversation,
  Message,
  ConversationType,
} from '../lib/schemas/index.ts'
import type { StreamResult } from '../lib/api.ts'
import {
  ProposeProfileCard,
  ProposeGoalsCard,
  ProposeTrainingPlanCard,
  ProposeWorkoutCard,
} from '../components/ToolCard.tsx'
import MarkdownText from '../components/MarkdownText.tsx'
import { ToolActivity } from '../components/ToolActivity.tsx'
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
} from '../lib/chatTools.ts'
import type { PendingTool, ToolCardState } from '../lib/chatTools.ts'
import { executeToolAction, buildEditWorkoutFollowupPrompt, buildSwapExerciseFollowupPrompt, buildDeleteFutureWorkoutsFollowupPrompt } from '../lib/toolExecutors.ts'
import { runToolOperation } from '../lib/toolRuntime.ts'
import type { ToolActivityViewModel, ToolRecoveryAction, ToolRetryCounts } from '../lib/toolRuntime.ts'
import { useProposalActions } from '../hooks/useProposalActions.ts'

const MAX_FAKE_TOOL_RETRIES = 2
const ONBOARDING_WELCOME_MESSAGE = `Welcome to Rubato Coach! I'm your AI personal trainer.

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
  /** 'overlay' renders as a floating bottom-sheet (see App.tsx's chat bubble) instead of filling the screen. */
  variant?: 'full' | 'overlay'
  /** Only used when variant is 'overlay' — closes the sheet without leaving the current screen. */
  onClose?: () => void
}

type ChatRecoveryAction = ToolRecoveryAction | 'retry_stream'

export default function Chat({ onStreamingChange, onNewResponse, isActive = true, seedMessage, onSeedConsumed, variant = 'full', onClose }: ChatProps) {
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

  const [input, setInput] = useState('')
  const [toolCard, setToolCard] = useState<ToolCardState | null>(null)
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null)
  const [toolActivity, setToolActivity] = useState<ToolActivityViewModel | null>(null)
  const [toolRecoveryAction, setToolRecoveryAction] = useState<ChatRecoveryAction | null>(null)

  const [menuOpen, setMenuOpen] = useState(false)
  const [resetArmed, setResetArmed] = useState(false)

  const [initialized, setInitialized] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const consumingSeedRef = useRef(false)
  const isActiveRef = useRef(isActive)
  const fakeToolRetryRef = useRef(0)
  const toolRetryCountsRef = useRef<ToolRetryCounts>({ validation: 0, execution: 0 })

  const {
    busy: toolActionBusy,
    acceptGoals: handleAcceptGoals,
    acceptProfile: handleAcceptProfile,
    acceptTrainingPlan: handleAcceptTrainingPlan,
    acceptWorkouts: handleAcceptWorkouts,
    requestChanges: handleRequestChanges,
    resetAcceptedWorkoutCount,
  } = useProposalActions({
    pendingTool,
    setPendingTool,
    setToolCard,
    messages,
    setMessages,
    conv,
    setConv,
    mode,
    setMode,
    goals,
    setGoals,
    profile,
    setProfile,
    trainingPlan,
    setTrainingPlan,
    model,
    customExercises,
    setToolActivity,
    clearToolRecovery: () => setToolRecoveryAction(null),
    resetToolRetries: () => {
      fakeToolRetryRef.current = 0
      toolRetryCountsRef.current = { validation: 0, execution: 0 }
    },
    persistConversation: persistConv,
    stream: doStream,
  })

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

  // Jump to the latest message whenever the chat becomes visible again
  // (e.g. the overlay is opened, or the Chat tab is switched to).
  useEffect(() => {
    if (isActive) bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [isActive])

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
    if (toolActivity?.status !== 'succeeded') return
    const timeout = window.setTimeout(() => setToolActivity(null), 4500)
    return () => window.clearTimeout(timeout)
  }, [toolActivity])

  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

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
    const seed = seedMessage
    if (!seed) {
      consumingSeedRef.current = false
      return
    }
    if (!initialized || streaming || !model || consumingSeedRef.current) return
    consumingSeedRef.current = true
    // Clear the App-owned seed immediately. Chat normally remains mounted while
    // hidden, so seeds must be consumed when the prop changes, not only on mount.
    onSeedConsumed?.()
    const instruction: Message = {
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
    const userMsg: Message = { role: 'user', content: seed }
    const thread: Message[] = [...messages, instruction, userMsg]
    setMessages(thread)
    const capturedGoals = goals
    const capturedMode = mode
    const capturedModel = model
    persistConv(thread, conv, capturedMode).then((savedConv) => {
      doStream(thread, savedConv, capturedMode, capturedGoals, capturedModel, customExercises, profile, trainingPlan)
    })
    // Intentionally omit doStream/persistConv — stable within this effect's lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, seedMessage, streaming, model, messages, onSeedConsumed])

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
          const runtimeResult = await runToolOperation({
            toolCall: tc,
            customExerciseIds: new Set(currentCustomExercises.map((exercise) => exercise.id)),
            retries: toolRetryCountsRef.current,
            execute: (execution) => executeToolAction(execution, {
              customExercises: currentCustomExercises,
              onExercisesChanged: (updated) => {
                setCustomExercises(updated)
                registerExerciseCatalog(updated)
              },
            }),
            onActivity: (activity) => {
              setToolActivity(activity)
              setToolRecoveryAction(null)
            },
          })

          if (runtimeResult.kind === 'retry_model') {
            toolRetryCountsRef.current = runtimeResult.retries
            setToolActivity(runtimeResult.activity)
            setToolRecoveryAction(null)
            finalMessages = [
              ...finalMessages,
              { role: 'tool', content: runtimeResult.toolResult, toolCallId: tc.id },
            ]
            const retryThread: Message[] = [
              ...finalMessages,
              { role: 'user', hidden: true, content: runtimeResult.instruction },
            ]
            setMessages(retryThread)
            const savedConv = await persistConv(retryThread, currentConv, currentMode)
            await doStream(retryThread, savedConv, currentMode, currentGoals, currentModel, currentCustomExercises, currentProfile, currentPlan)
            return
          }

          if (runtimeResult.kind === 'awaiting_approval') {
            toolRetryCountsRef.current = { validation: 0, execution: 0 }
            if (runtimeResult.cardState.kind === 'workouts') resetAcceptedWorkoutCount()
            setPendingTool(tc)
            setToolCard(runtimeResult.cardState)
            setToolActivity(runtimeResult.activity)
            setToolRecoveryAction(null)
            // Do not append a tool result until the user accepts or requests changes.
          } else {
            finalMessages = [
              ...finalMessages,
              { role: 'tool', content: runtimeResult.toolResult, toolCallId: tc.id },
            ]
            setToolActivity(runtimeResult.activity)
            toolRetryCountsRef.current = { validation: 0, execution: 0 }

            if (runtimeResult.kind === 'terminal_failure') {
              setToolRecoveryAction(runtimeResult.recoveryAction ?? null)
            } else {
              setToolRecoveryAction(null)
              const executionKind = runtimeResult.outcome.operation
              if (
                executionKind === 'edit_workout' ||
                executionKind === 'swap_exercise' ||
                executionKind === 'delete_future_workouts'
              ) {
                const followupPrompt =
                  executionKind === 'edit_workout'
                    ? buildEditWorkoutFollowupPrompt(runtimeResult.outcome)
                    : executionKind === 'swap_exercise'
                      ? buildSwapExerciseFollowupPrompt(runtimeResult.outcome)
                      : buildDeleteFutureWorkoutsFollowupPrompt(runtimeResult.outcome)
                const threadWithNudge: Message[] = [
                  ...finalMessages,
                  { role: 'user', hidden: true, content: followupPrompt },
                ]
                setMessages(finalMessages)
                const savedConv = await persistConv(threadWithNudge, currentConv, currentMode)
                await doStream(threadWithNudge, savedConv, currentMode, currentGoals, currentModel, currentCustomExercises, currentProfile, currentPlan)
                return
              }
            }
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
          if (fakeToolRetryRef.current < MAX_FAKE_TOOL_RETRIES) {
            fakeToolRetryRef.current += 1
            setToolActivity({
              status: 'failed',
              message: 'The trainer described a change but did not send it to the app.',
              nextStep: 'Press Send to ask the trainer to submit the change correctly.',
            })
            setToolRecoveryAction(null)

            // Queue a strict follow-up prompt in the input instead of auto-retrying.
            // This keeps the UI responsive and avoids retry loops that feel frozen.
            setInput(
              currentMode === 'planning'
                ? 'Please emit an actual propose_workout tool call now. Do not describe the tool call in plain text.'
                : 'Please emit an actual propose_goals tool call now. Do not describe the tool call in plain text.',
            )
            return
          }

          setToolActivity({
            status: 'failed',
            message: 'The trainer could not submit the requested change.',
            nextStep: 'Rephrase the request or ask the trainer to try another approach.',
          })
          setToolRecoveryAction('ask_trainer')
          return
        }

      },

      onError: (err: Error) => {
        console.error('[chat] stream error:', err)
        setStreamingContent('')
        setStreaming(false)
        setToolActivity({
          status: 'failed',
          message: "The trainer's response was interrupted.",
          nextStep: 'Try sending the last message again.',
        })
        setToolRecoveryAction('retry_stream')
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

    setToolActivity(null)
    setToolRecoveryAction(null)
    const userMsg: Message = { role: 'user', content: text }
    const newThread = [...messages, userMsg]
    setMessages(newThread)
    setInput('')
    toolRetryCountsRef.current = { validation: 0, execution: 0 }

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

  async function handleActivityRecovery() {
    if (!toolRecoveryAction || streaming) return

    if (toolRecoveryAction === 'retry_stream') {
      setToolActivity(null)
      setToolRecoveryAction(null)
      const savedConv = await persistConv(messages, conv, mode)
      await doStream(messages, savedConv, mode, goals, model, customExercises, profile, trainingPlan)
      return
    }

    setInput(
      toolRecoveryAction === 'retry_tool'
        ? 'Please check the current data and try that operation again. Tell me clearly if it still cannot be completed.'
        : 'Please check my current plan and try the change another way.',
    )
    setToolRecoveryAction(null)
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
    setToolCard(null)
    setPendingTool(null)
    setToolActivity(null)
    setToolRecoveryAction(null)
    setStreaming(false)
    fakeToolRetryRef.current = 0
    toolRetryCountsRef.current = { validation: 0, execution: 0 }
    resetAcceptedWorkoutCount()
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

  const activeToolActivity =
    toolActivity?.status === 'running' || toolActivity?.status === 'correcting'
  const recoveryAction = toolRecoveryAction
    ? {
        label: toolRecoveryAction === 'retry_stream'
          ? 'Resend'
          : toolRecoveryAction === 'retry_tool'
            ? 'Try again'
            : 'Ask trainer',
        onSelect: handleActivityRecovery,
        disabled: streaming,
      }
    : undefined

  return (
    <div className={`chat-screen${variant === 'overlay' ? ' chat-screen--overlay' : ''}`}>
      {/* Header */}
      <div className="chat-header">
        {variant === 'overlay' ? (
          <span className="chat-mode-label">Chat</span>
        ) : (
          <h1 className="tab-header-title">Chat</h1>
        )}
        <div className="chat-header-right">
          {variant === 'overlay' && (
            <button className="chat-close-btn" onClick={onClose} aria-label="Close chat">
              ✕
            </button>
          )}
          <button className="chat-menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Chat options">
            ⋮
          </button>
          {menuOpen && (
            <>
              <div className="chat-menu-backdrop" onClick={closeMenu} />
              <div className="chat-menu-dropdown">
                {variant !== 'overlay' && (
                  <>
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
                          {MODEL_DISPLAY_NAMES[tier]}
                        </span>
                      </button>
                    ))}
                    <div className="chat-menu-divider" />
                  </>
                )}
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
        {streaming && !streamingContent && !activeToolActivity && (
          <div className="chat-message chat-message--assistant">
            <div className="chat-bubble chat-bubble--thinking">
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
            </div>
          </div>
        )}

        {toolActivity && (
          <div className="chat-tool-activity-row">
            <ToolActivity activity={toolActivity} recoveryAction={recoveryAction} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Proposal panels are fixed above input so they are always visible/clickable */}
      {toolCard?.kind === 'profile' && (
        <div className="chat-tool-panel">
          <ProposeProfileCard
            profile={toolCard.profile}
            onAccept={() => handleAcceptProfile(toolCard.profile)}
            onRequestChanges={handleRequestChanges}
            disabled={toolActionBusy}
          />
        </div>
      )}

      {toolCard?.kind === 'goals' && (
        <div className="chat-tool-panel">
          <ProposeGoalsCard
            proposedText={toolCard.text}
            onAccept={() => handleAcceptGoals(toolCard.text)}
            onRequestChanges={handleRequestChanges}
            disabled={toolActionBusy}
          />
        </div>
      )}

      {toolCard?.kind === 'trainingPlan' && (
        <div className="chat-tool-panel">
          <ProposeTrainingPlanCard
            plan={toolCard.plan}
            onAccept={() => handleAcceptTrainingPlan(toolCard.plan)}
            onRequestChanges={handleRequestChanges}
            disabled={toolActionBusy}
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
