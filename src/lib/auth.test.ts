import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleCallback, isCallbackUrl, AuthError } from './auth.ts'
import { setSetting } from './db.ts'

// Mock the DB layer so auth tests don't need a real IndexedDB
vi.mock('./db.ts', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
  setSetting: vi.fn().mockResolvedValue(undefined),
  deleteSetting: vi.fn().mockResolvedValue(undefined),
}))

// ─── sessionStorage mock ───────────────────────────────────────────────────────

// Use a plain object as a sessionStorage stand-in — stubbed via vi.stubGlobal.
const sessionStore: Record<string, string> = {}

vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => sessionStore[key] ?? null,
  setItem: (key: string, value: string) => {
    sessionStore[key] = value
  },
  removeItem: (key: string) => {
    delete sessionStore[key]
  },
  clear: () => {
    Object.keys(sessionStore).forEach((k) => delete sessionStore[k])
  },
})

// Internal keys used by auth.ts
const SK_VERIFIER = 'ttl_pkce_verifier'
const SK_STATE = 'ttl_pkce_state'

function setupSession(verifier = 'test-verifier', state = 'test-state') {
  sessionStore[SK_VERIFIER] = verifier
  sessionStore[SK_STATE] = state
}

const VALID_CODE = 'test-code'
const VALID_STATE = 'test-state'
const VALID_API_KEY = 'sk-or-test-key'

// ─── isCallbackUrl ────────────────────────────────────────────────────────────

describe('isCallbackUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    // Re-stub sessionStorage after unstubAll (other tests still need it)
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => sessionStore[key] ?? null,
      setItem: (key: string, value: string) => { sessionStore[key] = value },
      removeItem: (key: string) => { delete sessionStore[key] },
      clear: () => { Object.keys(sessionStore).forEach((k) => delete sessionStore[k]) },
    })
  })

  it('returns true when URL has a code query param', () => {
    vi.stubGlobal('window', { location: { search: '?code=abc123&state=xyz' } })
    expect(isCallbackUrl()).toBe(true)
  })

  it('returns false when URL has no code query param', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    expect(isCallbackUrl()).toBe(false)
  })

  it('returns false when URL has other params but no code', () => {
    vi.stubGlobal('window', { location: { search: '?state=abc' } })
    expect(isCallbackUrl()).toBe(false)
  })
})

// ─── handleCallback ───────────────────────────────────────────────────────────

describe('handleCallback', () => {
  beforeEach(() => {
    // Clear session store and mocks before each test
    Object.keys(sessionStore).forEach((k) => delete sessionStore[k])
    vi.clearAllMocks()
  })

  // ── Error paths ──────────────────────────────────────────────────────────────

  it('throws missing_verifier when sessionStorage has no verifier', async () => {
    const params = new URLSearchParams({ code: VALID_CODE, state: VALID_STATE })

    await expect(handleCallback(params)).rejects.toMatchObject({
      code: 'missing_verifier',
    })
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('throws state_mismatch when returned state does not match stored state', async () => {
    setupSession('test-verifier', 'stored-state')
    const params = new URLSearchParams({ code: VALID_CODE, state: 'different-state' })

    await expect(handleCallback(params)).rejects.toMatchObject({
      code: 'state_mismatch',
    })
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('throws missing_code when callback URL has no code param', async () => {
    setupSession()
    const params = new URLSearchParams({ state: VALID_STATE }) // no code

    await expect(handleCallback(params)).rejects.toMatchObject({
      code: 'missing_code',
    })
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('throws exchange_failed on network error during token exchange', async () => {
    setupSession()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')))
    const params = new URLSearchParams({ code: VALID_CODE, state: VALID_STATE })

    await expect(handleCallback(params)).rejects.toMatchObject({
      code: 'exchange_failed',
    })
  })

  it('throws exchange_failed when token exchange returns non-ok response', async () => {
    setupSession()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'Bad Request' }))
    const params = new URLSearchParams({ code: VALID_CODE, state: VALID_STATE })

    await expect(handleCallback(params)).rejects.toMatchObject({
      code: 'exchange_failed',
    })
  })

  it('throws invalid_response when response JSON has no key field', async () => {
    setupSession()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: 'something-else' }),
    }))
    const params = new URLSearchParams({ code: VALID_CODE, state: VALID_STATE })

    await expect(handleCallback(params)).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })

  it('throws invalid_response when response is not valid JSON', async () => {
    setupSession()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError('not json')),
    }))
    const params = new URLSearchParams({ code: VALID_CODE, state: VALID_STATE })

    await expect(handleCallback(params)).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })

  // ── Success path ─────────────────────────────────────────────────────────────

  it('stores the API key on success', async () => {
    setupSession()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ key: VALID_API_KEY }),
    }))
    const params = new URLSearchParams({ code: VALID_CODE, state: VALID_STATE })

    await handleCallback(params)

    expect(setSetting).toHaveBeenCalledWith('apiKey', VALID_API_KEY)
  })

  // ── Session cleanup ───────────────────────────────────────────────────────────

  it('clears sessionStorage on success', async () => {
    setupSession()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ key: VALID_API_KEY }),
    }))
    const params = new URLSearchParams({ code: VALID_CODE, state: VALID_STATE })

    await handleCallback(params)

    expect(sessionStore[SK_VERIFIER]).toBeUndefined()
    expect(sessionStore[SK_STATE]).toBeUndefined()
  })

  it('clears sessionStorage even when the exchange fails', async () => {
    setupSession()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')))
    const params = new URLSearchParams({ code: VALID_CODE, state: VALID_STATE })

    await expect(handleCallback(params)).rejects.toThrow()

    expect(sessionStore[SK_VERIFIER]).toBeUndefined()
    expect(sessionStore[SK_STATE]).toBeUndefined()
  })

  // ── AuthError type ────────────────────────────────────────────────────────────

  it('throws AuthError (not plain Error) on failure', async () => {
    const params = new URLSearchParams({ code: VALID_CODE, state: VALID_STATE })

    await expect(handleCallback(params)).rejects.toBeInstanceOf(AuthError)
  })
})
