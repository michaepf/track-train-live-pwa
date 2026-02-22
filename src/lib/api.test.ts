import { describe, it, expect, vi, beforeEach } from 'vitest'
import { streamChat } from './api.ts'
import { handle401 } from './auth.ts'

// Mock the auth module — we want to verify handle401 is called without actually redirecting
vi.mock('./auth.ts', () => ({
  handle401: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
}))

// Stub window.location.origin used in HTTP-Referer header
vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })

// ─── Shared test fixtures ──────────────────────────────────────────────────────

const BASE_OPTS = {
  apiKey: 'sk-or-test',
  model: 'test-model',
  messages: [] as [],
  systemPrompt: 'You are a trainer.',
  onDelta: vi.fn(),
  onDone: vi.fn(),
  onError: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── 401 handling ─────────────────────────────────────────────────────────────

describe('streamChat — 401 response', () => {
  it('calls handle401 and does not call onDone or onError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
    }))

    await streamChat({ ...BASE_OPTS })

    expect(handle401).toHaveBeenCalledOnce()
    expect(BASE_OPTS.onDone).not.toHaveBeenCalled()
    expect(BASE_OPTS.onError).not.toHaveBeenCalled()
  })
})

// ─── Network errors ───────────────────────────────────────────────────────────

describe('streamChat — network errors', () => {
  it('calls onError when fetch throws (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')))

    await streamChat({ ...BASE_OPTS })

    expect(BASE_OPTS.onError).toHaveBeenCalledOnce()
    const err: Error = BASE_OPTS.onError.mock.calls[0][0]
    expect(err.message).toMatch(/Network error/)
    expect(BASE_OPTS.onDone).not.toHaveBeenCalled()
  })

  it('calls onError on non-401 API error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 429,
      statusText: 'Too Many Requests',
      ok: false,
      json: vi.fn().mockRejectedValue(new Error('not json')),
    }))

    await streamChat({ ...BASE_OPTS })

    expect(BASE_OPTS.onError).toHaveBeenCalledOnce()
    const err: Error = BASE_OPTS.onError.mock.calls[0][0]
    expect(err.message).toMatch(/429/)
    expect(BASE_OPTS.onDone).not.toHaveBeenCalled()
  })

  it('uses error message from response JSON when available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 400,
      statusText: 'Bad Request',
      ok: false,
      json: vi.fn().mockResolvedValue({ error: { message: 'Invalid model name' } }),
    }))

    await streamChat({ ...BASE_OPTS })

    const err: Error = BASE_OPTS.onError.mock.calls[0][0]
    expect(err.message).toContain('Invalid model name')
  })
})

// ─── Abort ────────────────────────────────────────────────────────────────────

describe('streamChat — abort', () => {
  it('does not call onDone or onError when aborted before fetch resolves', async () => {
    const controller = new AbortController()

    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      // Abort happens during "fetch" — simulates user navigating away
      controller.abort()
      const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      return Promise.reject(err)
    }))

    await streamChat({ ...BASE_OPTS, signal: controller.signal })

    expect(BASE_OPTS.onDone).not.toHaveBeenCalled()
    expect(BASE_OPTS.onError).not.toHaveBeenCalled()
    expect(handle401).not.toHaveBeenCalled()
  })
})

// ─── Successful stream ────────────────────────────────────────────────────────

/**
 * Helper to create a ReadableStream that emits SSE-format chunks.
 */
function makeSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'))
      }
      controller.close()
    },
  })
}

describe('streamChat — successful stream', () => {
  it('calls onDelta for each text chunk and onDone with accumulated content', async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":", world"}}]}',
      'data: [DONE]',
    ]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSSEStream(sseLines),
    }))

    await streamChat({ ...BASE_OPTS })

    expect(BASE_OPTS.onDelta).toHaveBeenCalledTimes(2)
    expect(BASE_OPTS.onDelta).toHaveBeenNthCalledWith(1, 'Hello')
    expect(BASE_OPTS.onDelta).toHaveBeenNthCalledWith(2, ', world')

    expect(BASE_OPTS.onDone).toHaveBeenCalledOnce()
    const result = BASE_OPTS.onDone.mock.calls[0][0]
    expect(result.content).toBe('Hello, world')
    expect(result.toolCall).toBeUndefined()
  })

  it('accumulates tool call arguments across delta chunks and returns in onDone', async () => {
    const sseLines = [
      // First chunk: tool call id + function name + first arg fragment
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"propose_goals","arguments":""}}]}}]}',
      // Subsequent chunks: argument fragments
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"text\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"My goals\\"}"}}]}}]}',
      'data: [DONE]',
    ]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSSEStream(sseLines),
    }))

    await streamChat({ ...BASE_OPTS })

    expect(BASE_OPTS.onDone).toHaveBeenCalledOnce()
    const result = BASE_OPTS.onDone.mock.calls[0][0]
    expect(result.toolCall).toMatchObject({
      id: 'call_abc',
      name: 'propose_goals',
      arguments: '{"text":"My goals"}',
    })
  })

  it('skips malformed JSON chunks without throwing', async () => {
    const sseLines = [
      'data: not-valid-json',
      'data: {"choices":[{"delta":{"content":"OK"}}]}',
      'data: [DONE]',
    ]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSSEStream(sseLines),
    }))

    await streamChat({ ...BASE_OPTS })

    expect(BASE_OPTS.onDone).toHaveBeenCalledOnce()
    expect(BASE_OPTS.onDone.mock.calls[0][0].content).toBe('OK')
  })

  it('ignores SSE comment lines (starting with :)', async () => {
    const sseLines = [
      ': keep-alive',
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: [DONE]',
    ]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeSSEStream(sseLines),
    }))

    await streamChat({ ...BASE_OPTS })

    expect(BASE_OPTS.onDone.mock.calls[0][0].content).toBe('hi')
  })
})
