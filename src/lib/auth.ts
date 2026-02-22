/**
 * OpenRouter PKCE OAuth flow.
 *
 * Flow:
 *   1. startLogin()       — generates verifier + state, redirects to OpenRouter
 *   2. handleCallback()   — validates state, exchanges code for API key, stores in IndexedDB
 *
 * Reference: https://openrouter.ai/docs/guides/overview/auth/oauth
 *
 * Endpoints:
 *   Auth:           https://openrouter.ai/auth
 *   Token exchange: https://openrouter.ai/api/v1/auth/keys
 */

import { getSetting, setSetting, deleteSetting } from './db.ts'

// sessionStorage keys — used during the auth flow only, cleared on completion
const SK_VERIFIER = 'ttl_pkce_verifier'
const SK_STATE    = 'ttl_pkce_state'

const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth'
const OPENROUTER_TOKEN_URL = 'https://openrouter.ai/api/v1/auth/keys'
const SETTING_API_KEY = 'apiKey'

// ─── PKCE crypto helpers ───────────────────────────────────────────────────────

/** Generate a cryptographically random PKCE code verifier (43 url-safe chars). */
function generateVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

/** Derive the PKCE code challenge: base64url(SHA-256(verifier)). */
async function deriveChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return base64url(new Uint8Array(digest))
}

/** Generate a random opaque state token for CSRF protection. */
function generateState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

// ─── Auth flow ────────────────────────────────────────────────────────────────

/**
 * Start the OpenRouter PKCE login flow.
 * Stores the verifier and state in sessionStorage, then redirects — never returns.
 *
 * Note: OpenRouter's PKCE flow does not require pre-registering the callback URL.
 * The callback_url is passed dynamically and OpenRouter redirects back to it.
 * No allowlist configuration is needed on the OpenRouter dashboard.
 *
 * The state token is embedded as a query param in the callback_url so that
 * OpenRouter passes it back through the redirect, allowing CSRF validation.
 */
export async function startLogin(): Promise<never> {
  const verifier = generateVerifier()
  const challenge = await deriveChallenge(verifier)
  const state = generateState()

  sessionStorage.setItem(SK_VERIFIER, verifier)
  sessionStorage.setItem(SK_STATE, state)

  const callbackUrl =
    window.location.origin +
    window.location.pathname +
    `?state=${state}`

  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  window.location.href = `${OPENROUTER_AUTH_URL}?${params.toString()}`

  // Unreachable — satisfies TypeScript's never return type
  throw new Error('Redirect failed')
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'missing_verifier'
      | 'missing_code'
      | 'state_mismatch'
      | 'exchange_failed'
      | 'invalid_response',
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * Handle the OAuth callback.
 * Call this when the app loads and detects a `code` query parameter.
 * Validates the state token, exchanges the code for an API key, stores it in IndexedDB.
 * Clears sessionStorage on success or failure.
 */
export async function handleCallback(params: URLSearchParams): Promise<void> {
  const code = params.get('code')
  const returnedState = params.get('state')
  const verifier = sessionStorage.getItem(SK_VERIFIER)
  const storedState = sessionStorage.getItem(SK_STATE)

  // Always clear session state, even on failure
  sessionStorage.removeItem(SK_VERIFIER)
  sessionStorage.removeItem(SK_STATE)

  if (!verifier) {
    throw new AuthError(
      'No PKCE verifier found — login flow may have started in a different tab or session.',
      'missing_verifier',
    )
  }

  if (!storedState || returnedState !== storedState) {
    throw new AuthError(
      'State mismatch in OAuth callback — possible CSRF. Please try logging in again.',
      'state_mismatch',
    )
  }

  if (!code) {
    throw new AuthError('No authorization code in callback URL.', 'missing_code')
  }

  let response: Response
  try {
    response = await fetch(OPENROUTER_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
    })
  } catch (err) {
    throw new AuthError(
      `Network error during token exchange: ${String(err)}`,
      'exchange_failed',
    )
  }

  if (!response.ok) {
    throw new AuthError(
      `Token exchange failed: ${response.status} ${response.statusText}`,
      'exchange_failed',
    )
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new AuthError('Token exchange response was not valid JSON.', 'invalid_response')
  }

  const apiKey =
    data && typeof data === 'object' && 'key' in data && typeof data.key === 'string'
      ? data.key
      : null

  if (!apiKey) {
    throw new AuthError(
      'Token exchange response did not contain an API key.',
      'invalid_response',
    )
  }

  await setSetting(SETTING_API_KEY, apiKey)
}

// ─── Session helpers ───────────────────────────────────────────────────────────

export async function getApiKey(): Promise<string | null> {
  return getSetting(SETTING_API_KEY)
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getApiKey()) !== null
}

/**
 * Clear the stored API key and redirect to the app root (which will show the login screen).
 * Call this on explicit logout or after a 401.
 */
export async function logout(): Promise<void> {
  await deleteSetting(SETTING_API_KEY)
  window.location.href = window.location.origin + window.location.pathname
}

/**
 * Handle a 401 response from OpenRouter mid-stream.
 * Wipes the stored key and triggers re-authentication.
 *
 * IMPORTANT: Callers must abort any in-flight stream before calling this.
 * The API client (api.ts) handles this internally — external callers should
 * not need to call this directly.
 */
export async function handle401(): Promise<void> {
  await logout()
}

/** Returns true if the current URL looks like an OAuth callback. */
export function isCallbackUrl(): boolean {
  return new URLSearchParams(window.location.search).has('code')
}
