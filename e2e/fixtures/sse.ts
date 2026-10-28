/**
 * Builders for OpenRouter-shaped streaming responses (OpenAI-compatible SSE).
 *
 * Each response is a list of `data: {json}` chunks whose `choices[0].delta`
 * carries either text (`content`) or a piece of a tool call (`tool_calls`),
 * ending with `data: [DONE]`. That is the only shape src/lib/api.ts reads.
 */

export type ScriptedResponse =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; name: string; arguments: unknown; text?: string; id?: string }

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  const body = {
    id: 'gen-e2e',
    object: 'chat.completion.chunk',
    model: 'e2e-fixture',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
  return `data: ${JSON.stringify(body)}\n\n`
}

/** Split a string into a few pieces so the client exercises delta accumulation. */
function pieces(text: string, size = 24): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out.length ? out : ['']
}

export function toSse(response: ScriptedResponse): string {
  const parts: string[] = [': OPENROUTER PROCESSING\n\n', chunk({ role: 'assistant', content: '' })]
  if (response.kind === 'text') {
    for (const piece of pieces(response.text)) parts.push(chunk({ content: piece }))
    parts.push(chunk({}, 'stop'))
  } else {
    if (response.text) for (const piece of pieces(response.text)) parts.push(chunk({ content: piece }))
    const id = response.id ?? `call_e2e_${response.name}`
    const args = JSON.stringify(response.arguments)
    parts.push(chunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name: response.name, arguments: '' } }] }))
    for (const piece of pieces(args, 40)) {
      parts.push(chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }))
    }
    parts.push(chunk({}, 'tool_calls'))
  }
  parts.push('data: [DONE]\n\n')
  return parts.join('')
}
