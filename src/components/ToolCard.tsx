import { useState } from 'react'
import MarkdownText from './MarkdownText.tsx'
import ExerciseTip from './ExerciseTip.tsx'
import { formatSetLabel, summarizeWorkout } from '../lib/formatters.ts'
import type { ProposeProfilePayload, ProposeTrainingPlanPayload, ProposeWorkoutsPayload } from '../lib/schemas/index.ts'

// ─── propose_goals card ────────────────────────────────────────────────────────

interface ProposeGoalsCardProps {
  proposedText: string
  onAccept: () => void
  onRequestChanges: (feedback: string) => void
}

export function ProposeGoalsCard({ proposedText, onAccept, onRequestChanges }: ProposeGoalsCardProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')

  function handleRequestChanges() {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    if (!feedback.trim()) return
    onRequestChanges(feedback.trim())
  }

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <span className="tool-card-label">Proposed Goals</span>
      </div>
      <div className="tool-card-content">
        <MarkdownText text={proposedText} />
      </div>
      {showFeedback && (
        <textarea
          className="tool-card-feedback"
          placeholder="What would you like to change?"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          autoFocus
        />
      )}
      <div className="tool-card-actions">
        <button className="tool-card-btn tool-card-btn--accept" onClick={onAccept}>
          Accept
        </button>
        <button
          className="tool-card-btn tool-card-btn--reject"
          onClick={handleRequestChanges}
          disabled={showFeedback && !feedback.trim()}
        >
          {showFeedback ? 'Send feedback' : 'Request changes'}
        </button>
      </div>
    </div>
  )
}

// ─── propose_profile card ─────────────────────────────────────────────────────

interface ProposeProfileCardProps {
  profile: ProposeProfilePayload
  onAccept: () => void
  onRequestChanges: (feedback: string) => void
}

function humanize(slug: string): string {
  return slug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ProposeProfileCard({ profile, onAccept, onRequestChanges }: ProposeProfileCardProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')

  function handleRequestChanges() {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    if (!feedback.trim()) return
    onRequestChanges(feedback.trim())
  }

  const lines: string[] = []
  if (profile.sex) lines.push(`**Sex:** ${humanize(profile.sex)}`)
  lines.push(`**Experience:** ${humanize(profile.experience)}`)
  lines.push(`**Available days/week:** ${profile.availableDays}`)
  if (profile.sessionMinutes) lines.push(`**Session length:** ~${profile.sessionMinutes} min`)
  lines.push(`**Equipment:** ${profile.equipment.map(humanize).join(', ')}`)
  if (profile.injuries) lines.push(`**Injuries/limitations:** ${profile.injuries}`)
  if (profile.notes) lines.push(`**Notes:** ${profile.notes}`)

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <span className="tool-card-label">Proposed Profile</span>
      </div>
      <div className="tool-card-content">
        <MarkdownText text={lines.join('\n\n')} />
      </div>
      {showFeedback && (
        <textarea
          className="tool-card-feedback"
          placeholder="What would you like to change?"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          autoFocus
        />
      )}
      <div className="tool-card-actions">
        <button className="tool-card-btn tool-card-btn--accept" onClick={onAccept}>
          Accept
        </button>
        <button
          className="tool-card-btn tool-card-btn--reject"
          onClick={handleRequestChanges}
          disabled={showFeedback && !feedback.trim()}
        >
          {showFeedback ? 'Send feedback' : 'Request changes'}
        </button>
      </div>
    </div>
  )
}

// ─── propose_training_plan card ───────────────────────────────────────────────

interface ProposeTrainingPlanCardProps {
  plan: ProposeTrainingPlanPayload
  onAccept: () => void
  onRequestChanges: (feedback: string) => void
}

export function ProposeTrainingPlanCard({ plan, onAccept, onRequestChanges }: ProposeTrainingPlanCardProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')

  function handleRequestChanges() {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    if (!feedback.trim()) return
    onRequestChanges(feedback.trim())
  }

  const header = [
    `**${plan.name}**`,
    `**Split:** ${plan.split}`,
    `**Days/week:** ${plan.daysPerWeek}`,
    `**Duration:** ${plan.durationWeeks} weeks`,
    `**Focus:** ${plan.focus}`,
  ]
  if (plan.startDate) header.push(`**Start date:** ${plan.startDate}`)

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <span className="tool-card-label">Proposed Training Plan</span>
      </div>
      <div className="tool-card-content">
        <MarkdownText text={header.join('\n\n')} />
        <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Strategy</div>
          <MarkdownText text={plan.strategy} />
        </div>
      </div>
      {showFeedback && (
        <textarea
          className="tool-card-feedback"
          placeholder="What would you like changed in this plan?"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          autoFocus
        />
      )}
      <div className="tool-card-actions">
        <button className="tool-card-btn tool-card-btn--accept" onClick={onAccept}>
          Accept plan
        </button>
        <button
          className="tool-card-btn tool-card-btn--reject"
          onClick={handleRequestChanges}
          disabled={showFeedback && !feedback.trim()}
        >
          {showFeedback ? 'Send feedback' : 'Request changes'}
        </button>
      </div>
    </div>
  )
}

// ─── propose_workout card ──────────────────────────────────────────────────────

interface ProposeWorkoutCardProps {
  workouts: ProposeWorkoutsPayload
  onAccept: () => void
  onRequestChanges: (feedback: string) => void
  disabled?: boolean
}

export function ProposeWorkoutCard({
  workouts,
  onAccept,
  onRequestChanges,
  disabled = false,
}: ProposeWorkoutCardProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())

  function toggleExpand(i: number) {
    setExpandedIndices((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function handleRequestChanges() {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    if (!feedback.trim()) return
    onRequestChanges(feedback.trim())
  }

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <span className="tool-card-label">Proposed Workouts</span>
      </div>
      <div className="tool-card-content">
        {workouts.map((workout, i) => {
          const expanded = expandedIndices.has(i)
          const hasDetail = (workout.entries?.length ?? 0) > 0 || (workout.cardioOptions?.length ?? 0) > 0
          return (
            <div key={`${workout.date}-${i}`} className="tool-card-workout-row">
              <button className="tool-card-workout-toggle" onClick={() => hasDetail && toggleExpand(i)}>
                <div className="tool-card-workout-toggle-left">
                  <div className="tool-card-workout-title">
                    {workout.date} — {workout.session ?? workout.workoutType}
                  </div>
                  <div className="tool-card-workout-meta">{summarizeWorkout(workout)}</div>
                </div>
                {hasDetail && (
                  <span className="tool-card-workout-chevron">{expanded ? '▲' : '▼'}</span>
                )}
              </button>
              {expanded && (
                <div className="tool-card-workout-detail">
                  {(workout.entries ?? []).map((entry, ei) => (
                    <div key={`${entry.exerciseId}-${ei}`} className="workout-card-entry">
                      <div className="workout-card-entry-name"><ExerciseTip exerciseId={entry.exerciseId} /></div>
                      <div className="workout-card-entry-sets">
                        {entry.sets.map((set, si) => (
                          <span key={si} className="workout-card-set-chip">{formatSetLabel(set)}</span>
                        ))}
                      </div>
                      {entry.aiNotes && <div className="workout-card-entry-notes">{entry.aiNotes}</div>}
                    </div>
                  ))}
                  {(workout.cardioOptions ?? []).map((opt, ci) => (
                    <div key={`${opt.label}-${ci}`} className="workout-card-entry">
                      <div className="workout-card-entry-name">{opt.label}</div>
                      {opt.target && <div className="workout-card-entry-notes">{opt.target}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {showFeedback && (
        <textarea
          className="tool-card-feedback"
          placeholder="What would you like changed in this plan?"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          autoFocus
        />
      )}
      <div className="tool-card-actions">
        <button className="tool-card-btn tool-card-btn--accept" onClick={onAccept}>
          {disabled ? 'Saving...' : 'Accept plan'}
        </button>
        <button
          className="tool-card-btn tool-card-btn--reject"
          onClick={handleRequestChanges}
          disabled={disabled || (showFeedback && !feedback.trim())}
        >
          {showFeedback ? 'Send feedback' : 'Request changes'}
        </button>
      </div>
    </div>
  )
}

// ─── Error card ────────────────────────────────────────────────────────────────

interface ToolErrorCardProps {
  toolName: string
  message: string
}

export function ToolErrorCard({ toolName, message }: ToolErrorCardProps) {
  return (
    <div className="tool-card tool-card--error">
      <div className="tool-card-header">
        <span className="tool-card-label">Tool error: {toolName}</span>
      </div>
      <div className="tool-card-content">
        <MarkdownText text={message} />
      </div>
    </div>
  )
}
