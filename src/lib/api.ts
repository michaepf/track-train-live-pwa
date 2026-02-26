/**
 * OpenRouter streaming API client.
 *
 * Sends chat completions with optional tool use, streams response via SSE,
 * and delivers updates via callbacks.
 *
 * Reference: https://openrouter.ai/docs
 */

import { handle401 } from './auth.ts'
import type { Message, ThinkingBlock } from './schemas/index.ts'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// ─── Model config ──────────────────────────────────────────────────────────────

export const MODELS = {
  premium: 'anthropic/claude-sonnet-4.6',
  affordable: 'z-ai/glm-5',
} as const

export type ModelTier = keyof typeof MODELS

// ─── Public types ──────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** The final result delivered to onDone after streaming completes. */
export interface StreamResult {
  content: string
  toolCall?: {
    id: string
    name: string
    arguments: string // raw JSON string
  }
  /** Thinking blocks returned by Anthropic extended thinking. Stored for replay. */
  thinkingBlocks?: ThinkingBlock[]
}

export interface StreamChatOpts {
  apiKey: string
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } }
  systemPrompt: string
  onDelta: (text: string) => void
  onDone: (result: StreamResult) => void
  onError: (err: Error) => void
  /** Optional external abort signal (e.g. from unmounting component). */
  signal?: AbortSignal
}

// ─── Internal API message format ───────────────────────────────────────────────

type SystemContentPart = {
  type: 'text'
  text: string
  cache_control: { type: 'ephemeral' }
}

// Content block types used when extended thinking is enabled (Anthropic format).
type ThinkingContentBlock = { type: 'thinking'; thinking: string; signature: string }
type TextContentBlock = { type: 'text'; text: string }
type ToolUseContentBlock = { type: 'tool_use'; id: string; name: string; input: unknown }
type AssistantContentBlock = ThinkingContentBlock | TextContentBlock | ToolUseContentBlock

type ApiMessage =
  | { role: 'system'; content: SystemContentPart[] }
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: AssistantContentBlock[] }
  | {
      role: 'assistant'
      content: string | null
      tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * Convert our internal Message format to the OpenRouter/OpenAI wire format.
 * Wraps the system prompt in a content-part array with cache_control for
 * prompt caching on supported models.
 *
 * When a message has thinkingBlocks, uses the Anthropic content-array format
 * so thinking blocks are replayed verbatim (required by Anthropic's API).
 */
function buildApiMessages(systemPrompt: string, messages: Message[]): ApiMessage[] {
  const system: ApiMessage = {
    role: 'system',
    content: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
  }

  const converted: ApiMessage[] = messages.map((msg): ApiMessage => {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: msg.toolCallId ?? '',
        content: msg.content,
      }
    }

    // If the message has thinking blocks, use Anthropic content-array format.
    // Thinking blocks must be replayed verbatim (with signature) for the API to accept them.
    if (msg.role === 'assistant' && msg.thinkingBlocks && msg.thinkingBlocks.length > 0) {
      const blocks: AssistantContentBlock[] = msg.thinkingBlocks.map((tb) => ({
        type: 'thinking' as const,
        thinking: tb.thinking,
        signature: tb.signature,
      }))

      if (msg.toolCall) {
        let safeInput: unknown = {}
        try {
          safeInput = JSON.parse(msg.toolCall.arguments)
        } catch { /* leave as empty object */ }
        blocks.push({ type: 'tool_use', id: msg.toolCall.id, name: msg.toolCall.name, input: safeInput })
      } else {
        blocks.push({ type: 'text', text: msg.content })
      }

      return { role: 'assistant', content: blocks }
    }

    if (msg.role === 'assistant' && msg.toolCall) {
      // Guard against malformed arguments (e.g. partial streaming results stored from a
      // previous debug session). Providers validate historical tool call JSON strictly.
      let safeArguments = msg.toolCall.arguments
      try {
        JSON.parse(safeArguments)
      } catch {
        safeArguments = '{}'
      }
      return {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: msg.toolCall.id,
            type: 'function',
            function: {
              name: msg.toolCall.name,
              arguments: safeArguments,
            },
          },
        ],
      }
    }

    return { role: msg.role as 'user' | 'assistant', content: msg.content }
  })

  return [system, ...converted]
}

/** Returns true if the model supports extended thinking (Anthropic models only). */
function isAnthropicModel(model: string): boolean {
  return model.startsWith('anthropic/')
}

// ─── Streaming client ──────────────────────────────────────────────────────────

// TODO: Remove after debugging tool call issues. Set to true to use non-streaming
// mode which returns the full response at once, bypassing SSE parsing entirely.
const DEBUG_NON_STREAM = true

// TODO: Remove — logs every SSE delta to help debug streaming tool calls.
const DEBUG_LOG_SSE = false

/**
 * Send a chat request to OpenRouter and stream the response.
 *
 * Calls onDelta() for each text chunk, then onDone() with the full result
 * (content string + optional tool call). Calls onError() on network/API errors.
 * Returns without calling any callback if the request was aborted.
 *
 * On a 401, aborts the stream and calls handle401() (which redirects to login).
 * Callers must ensure no other streams are in flight before this redirect.
 */
export async function streamChat(opts: StreamChatOpts): Promise<void> {
  const {
    apiKey,
    model,
    messages,
    tools,
    toolChoice,
    systemPrompt,
    onDelta,
    onDone,
    onError,
    signal: externalSignal,
  } = opts

  console.log('[api] streamChat', { model, mode: DEBUG_NON_STREAM ? 'non-stream' : 'stream' })

  const internal = new AbortController()
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => internal.abort(), { once: true })
  }

  const body: Record<string, unknown> = {
    model,
    stream: DEBUG_NON_STREAM ? false : true,
    messages: buildApiMessages(systemPrompt, messages),
  }

  // Enable reasoning. Anthropic models use their own thinking parameter; all others use
  // OpenRouter's unified reasoning parameter (which GLM-5 and similar models support).
  if (isAnthropicModel(model)) {
    body.thinking = { type: 'enabled', budget_tokens: 8000 }
  } else {
    body.reasoning = { enabled: true }
  }

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
    if (toolChoice) {
      body.tool_choice = toolChoice
    }
  }

  let response: Response
  try {
    // TODO: Remove DEBUG_NON_STREAM block after debugging
    if (DEBUG_NON_STREAM) {
      const debugResponse = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Track Train Live',
        },
        body: JSON.stringify(body),
        signal: internal.signal,
      })

      if (debugResponse.status === 401) {
        internal.abort()
        await handle401()
        return
      }

      if (!debugResponse.ok) {
        let detail = `${debugResponse.status} ${debugResponse.statusText}`
        try {
          const errBody = await debugResponse.json()
          if (typeof errBody?.error?.message === 'string') detail = errBody.error.message
        } catch { /* ignore */ }
        onError(new Error(`API error: ${detail}`))
        return
      }

      const json = await debugResponse.json()
      console.log('[api] non-stream raw response:', JSON.stringify(json, null, 2))

      // OpenAI-compatible non-stream response shape.
      // When extended thinking is enabled, message.content is a content-block array
      // rather than a plain string.
      type RawContentBlock = {
        type: string
        text?: string
        thinking?: string
        signature?: string
        id?: string
        name?: string
        input?: unknown
      }
      type RawMessage = {
        content?: string | RawContentBlock[] | null
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
        reasoning?: string // OpenRouter unified reasoning field (GLM-5 and similar)
      }
      const message = (json as { choices?: { message?: RawMessage }[] }).choices?.[0]?.message

      let textContent = ''
      const thinkingBlocks: ThinkingBlock[] = []
      let embeddedToolCall: { id: string; name: string; arguments: string } | undefined

      if (Array.isArray(message?.content)) {
        for (const block of message.content as RawContentBlock[]) {
          if (block.type === 'thinking' && block.thinking && block.signature) {
            thinkingBlocks.push({ type: 'thinking', thinking: block.thinking, signature: block.signature })
          } else if (block.type === 'text' && block.text) {
            textContent = block.text
          } else if (block.type === 'tool_use' && block.id && block.name) {
            // Tool call embedded in content array (Anthropic format)
            embeddedToolCall = {
              id: block.id,
              name: block.name,
              arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
            }
          }
        }
      } else if (typeof message?.content === 'string') {
        textContent = message.content
      }

      // Also check OpenAI-format tool_calls (used when thinking is off or by non-Anthropic models)
      const rawToolCall = (message?.tool_calls?.[0] as { id?: string; function?: { name?: string; arguments?: string } } | undefined)
      const resolvedToolCall = embeddedToolCall ?? (rawToolCall?.id && rawToolCall.function?.name
        ? { id: rawToolCall.id, name: rawToolCall.function.name, arguments: rawToolCall.function.arguments ?? '' }
        : undefined)

      if (message?.reasoning) {
        console.log('[api] non-stream reasoning present, length:', message.reasoning.length)
      }
      console.log('[api] non-stream tool_call found:', !!resolvedToolCall, resolvedToolCall?.name ?? '(none)', 'thinking blocks:', thinkingBlocks.length)

      const result: StreamResult = {
        content: textContent,
        ...(resolvedToolCall ? { toolCall: resolvedToolCall } : {}),
        ...(thinkingBlocks.length > 0 ? { thinkingBlocks } : {}),
      }

      if (result.content) onDelta(result.content)
      onDone(result)
      return
    }
    // END DEBUG_NON_STREAM

    response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Track Train Live',
      },
      body: JSON.stringify(body),
      signal: internal.signal,
    })
  } catch (err) {
    if (internal.signal.aborted) return // aborted — not an error
    onError(new Error(`Network error: ${String(err)}`))
    return
  }

  if (response.status === 401) {
    // This is the only in-flight stream, so it's safe to redirect immediately.
    internal.abort()
    await handle401()
    return
  }

  if (!response.ok) {
    // Try to extract a human-readable error from the response body
    let detail = `${response.status} ${response.statusText}`
    try {
      const errBody = await response.json()
      if (typeof errBody?.error?.message === 'string') detail = errBody.error.message
    } catch {
      // ignore — use status text
    }
    onError(new Error(`API error: ${detail}`))
    return
  }

  if (!response.body) {
    onError(new Error('Response has no body'))
    return
  }

  // ─── SSE parsing ────────────────────────────────────────────────────────────

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let contentAccum = ''

  // Tool call state (we only handle one tool call per response)
  let toolCallId = ''
  let toolCallName = ''
  let toolCallArgs = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue // empty or SSE comment
        if (!trimmed.startsWith('data: ')) continue

        const data = trimmed.slice(6)
        if (data === '[DONE]') continue

        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          continue // malformed chunk — skip
        }

        const choices = (parsed as { choices?: unknown[] }).choices
        if (!Array.isArray(choices) || choices.length === 0) continue

        const delta = (choices[0] as { delta?: Record<string, unknown> }).delta
        if (!delta) continue

        // Text content delta
        if (typeof delta.content === 'string' && delta.content) {
          contentAccum += delta.content
          onDelta(delta.content)
        }

        // TODO: Remove SSE debug logging after diagnosing streaming tool call issue
        if (DEBUG_LOG_SSE) {
          console.log('[api] SSE delta:', JSON.stringify(delta))
        }

        // Tool call accumulation (deltas may come in pieces).
        // CONTRACT: Only the first tool call in a response is handled (index 0).
        // The app's tool definitions are designed so the model should never
        // emit more than one tool call per response turn.
        type ToolCallDelta = {
          index?: number
          id?: string
          function?: { name?: string; arguments?: string }
        }
        const toolCalls = delta.tool_calls as ToolCallDelta[] | undefined
        if (Array.isArray(toolCalls) && toolCalls[0]) {
          const tc = toolCalls[0]
          if (tc.id) toolCallId = tc.id
          if (tc.function?.name) toolCallName = tc.function.name
          if (tc.function?.arguments) toolCallArgs += tc.function.arguments
        }
      }
    }
  } catch (err) {
    if (internal.signal.aborted) return // aborted — not an error
    onError(new Error(`Stream read error: ${String(err)}`))
    return
  } finally {
    reader.releaseLock()
  }

  // TODO: Remove after debugging
  console.log('[api] stream complete', { contentAccum, toolCallId, toolCallName, toolCallArgs })

  const result: StreamResult = {
    content: contentAccum,
    ...(toolCallId
      ? { toolCall: { id: toolCallId, name: toolCallName, arguments: toolCallArgs } }
      : {}),
  }

  onDone(result)
}
