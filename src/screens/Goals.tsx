import { useState, useEffect } from 'react'
import { getGoals, saveGoals } from '../lib/db.ts'
import { GoalsSchema } from '../lib/schemas/index.ts'
import type { Goals } from '../lib/schemas/index.ts'
import { needsGoalReview } from '../lib/context.ts'

export default function Goals() {
  const [goals, setGoals] = useState<Goals | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    getGoals().then((g) => {
      setGoals(g)
      setLoading(false)
    })
  }, [])

  function startEditing() {
    setDraft(goals?.text ?? '')
    setSaveError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setSaveError(null)
  }

  async function handleSave() {
    const text = draft.trim()
    const result = GoalsSchema.safeParse({
      text,
      updatedAt: new Date().toISOString(),
      // Mark pendingReview so AI gets a chance to acknowledge the manual update
      pendingReview: true,
    })

    if (!result.success) {
      setSaveError(result.error.issues[0]?.message ?? 'Invalid goals text')
      return
    }

    setSaving(true)
    try {
      await saveGoals(result.data)
      setGoals(result.data)
      setEditing(false)
    } catch {
      setSaveError('Failed to save — please try again')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="screen-content">
        <p className="placeholder-text">Loading…</p>
      </div>
    )
  }

  const reviewNeeded = goals !== null && needsGoalReview(goals)

  return (
    <div className="screen-content">
      <h1>Goals</h1>

      {reviewNeeded && (
        <div className="goals-review-badge">
          Due for review — start a Chat to update with your AI trainer
        </div>
      )}

      {editing ? (
        <div className="goals-edit">
          <textarea
            className="goals-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Describe your training goals…"
            rows={8}
            maxLength={2000}
            autoFocus
          />
          <div className="goals-char-count">{draft.length} / 2000</div>
          {saveError && <p className="goals-error">{saveError}</p>}
          <div className="goals-actions">
            <button
              className="goals-btn goals-btn--primary"
              onClick={handleSave}
              disabled={saving || !draft.trim()}
            >
              {saving ? 'Saving…' : 'Save Goals'}
            </button>
            <button
              className="goals-btn goals-btn--secondary"
              onClick={cancelEditing}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : goals ? (
        <div className="goals-view">
          <div className="goals-text">{goals.text}</div>
          <div className="goals-meta">
            Last updated: {new Date(goals.updatedAt).toLocaleDateString()}
          </div>
          <button className="goals-btn goals-btn--primary" onClick={startEditing}>
            Edit Goals
          </button>
        </div>
      ) : (
        <div className="goals-empty">
          <p className="placeholder-text">No goals set yet.</p>
          <p className="placeholder-text" style={{ marginTop: 8 }}>
            Head to Chat to set your goals with your AI trainer, or set them manually below.
          </p>
          <button
            className="goals-btn goals-btn--primary"
            style={{ marginTop: 16 }}
            onClick={startEditing}
          >
            Set Goals Manually
          </button>
        </div>
      )}
    </div>
  )
}
