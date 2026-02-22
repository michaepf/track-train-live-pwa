import { useState, useEffect, createContext, useContext, Component } from 'react'
import type { ReactNode } from 'react'
import {
  isCallbackUrl,
  handleCallback,
  isAuthenticated,
  getApiKey,
  startLogin,
  AuthError,
} from './lib/auth.ts'
import Goals from './screens/Goals.tsx'
import Chat from './screens/Chat.tsx'
import Workout from './screens/Workout.tsx'
import History from './screens/History.tsx'
import Settings from './screens/Settings.tsx'

// ─── API key context ───────────────────────────────────────────────────────────

const ApiKeyContext = createContext<string>('')

/** Access the OpenRouter API key from any authenticated screen. */
export function useApiKey(): string {
  return useContext(ApiKeyContext)
}

// ─── Error boundary ────────────────────────────────────────────────────────────

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="screen-content">
          <h1>Something went wrong</h1>
          <p className="placeholder-text" style={{ marginTop: 12 }}>
            {(this.state.error as Error).message}
          </p>
          <button
            className="login-btn"
            style={{ marginTop: 24 }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Auth screens ──────────────────────────────────────────────────────────────

function LoginScreen({ error }: { error: string | null }) {
  const [starting, setStarting] = useState(false)

  async function handleLogin() {
    setStarting(true)
    await startLogin() // redirects — never returns
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Track Train Live</h1>
        <p className="auth-subtitle">
          Connect your OpenRouter account to get started. You'll use your own API
          balance — the app never handles payment.
        </p>
        {error && <p className="auth-error">{error}</p>}
        <button className="login-btn" onClick={handleLogin} disabled={starting}>
          {starting ? 'Redirecting…' : 'Connect with OpenRouter'}
        </button>
      </div>
    </div>
  )
}

function CallbackScreen() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <p className="auth-subtitle">Connecting…</p>
      </div>
    </div>
  )
}

// ─── Navigation ────────────────────────────────────────────────────────────────

type ScreenId = 'workout' | 'chat' | 'goals' | 'history' | 'settings'

const SCREENS: { id: ScreenId; label: string; icon: string }[] = [
  { id: 'workout',  label: 'Today',    icon: '💪' },
  { id: 'chat',     label: 'Chat',     icon: '💬' },
  { id: 'goals',    label: 'Goals',    icon: '🎯' },
  { id: 'history',  label: 'Log',      icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

function renderScreen(screen: ScreenId) {
  switch (screen) {
    case 'workout':  return <Workout />
    case 'chat':     return <Chat />
    case 'goals':    return <Goals />
    case 'history':  return <History />
    case 'settings': return <Settings />
  }
}

// ─── Main app ─────────────────────────────────────────────────────────────────

type AuthState = 'loading' | 'callback' | 'unauthenticated' | 'authenticated'

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [apiKey, setApiKey] = useState<string>('')
  const [callbackError, setCallbackError] = useState<string | null>(null)
  const [screen, setScreen] = useState<ScreenId>('workout')

  useEffect(() => {
    if (isCallbackUrl()) {
      setAuthState('callback')
      const params = new URLSearchParams(window.location.search)

      handleCallback(params)
        .then(async () => {
          // Strip ?code=... from URL without adding to browser history
          window.history.replaceState({}, '', window.location.pathname)
          const key = await getApiKey()
          setApiKey(key ?? '')
          setAuthState('authenticated')
        })
        .catch((err: unknown) => {
          const message =
            err instanceof AuthError
              ? err.message
              : 'Authentication failed. Please try again.'
          setCallbackError(message)
          setAuthState('unauthenticated')
        })

      return
    }

    isAuthenticated()
      .then(async (authenticated) => {
        if (!authenticated) {
          setAuthState('unauthenticated')
          return
        }
        const key = await getApiKey()
        if (!key) {
          // Authenticated flag was set but key is missing — treat as logged out
          setAuthState('unauthenticated')
          return
        }
        setApiKey(key)
        setAuthState('authenticated')
      })
      .catch(() => {
        // DB or unexpected error during boot — fall back to login screen
        setAuthState('unauthenticated')
      })
  }, [])

  if (authState === 'loading') {
    return null // blank while checking — avoids flash of login screen
  }

  if (authState === 'callback') {
    return <CallbackScreen />
  }

  if (authState === 'unauthenticated') {
    return <LoginScreen error={callbackError} />
  }

  return (
    <ErrorBoundary>
      <ApiKeyContext.Provider value={apiKey}>
        <div className="app">
          <main className="screen">
            {renderScreen(screen)}
          </main>
          <nav className="tab-bar">
            {SCREENS.map((s) => (
              <button
                key={s.id}
                className={`tab ${screen === s.id ? 'tab--active' : ''}`}
                onClick={() => setScreen(s.id)}
              >
                <span className="tab__icon">{s.icon}</span>
                <span className="tab__label">{s.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </ApiKeyContext.Provider>
    </ErrorBoundary>
  )
}
