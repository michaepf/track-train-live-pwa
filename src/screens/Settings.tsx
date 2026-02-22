import { useState, useEffect } from 'react'
import { getSetting, setSetting, clearAllData } from '../lib/db.ts'
import { logout } from '../lib/auth.ts'

type ModelTier = 'premium' | 'affordable'

const MODEL_OPTIONS: { value: ModelTier; label: string; description: string }[] = [
  {
    value: 'premium',
    label: 'Premium',
    description: 'Claude Sonnet — best reasoning, higher cost per conversation',
  },
  {
    value: 'affordable',
    label: 'Affordable',
    description: 'GLM / DeepSeek — good quality, lower cost',
  },
]

export default function Settings() {
  const [model, setModel] = useState<ModelTier>('affordable')
  const [saving, setSaving] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  useEffect(() => {
    getSetting('model').then((stored) => {
      if (stored === 'premium' || stored === 'affordable') {
        setModel(stored)
      }
    })
  }, [])

  async function handleModelChange(value: ModelTier) {
    setModel(value)
    setSaving(true)
    await setSetting('model', value)
    setSaving(false)
  }

  async function handleLogout() {
    setLoggingOut(true)
    await logout() // redirects — never returns
  }

  async function handleResetData() {
    const confirmed = window.confirm(
      'Reset all local app data on this device?\n\nThis deletes goals, workouts, chat history, summaries, settings, and your saved API key.',
    )
    if (!confirmed) return

    setResetError(null)
    setResetting(true)
    try {
      await clearAllData()
      window.location.href = window.location.origin + window.location.pathname
    } catch {
      setResetError('Failed to reset local data. Please try again.')
      setResetting(false)
    }
  }

  return (
    <div className="screen-content">
      <h1>Settings</h1>

      <section className="settings-section">
        <div className="settings-label">AI Model</div>
        <div className="settings-description">
          Controls which model is used for planning conversations.{' '}
          {saving && <span className="settings-saving">Saving…</span>}
        </div>
        <div className="model-options">
          {MODEL_OPTIONS.map((opt) => (
            <label key={opt.value} className="model-option">
              <input
                type="radio"
                name="model"
                value={opt.value}
                checked={model === opt.value}
                onChange={() => handleModelChange(opt.value)}
              />
              <div className="model-option-text">
                <span className="model-option-label">{opt.label}</span>
                <span className="model-option-desc">{opt.description}</span>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-label">Account</div>
        <button
          className="logout-btn"
          onClick={handleLogout}
          disabled={loggingOut || resetting}
        >
          {loggingOut ? 'Logging out…' : 'Disconnect OpenRouter'}
        </button>
        <div className="settings-description" style={{ marginTop: 8 }}>
          Clears your stored API token from this device.
        </div>

        <button
          className="logout-btn"
          style={{ marginTop: 12 }}
          onClick={handleResetData}
          disabled={resetting || loggingOut}
        >
          {resetting ? 'Resetting…' : 'Reset All Local Data'}
        </button>
        <div className="settings-description" style={{ marginTop: 8 }}>
          Starts over from scratch on this device.
        </div>
        {resetError && (
          <div className="settings-description" style={{ marginTop: 8, color: '#e88' }}>
            {resetError}
          </div>
        )}
      </section>
    </div>
  )
}
