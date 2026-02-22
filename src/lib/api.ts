/**
 * OpenRouter streaming API client.
 *
 * Sends chat completions with optional tool use, streams response via SSE,
 * and delivers updates via callbacks.
 *
 * Reference: https://openrouter.ai/docs
 */

import { handle401 } from './auth.ts'
import type { Message } from './schemas/index.ts'

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
}

export interface StreamChatOpts {
  apiKey: string
  model: string
  messages: Message[]
  tools?: ToolDefinition[]
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

type ApiMessage =
  | { role: 'system'; content: SystemContentPart[] }
  | { role: 'user' | 'assistant'; content: string }
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

    if (msg.role === 'assistant' && msg.toolCall) {
      return {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: msg.toolCall.id,
            type: 'function',
            function: {
              name: msg.toolCall.name,
              arguments: msg.toolCall.arguments,
            },
          },
        ],
      }
    }

    return { role: msg.role as 'user' | 'assistant', content: msg.content }
  })

  return [system, ...converted]
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
  const { apiKey, model, messages, tools, systemPrompt, onDelta, onDone, onError, signal: externalSignal } = opts

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

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
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

      // OpenAI-compatible non-stream response shape
      const message = (json as { choices?: { message?: { content?: string | null; tool_calls?: unknown[] } }[] }).choices?.[0]?.message
      const content = message?.content ?? ''
      const rawToolCall = message?.tool_calls?.[0] as
        | { id?: string; function?: { name?: string; arguments?: string } }
        | undefined

      console.log('[api] non-stream tool_call found:', !!rawToolCall, rawToolCall?.function?.name ?? '(none)')

      const result: StreamResult = {
        content: typeof content === 'string' ? content : '',
        ...(rawToolCall?.id && rawToolCall.function?.name
          ? {
              toolCall: {
                id: rawToolCall.id,
                name: rawToolCall.function.name,
                arguments: rawToolCall.function.arguments ?? '',
              },
            }
          : {}),
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
