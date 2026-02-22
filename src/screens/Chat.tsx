import { useState, useEffect, useRef } from 'react'
import { streamChat, MODELS } from '../lib/api.ts'
import { buildSystemPrompt, buildHistoryContext, needsGoalReview, getWeekKey } from '../lib/context.ts'
import { useApiKey } from '../App.tsx'
import {
  getGoals,
  saveGoals,
  saveConversation,
  listConversations,
  listWorkouts,
  getSummary,
  getSetting,
} from '../lib/db.ts'
import { GoalsSchema, ProposeGoalsPayloadSchema } from '../lib/schemas/index.ts'
import type { Goals, Conversation, Message, ConversationType } from '../lib/schemas/index.ts'
import type { StreamResult } from '../lib/api.ts'
import { ProposeGoalsCard, ToolErrorCard } from '../components/ToolCard.tsx'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type PendingTool = {
  id: string
  name: string
  arguments: string
}

type ToolCardState =
  | { kind: 'goals'; text: string }
  | { kind: 'error'; toolName: string; message: string }

const MAX_FAKE_TOOL_RETRIES = 2

function looksLikeFakeToolNarration(text: string): boolean {
  const t = text.toLowerCase()
  return (
    t.includes('propose_goals') ||
    t.includes('calling the tool') ||
    t.includes('call the tool') ||
    t.includes('function propose_goals')
  )
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
function resolveToolCall(tc: PendingTool):
  | { kind: 'card'; cardState: ToolCardState }
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
  // Unknown tool — auto-error so input never deadlocks
  return { kind: 'error', message: `Unknown tool: ${tc.name}`, toolName: tc.name }
}

// ─── Message rendering ─────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  // Tool result messages are not shown in the UI
  if (message.role === 'tool') return null
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

export default function Chat() {
  const apiKey = useApiKey()

  const [goals, setGoals] = useState<Goals | null>(null)
  const [conv, setConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [mode, setMode] = useState<ConversationType>('planning')
  const [model, setModel] = useState('')

  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)

  const [input, setInput] = useState('')
  const [toolCard, setToolCard] = useState<ToolCardState | null>(null)
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null)

  const [initialized, setInitialized] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fakeToolRetryRef = useRef(0)

  // ─── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      const [goalsData, modelSetting, conversations] = await Promise.all([
        getGoals(),
        getSetting('model'),
        listConversations(20),
      ])

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

  // Safety net: if pendingTool exists but no actionable goals card is visible,
  // clear pending state so input never stays locked.
  useEffect(() => {
    console.log('[chat] safety-net effect', { hasPendingTool: !!pendingTool, toolCardKind: toolCard?.kind })
    if (pendingTool && toolCard?.kind !== 'goals') {
      console.log('[chat] safety-net CLEARING pendingTool')
      setPendingTool(null)
    }
  }, [pendingTool, toolCard])

  // Auto-start greeting for onboarding and goal_review with empty thread
  useEffect(() => {
    console.log('[chat] auto-start check', { initialized, mode, model, messageCount: messages.length, streaming, apiKey: !!apiKey })
    if (
      initialized &&
      (mode === 'onboarding' || mode === 'goal_review') &&
      messages.length === 0 &&
      !streaming &&
      model
    ) {
      // Capture current state values at effect time to pass explicitly
      const capturedGoals = goals
      const capturedMode = mode
      const capturedModel = model
      doStream([], null, capturedMode, capturedGoals, capturedModel)
    }
    // Intentionally omit doStream — stable within this effect's lifecycle
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
  ) {
    if (!apiKey || !currentModel) {
      console.log('[chat] doStream early return — missing apiKey or model', { hasApiKey: !!apiKey, currentModel })
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
    if (currentMode === 'planning') {
      const recentWorkouts = await listWorkouts(30)
      const summaryMap = new Map<string, string>()
      // Load summaries for weeks older than 3 weeks (recentWorkouts is sorted desc)
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 21)
      const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: tz })
      const olderWeekKeys = [
        ...new Set(
          recentWorkouts.filter((w) => w.date < cutoffStr).map((w) => getWeekKey(w.date)),
        ),
      ]
      for (const wk of olderWeekKeys) {
        const summary = await getSummary(wk)
        if (summary) summaryMap.set(wk, summary)
      }
      historyContext = buildHistoryContext(recentWorkouts, summaryMap)
    }

    const tools =
      currentMode === 'onboarding' || currentMode === 'goal_review' ? [PROPOSE_GOALS_TOOL] : []

    await streamChat({
      apiKey,
      model: currentModel,
      messages: thread,
      tools,
      systemPrompt: buildSystemPrompt(currentGoals, currentMode, historyContext),
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

        const assistantMsg: Message = result.toolCall
          ? { role: 'assistant', content: result.content, toolCall: result.toolCall }
          : { role: 'assistant', content: result.content }

        // Build the final thread in one pass before persisting
        let finalMessages: Message[] = [...thread, assistantMsg]

        if (result.toolCall) {
          const tc: PendingTool = result.toolCall
          const resolved = resolveToolCall(tc)
          console.log('[chat] onDone resolveToolCall:', resolved.kind, resolved.kind === 'error' ? resolved.message : resolved.cardState)

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
            // pendingTool stays null — no user interaction needed
          } else {
            // Valid tool call — user must accept or reject before thread continues
            console.log('[chat] onDone setting pendingTool + toolCard (goals)')
            setPendingTool(tc)
            setToolCard(resolved.cardState)
            // Do NOT append a tool result yet; that happens on accept/reject
          }
        }

        setMessages(finalMessages)
        const savedConv = await persistConv(finalMessages, currentConv, currentMode)

        // Keep onboarding/goal-review conversational, but recover if the model
        // narrates a fake tool call in plain text instead of emitting tool_calls.
        if (
          !result.toolCall &&
          (currentMode === 'onboarding' || currentMode === 'goal_review') &&
          looksLikeFakeToolNarration(result.content)
        ) {
          if (fakeToolRetryRef.current < MAX_FAKE_TOOL_RETRIES) {
            fakeToolRetryRef.current += 1
            setToolCard({
              kind: 'error',
              toolName: 'propose_goals',
              message:
                'Model narrated a tool call instead of emitting one. Press Send to retry with a strict tool-call request.',
            })

            // Queue a strict follow-up prompt in the input instead of auto-retrying.
            // This keeps the UI responsive and avoids retry loops that feel frozen.
            setInput(
              'Please emit an actual propose_goals tool call now. Do not describe the tool call in plain text.',
            )
            return
          }

          setToolCard({
            kind: 'error',
            toolName: 'propose_goals',
            message:
              'Model did not emit a real tool call. Send a message asking it to call propose_goals.',
          })
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

    const savedConv = await persistConv(newThread, conv, mode)
    await doStream(newThread, savedConv, mode, goals, model)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
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
    const newMessages = [...messages, toolResult]
    setMessages(newMessages)
    setToolCard(null)
    setPendingTool(null)

    const nextMode: ConversationType = 'planning'
    setMode(nextMode)

    const savedConv = await persistConv(newMessages, conv, nextMode)
    fakeToolRetryRef.current = 0
    // Continue — model acknowledges acceptance
    await doStream(newMessages, savedConv, nextMode, newGoals, model)
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
    await doStream(newMessages, savedConv, mode, goals, model)
  }

  // ─── New conversation ─────────────────────────────────────────────────────────

  function handleNewConversation() {
    abortRef.current?.abort()
    setConv(null)
    setMessages([])
    setStreamingContent('')
    setStreamError(null)
    setToolCard(null)
    setPendingTool(null)
    setStreaming(false)
    fakeToolRetryRef.current = 0
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  const inputPlaceholder =
    mode === 'onboarding'
      ? 'Tell me about yourself…'
      : mode === 'goal_review'
        ? 'Discuss your goals…'
        : 'Ask your trainer…'

  const inputDisabled = streaming || (pendingTool !== null && toolCard?.kind === 'goals')

  return (
    <div className="chat-screen">
      {/* Header */}
      <div className="chat-header">
        <span className="chat-mode-label">
          {mode === 'onboarding' ? 'Setup' : mode === 'goal_review' ? 'Goal Review' : 'Planning'}
        </span>
        {messages.length > 0 && (
          <button className="chat-new-btn" onClick={handleNewConversation}>
            New
          </button>
        )}
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
