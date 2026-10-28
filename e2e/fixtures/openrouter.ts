import type { Page, Request } from '@playwright/test'
import { toSse, type ScriptedResponse } from './sse.ts'

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** What the app sent, parsed, for assertions. */
export interface RecordedRequest {
  model: string
  stream: boolean
  toolNames: string[]
  authorization: string | undefined
  body: Record<string, unknown>
}

/**
 * Intercept every request to openrouter.ai and answer it from a script, in order.
 *
 * Nothing reaches the network. A request beyond the end of the script, or to any
 * other OpenRouter path, gets a 500 and is recorded in `unexpected` so the test
 * can fail with a clear message instead of hanging.
 */
export async function mockOpenRouter(page: Page, script: ScriptedResponse[]) {
  const queue = [...script]
  const requests: RecordedRequest[] = []
  const unexpected: string[] = []

  await page.route('https://openrouter.ai/**', async (route) => {
    const request: Request = route.request()
    if (request.url() !== OPENROUTER_URL || request.method() !== 'POST' || queue.length === 0) {
      unexpected.push(`${request.method()} ${request.url()}${queue.length === 0 ? ' (script exhausted)' : ''}`)
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"unexpected e2e request"}}' })
      return
    }
    const body = request.postDataJSON() as Record<string, unknown>
    const tools = (body.tools as { function?: { name?: string } }[] | undefined) ?? []
    requests.push({
      model: String(body.model),
      stream: body.stream === true,
      toolNames: tools.map((t) => t.function?.name ?? ''),
      authorization: request.headers()['authorization'],
      body,
    })
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: toSse(queue.shift() as ScriptedResponse),
    })
  })

  return { requests, unexpected, remaining: () => queue.length }
}
