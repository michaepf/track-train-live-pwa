import { useEffect, useMemo, useState } from 'react'
import { listWorkouts, deleteWorkout } from '../lib/db.ts'
import ExerciseTip from '../components/ExerciseTip.tsx'
import { isWorkoutCompleted, type Workout } from '../lib/schemas/index.ts'

function formatDateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function summarizeWorkout(workout: Workout): string {
  const exerciseCount = workout.entries?.length ?? 0
  const cardioCount = workout.cardioOptions?.length ?? 0
  const parts: string[] = []
  if (exerciseCount > 0) parts.push(`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`)
  if (cardioCount > 0) parts.push(`${cardioCount} cardio option${cardioCount === 1 ? '' : 's'}`)
  return parts.join(' • ') || 'No details'
}

function setLabel(set: { plannedReps?: number; plannedWeight?: number; targetSeconds?: number; plannedDuration?: string }): string {
  const parts: string[] = []
  if (set.plannedReps) parts.push(`${set.plannedReps} reps`)
  if (set.targetSeconds) parts.push(`${set.targetSeconds}s`)
  if (set.plannedDuration) parts.push(set.plannedDuration)
  if (set.plannedWeight) parts.push(`@ ${set.plannedWeight} lb`)
  return parts.join(' ') || '—'
}

function cardKey(workout: Workout): string {
  return String(workout.id ?? `${workout.date}-${workout.workoutType}`)
}

export default function Workout() {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  async function loadWorkouts() {
    setError(null)
    setLoading(true)
    try {
      const rows = await listWorkouts(200)
      setWorkouts(rows.filter((w) => !isWorkoutCompleted(w)))
    } catch {
      setError('Failed to load workouts.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadWorkouts()
  }, [])

  const allIds = useMemo(() => workouts.map(cardKey), [workouts])
  const allExpanded = allIds.length > 0 && allIds.every((id) => expandedIds.has(id))

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setExpandedIds(allExpanded ? new Set() : new Set(allIds))
  }

  async function handleDelete(workoutId: number) {
    if (!window.confirm('Delete this workout? This cannot be undone.')) return
    try {
      await deleteWorkout(workoutId)
      setWorkouts((prev) => prev.filter((w) => w.id !== workoutId))
    } catch {
      alert('Could not delete workout.')
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Workout[]>()
    for (const w of workouts) {
      const list = map.get(w.date) ?? []
      list.push(w)
      map.set(w.date, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [workouts])

  return (
    <div className="screen-content">
      <div className="workouts-header">
        <h1>Workouts</h1>
        <div className="workouts-header-actions">
          {workouts.length > 0 && (
            <button className="workouts-expand-btn" onClick={toggleAll}>
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
          <button className="workouts-refresh-btn" onClick={loadWorkouts} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <p className="goals-error">{error}</p>}

      {!loading && grouped.length === 0 && (
        <p className="placeholder-text">No planned workouts. Accept a plan in Chat to see upcoming workouts here. Completed sessions appear in the Log tab.</p>
      )}

      <div className="workouts-list">
        {grouped.map(([date, dayWorkouts]) => (
          <section key={date} className="workouts-day">
            <h2 className="workouts-date">{formatDateLabel(date)}</h2>
            {dayWorkouts.map((workout) => {
              const key = cardKey(workout)
              const expanded = expandedIds.has(key)
              return (
                <div className="workout-card" key={key}>
                  <button className="workout-card-toggle" onClick={() => toggleExpand(key)}>
                    <div className="workout-card-toggle-left">
                      <div className="workout-card-title">{workout.session ?? workout.workoutType}</div>
                      <div className="workout-card-meta">{summarizeWorkout(workout)}</div>
                    </div>
                    <span className="workout-card-chevron">{expanded ? '▲' : '▼'}</span>
                  </button>

                  {expanded && (
                    <div className="workout-card-detail">
                      {(workout.entries ?? []).map((entry, ei) => (
                        <div key={`${entry.exerciseId}-${ei}`} className="workout-card-entry">
                          <div className="workout-card-entry-name"><ExerciseTip exerciseId={entry.exerciseId} /></div>
                          <div className="workout-card-entry-sets">
                            {entry.sets.map((set, si) => (
                              <span key={si} className="workout-card-set-chip">
                                {setLabel(set)}
                              </span>
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
                      {workout.id && !isWorkoutCompleted(workout) && (
                        <div className="workout-card-delete-row">
                          <button
                            className="workout-card-delete-btn"
                            onClick={() => handleDelete(workout.id as number)}
                          >
                            Delete workout
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}
