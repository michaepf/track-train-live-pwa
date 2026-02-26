import { useState, useEffect } from 'react'
import {
  getSetting,
  setSetting,
  clearAllData,
  clearGoals,
  clearCompletedWorkouts,
  clearPlannedWorkouts,
  listWorkouts,
  saveSummary,
  getGoals,
  getSummary,
  saveWorkout,
  clearWorkoutsOnly,
} from '../lib/db.ts'
import { logout } from '../lib/auth.ts'
import {
  getWeekKey,
  generateWeeklySummary,
  buildSystemPrompt,
  buildHistoryContext,
  buildUpcomingPlannedContext,
  RECENT_HISTORY_DAYS,
} from '../lib/context.ts'
import { SCENARIOS, type ScenarioKey } from '../lib/dev-fixtures.ts'
import type { Workout } from '../lib/schemas/index.ts'

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

async function runSummaryPass(): Promise<string> {
  const workouts = await listWorkouts(500)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RECENT_HISTORY_DAYS)
  const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: tz })

  const olderWorkouts = workouts.filter((w) => w.date < cutoffStr)
  const byWeek = new Map<string, Workout[]>()
  for (const w of olderWorkouts) {
    const key = getWeekKey(w.date)
    if (!byWeek.has(key)) byWeek.set(key, [])
    byWeek.get(key)!.push(w)
  }

  for (const [weekKey, weekWorkouts] of byWeek) {
    const summary = generateWeeklySummary(weekKey, weekWorkouts)
    await saveSummary(weekKey, summary)
  }

  const n = byWeek.size
  return n === 0
    ? 'No older weeks found — nothing to summarize'
    : `Summarized ${n} week${n === 1 ? '' : 's'}`
}

export default function Settings() {
  const [model, setModel] = useState<ModelTier>('affordable')
  const [saving, setSaving] = useState(false)
  const [armedAction, setArmedAction] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<string | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [promptText, setPromptText] = useState<string | null>(null)
  const [promptBusy, setPromptBusy] = useState(false)
  const [armedScenario, setArmedScenario] = useState<ScenarioKey | null>(null)
  const [scenarioBusy, setScenarioBusy] = useState(false)
  const [scenarioStatus, setScenarioStatus] = useState<string | null>(null)

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

  async function handleRunSummaryPass() {
    setSummaryBusy(true)
    setSummaryStatus(null)
    try {
      const result = await runSummaryPass()
      setSummaryStatus(result)
    } catch (err) {
      setSummaryStatus(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSummaryBusy(false)
    }
  }

  async function handleInspectPrompt() {
    setPromptBusy(true)
    setPromptText(null)
    try {
      const workouts = await listWorkouts(100)
      const goals = await getGoals()

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - RECENT_HISTORY_DAYS)
      const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: tz })

      const olderWeekKeys = [
        ...new Set(
          workouts.filter((w) => w.date < cutoffStr).map((w) => getWeekKey(w.date)),
        ),
      ]
      const summaryMap = new Map<string, string>()
      for (const wk of olderWeekKeys) {
        const summary = await getSummary(wk)
        if (summary) summaryMap.set(wk, summary)
      }

      const historyContext = buildHistoryContext(workouts, summaryMap)
      const upcomingContext = buildUpcomingPlannedContext(workouts)
      const prompt = buildSystemPrompt(goals, 'planning', historyContext, upcomingContext)
      setPromptText(prompt)
    } catch (err) {
      setPromptText(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setPromptBusy(false)
    }
  }

  async function confirmLoadScenario() {
    if (!armedScenario) return
    const scenario = SCENARIOS[armedScenario]
    setArmedScenario(null)
    setScenarioBusy(true)
    setScenarioStatus(null)
    setPromptText(null)
    try {
      await clearWorkoutsOnly()
      for (const workout of scenario.workouts) {
        await saveWorkout(workout)
      }
      const summaryResult = await runSummaryPass()
      setScenarioStatus(
        `Loaded "${scenario.label}" — ${scenario.workouts.length} sessions. ${summaryResult}.`,
      )
    } catch (err) {
      setScenarioStatus(`Error: ${err instanceof Error ? err.message : 'Failed'}`)
    } finally {
      setScenarioBusy(false)
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

      <section className="settings-section">
        <div className="settings-label">Developer</div>

        {/* Run summary pass */}
        <div className="settings-action">
          <div className="settings-action-controls">
            <button
              className="logout-btn"
              onClick={handleRunSummaryPass}
              disabled={summaryBusy || busy || scenarioBusy}
            >
              {summaryBusy ? 'Running…' : 'Run summary pass'}
            </button>
          </div>
          <div className="settings-action-side">
            <span className="settings-action-desc">
              Generates and saves weekly summaries for workout history older than 3 weeks.
              {summaryStatus && <> — <strong>{summaryStatus}</strong></>}
            </span>
          </div>
        </div>

        {/* Inspect system prompt */}
        <div className="settings-action">
          <div className="settings-action-controls">
            <button
              className="logout-btn"
              onClick={handleInspectPrompt}
              disabled={promptBusy || busy || scenarioBusy}
            >
              {promptBusy ? 'Building…' : 'Inspect system prompt'}
            </button>
          </div>
          <div className="settings-action-side">
            <span className="settings-action-desc">
              Builds the planning system prompt from current data and shows the full text with character count.
            </span>
          </div>
        </div>
        {promptText && (
          <details className="dev-prompt-details">
            <summary className="dev-prompt-summary">
              {promptText.length.toLocaleString()} chars
              {promptText.length < 6000 ? ' — bounded ✓' : ' — large ⚠'}
            </summary>
            <pre className="dev-prompt-preview">{promptText}</pre>
          </details>
        )}

        {/* Load test scenario */}
        <div className="settings-action">
          <div className="settings-action-side">
            <span className="settings-action-desc">
              Load a fixture history to test agent behavior.{' '}
              <strong>Replaces current workout data.</strong>
              {scenarioStatus && <> — <strong>{scenarioStatus}</strong></>}
            </span>
          </div>
        </div>
        {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
          const s = SCENARIOS[key]
          const isArmed = armedScenario === key
          return (
            <div key={key} className="settings-action">
              <div className="settings-action-controls">
                {isArmed ? (
                  <div className="settings-confirm-row">
                    <button
                      className="settings-cancel-btn"
                      onClick={() => setArmedScenario(null)}
                      disabled={scenarioBusy}
                    >
                      Cancel
                    </button>
                    <button
                      className="settings-confirm-btn"
                      onClick={confirmLoadScenario}
                      disabled={scenarioBusy}
                    >
                      {scenarioBusy ? 'Loading…' : 'Confirm load'}
                    </button>
                  </div>
                ) : (
                  <button
                    className="logout-btn"
                    onClick={() => { setArmedScenario(key); setScenarioStatus(null) }}
                    disabled={scenarioBusy || busy || !!armedScenario}
                  >
                    {scenarioBusy && armedScenario === key ? 'Loading…' : `Load: ${s.label}`}
                  </button>
                )}
              </div>
              <div className="settings-action-side">
                <span className="settings-action-desc">{s.description}</span>
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}
