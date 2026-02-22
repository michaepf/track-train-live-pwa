import { useState, useEffect } from 'react'
import {
  getSetting,
  setSetting,
  clearAllData,
  clearGoals,
  clearCompletedWorkouts,
  clearPlannedWorkouts,
} from '../lib/db.ts'
import { logout } from '../lib/auth.ts'

type ModelTier = 'premium' | 'affordable'
type Scope = 'user' | 'both'

interface ActionDef {
  key: string
  label: string
  confirmLabel: string
  busyLabel: string
  description: string
  scope: Scope
  action: () => Promise<void>
  /** If false, skip the page reload (e.g. logout() handles its own redirect). */
  reload?: boolean
}

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

const ACCOUNT_ACTIONS: ActionDef[] = [
  {
    key: 'logout',
    label: 'Disconnect OpenRouter',
    confirmLabel: 'Confirm disconnect',
    busyLabel: 'Disconnecting…',
    description: 'Removes your stored API token from this device.',
    scope: 'user',
    action: logout,
    reload: false, // logout() handles its own redirect
  },
]

const DATA_ACTIONS: ActionDef[] = [
  {
    key: 'clearGoals',
    label: 'Delete all goals info',
    confirmLabel: 'Confirm: delete goals',
    busyLabel: 'Deleting…',
    description: 'Removes your stored training goals. Workouts and chat history are not affected.',
    scope: 'user',
    action: clearGoals,
  },
  {
    key: 'clearHistory',
    label: 'Delete workout history',
    confirmLabel: 'Confirm: delete history',
    busyLabel: 'Deleting…',
    description: 'Removes completed workouts and weekly summaries. Planned workouts are not affected.',
    scope: 'user',
    action: clearCompletedWorkouts,
  },
  {
    key: 'clearPlanned',
    label: 'Delete planned workouts',
    confirmLabel: 'Confirm: delete planned',
    busyLabel: 'Deleting…',
    description: 'Removes workouts not yet completed. Completed history is not affected.',
    scope: 'both',
    action: clearPlannedWorkouts,
  },
  {
    key: 'deleteAll',
    label: 'Delete everything',
    confirmLabel: 'Confirm: delete everything',
    busyLabel: 'Deleting…',
    description:
      'Wipes all local data on this device: goals, workouts, chat history, and summaries. Does not disconnect OpenRouter.',
    scope: 'user',
    action: clearAllData,
  },
]

export default function Settings() {
  const [model, setModel] = useState<ModelTier>('affordable')
  const [saving, setSaving] = useState(false)
  const [armedAction, setArmedAction] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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

  function arm(key: string) {
    setArmedAction(key)
    setActionError(null)
  }

  function disarm() {
    setArmedAction(null)
  }

  async function execute(def: ActionDef) {
    setArmedAction(null)
    setActionError(null)
    setActiveAction(def.key)
    try {
      await def.action()
      if (def.reload !== false) {
        window.location.href = window.location.origin + window.location.pathname
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      )
      setActiveAction(null)
    }
  }

  const busy = activeAction !== null

  function renderAction(def: ActionDef) {
    const isArmed = armedAction === def.key
    const isBusy = activeAction === def.key

    return (
      <div key={def.key} className="settings-action">
        <div className="settings-action-controls">
          {isArmed ? (
            <div className="settings-confirm-row">
              <button className="settings-cancel-btn" onClick={disarm} disabled={busy}>
                Cancel
              </button>
              <button
                className="settings-confirm-btn"
                onClick={() => execute(def)}
                disabled={busy}
              >
                {isBusy ? def.busyLabel : def.confirmLabel}
              </button>
            </div>
          ) : (
            <button
              className="logout-btn"
              onClick={() => arm(def.key)}
              disabled={busy || saving}
            >
              {isBusy ? def.busyLabel : def.label}
            </button>
          )}
        </div>
        <div className="settings-action-side">
          <span className="settings-action-desc">{def.description}</span>
        </div>
      </div>
    )
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
        {ACCOUNT_ACTIONS.map(renderAction)}
      </section>

      <section className="settings-section">
        <div className="settings-label">Data</div>
        {DATA_ACTIONS.map(renderAction)}
        {actionError && <div className="settings-error">{actionError}</div>}
      </section>
    </div>
  )
}
