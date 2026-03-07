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
import { syncSeedExercises, getWorkoutsByDate, listWorkouts, getSetting, setSetting } from './lib/db.ts'
import { registerExerciseCatalog } from './data/exercises.ts'
import { getToday } from './lib/context.ts'
import Chat from './screens/Chat.tsx'
import Today from './screens/Today.tsx'
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

function FirstTimeModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h2 className="modal-title">Welcome to Track Train Live!</h2>
        <div className="modal-content">
          <p>
            <strong>Important:</strong> All your data — workouts, chat history, and goals — is stored locally on this device only.
          </p>
          <p>
            If you're setting up for the first time, use the device you'll take to the gym regularly. Your phone is usually the best choice.
          </p>
          <p className="modal-note">
            Data doesn't sync between devices (e.g., your laptop and phone). Each device has its own separate data.
          </p>
        </div>
        <button className="modal-btn" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  )
}

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
          An AI-powered personal training app. Chat with your trainer to plan
          workouts, then log your sessions as you go.
        </p>
        <ul className="auth-features">
          <li>All data is stored locally on your device — nothing leaves it except AI messages.</li>
          <li>Requires a free <a href="https://openrouter.ai" target="_blank" rel="noreferrer">OpenRouter</a> account. You pay for AI usage directly — the app never handles money.</li>
          <li>Estimated cost for heavy use: ~$2–$5/month. You can set a monthly spending limit in your <a href="https://openrouter.ai/settings/limits" target="_blank" rel="noreferrer">OpenRouter account settings</a>.</li>
        </ul>
        {error && <p className="auth-error">{error}</p>}
        <button className="login-btn" onClick={handleLogin} disabled={starting}>
          {starting ? 'Redirecting…' : 'Connect with OpenRouter'}
        </button>
        <p className="auth-attribution">
          Created by{' '}
          <a href="https://bsky.app/profile/michael-flynn.bsky.social" target="_blank" rel="noreferrer">
            @michael-flynn.bsky.social
          </a>
        </p>
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

type ScreenId = 'today' | 'workout' | 'chat' | 'history' | 'settings'

const SCREENS: { id: ScreenId; label: string; icon: string }[] = [
  { id: 'chat',     label: 'Chat',     icon: '💬' },
  { id: 'today',    label: 'Today',    icon: '📅' },
  { id: 'workout',  label: 'Workouts', icon: '💪' },
  { id: 'history',  label: 'Log',      icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

// ─── Main app ─────────────────────────────────────────────────────────────────

type AuthState = 'loading' | 'callback' | 'unauthenticated' | 'authenticated'

const SETTING_FIRST_TIME_SHOWN = 'firstTimeWarningShown'

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [apiKey, setApiKey] = useState<string>('')
  const [callbackError, setCallbackError] = useState<string | null>(null)
  const [screen, setScreen] = useState<ScreenId>('chat')
  const [chatStreaming, setChatStreaming] = useState(false)
  const [chatHasUnread, setChatHasUnread] = useState(false)
  const [showFirstTimeModal, setShowFirstTimeModal] = useState(false)
  const [chatSeedMessage, setChatSeedMessage] = useState<string | null>(null)

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
          // Seed and register catalog before mounting Chat so validation has the full list
          await syncSeedExercises().then(registerExerciseCatalog).catch(() => {})
          setScreen('chat')
          setAuthState('authenticated')
          // Show first-time modal for new users
          const shown = await getSetting(SETTING_FIRST_TIME_SHOWN)
          if (!shown) setShowFirstTimeModal(true)
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
        // Seed and register catalog before mounting screens so validation has the full list
        await syncSeedExercises().then(registerExerciseCatalog).catch(() => {})
        // Smart default screen: Today > Workouts > Chat
        const today = getToday()
        const todayWorkouts = await getWorkoutsByDate(today).catch(() => [])
        if (todayWorkouts.length > 0) {
          setScreen('today')
        } else {
          const recent = await listWorkouts(1).catch(() => [])
          if (recent.length > 0 && recent[0].date > today) setScreen('workout')
        }
        setAuthState('authenticated')
      })
      .catch(() => {
        // DB or unexpected error during boot — fall back to login screen
        setAuthState('unauthenticated')
      })
  }, [])

  function handleTabChange(nextScreen: ScreenId) {
    if (nextScreen === screen) return
    if (nextScreen === 'chat') setChatHasUnread(false)
    setScreen(nextScreen)
  }

  async function dismissFirstTimeModal() {
    await setSetting(SETTING_FIRST_TIME_SHOWN, 'true')
    setShowFirstTimeModal(false)
  }

  function renderActiveScreen() {
    switch (screen) {
      case 'today':    return <Today onRequestChat={(msg) => { setChatSeedMessage(msg); setScreen('chat') }} />
      case 'workout':  return <Workout />
      case 'history':  return <History />
      case 'settings': return <Settings />
    }
  }

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
            <div style={screen !== 'chat' ? { display: 'none' } : undefined}>
              <Chat
                isActive={screen === 'chat'}
                onStreamingChange={setChatStreaming}
                onNewResponse={() => setChatHasUnread(true)}
                seedMessage={chatSeedMessage ?? undefined}
                onSeedConsumed={() => setChatSeedMessage(null)}
              />
            </div>
            {screen !== 'chat' && renderActiveScreen()}
          </main>
          <nav className="tab-bar">
            {SCREENS.map((s) => (
              <button
                key={s.id}
                className={`tab ${screen === s.id ? 'tab--active' : ''}`}
                onClick={() => handleTabChange(s.id)}
              >
                <span className="tab__icon">
                  {s.icon}
                  {s.id === 'chat' && (chatHasUnread || (chatStreaming && screen !== 'chat')) && (
                    <span className={`tab__dot${chatHasUnread ? '' : ' tab__dot--working'}`} />
                  )}
                </span>
                <span className="tab__label">{s.label}</span>
              </button>
            ))}
          </nav>
          <p className="app-disclaimer">Use at your own risk! Keep in mind that AI models can make mistakes.</p>
        </div>
        {showFirstTimeModal && <FirstTimeModal onDismiss={dismissFirstTimeModal} />}
      </ApiKeyContext.Provider>
    </ErrorBoundary>
  )
}
