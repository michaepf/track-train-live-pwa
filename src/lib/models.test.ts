import committedModels from '../../config/models.json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUILT_IN_MODELS_CONFIG,
  MODELS_CONFIG_URL,
  _resetModelsConfig,
  fetchModelsConfig,
  loadModelsConfig,
  parseModelsConfig,
  resolveModelChoice,
  type ModelsConfig,
} from './models.ts'

const REMOTE: ModelsConfig = {
  default: 'anthropic/claude-sonnet-5',
  models: [
    { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Premium' },
    { id: 'z-ai/glm-5.2:nitro', label: 'GLM 5.2' },
    { id: 'openai/gpt-6.1-sol', label: 'GPT 6.1 Sol', note: 'Trying it out' },
  ],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  _resetModelsConfig()
  vi.restoreAllMocks()
})

describe('parseModelsConfig', () => {
  it('accepts a valid list', () => {
    expect(parseModelsConfig(REMOTE)).toEqual(REMOTE)
  })

  it('accepts the committed config/models.json and the built-in list', () => {
    expect(parseModelsConfig(committedModels)).not.toBeNull()
    expect(parseModelsConfig(BUILT_IN_MODELS_CONFIG)).toEqual(BUILT_IN_MODELS_CONFIG)
  })

  it.each([
    ['not an object', 'models'],
    ['missing default', { models: REMOTE.models }],
    ['empty list', { default: 'x', models: [] }],
    ['default not in the list', { ...REMOTE, default: 'missing/model' }],
    ['duplicate ids', { default: 'a/b', models: [{ id: 'a/b', label: 'A' }, { id: 'a/b', label: 'A again' }] }],
    ['blank id', { default: ' ', models: [{ id: ' ', label: 'Blank' }] }],
    ['missing label', { default: 'a/b', models: [{ id: 'a/b' }] }],
  ])('rejects %s', (_name, raw) => {
    expect(parseModelsConfig(raw)).toBeNull()
  })
})

describe('fetchModelsConfig', () => {
  it('uses the remote file when it is valid', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(REMOTE))
    await expect(fetchModelsConfig(fetchImpl as unknown as typeof fetch)).resolves.toEqual({ config: REMOTE, source: 'remote' })
    expect(fetchImpl).toHaveBeenCalledWith(MODELS_CONFIG_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it.each([
    ['a network error', async () => { throw new TypeError('Failed to fetch') }],
    ['an HTTP error', async () => jsonResponse({}, 404)],
    ['invalid JSON', async () => new Response('{not json', { status: 200 })],
    ['a file that fails validation', async () => jsonResponse({ default: 'x', models: [] })],
  ])('falls back to the built-in list on %s', async (_name, impl) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await fetchModelsConfig(vi.fn(impl) as unknown as typeof fetch)
    expect(result).toEqual({ config: BUILT_IN_MODELS_CONFIG, source: 'built-in' })
  })

  it('falls back when the fetch hangs past the timeout', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hanging = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
    const result = await fetchModelsConfig(hanging as unknown as typeof fetch, 10)
    expect(result.source).toBe('built-in')
  })
})

describe('loadModelsConfig', () => {
  it('fetches once per app session', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(REMOTE))
    const [a, b] = await Promise.all([loadModelsConfig(), loadModelsConfig()])
    expect(a).toBe(b)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('resolveModelChoice', () => {
  it('keeps a saved id that is in the list', () => {
    expect(resolveModelChoice('openai/gpt-6.1-sol', REMOTE)).toBe('openai/gpt-6.1-sol')
  })

  it.each([
    ['unset', null],
    ['empty', ''],
    ['removed from the file', 'meta/llama-9'],
    ['the legacy premium tier', 'premium'],
    ['the legacy affordable tier', 'affordable'],
  ])('falls back to the default when the saved value is %s', (_name, saved) => {
    expect(resolveModelChoice(saved, REMOTE)).toBe('anthropic/claude-sonnet-5')
  })
})
