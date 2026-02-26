import { useEffect, useState } from 'react'
import { listWorkouts } from '../lib/db.ts'
import { getExerciseName } from '../data/exercises.ts'
import { isWorkoutCompleted, type Workout } from '../lib/schemas/index.ts'

function formatDateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function workoutSummary(workout: Workout): string {
  const parts: string[] = []
  const entryCount = workout.entries?.length ?? 0
  const cardioCount = workout.cardioOptions?.length ?? 0
  if (entryCount > 0) parts.push(`${entryCount} exercise${entryCount !== 1 ? 's' : ''}`)
  if (cardioCount > 0) parts.push(`${cardioCount} cardio option${cardioCount !== 1 ? 's' : ''}`)
  return parts.join(' + ') || 'No exercises'
}

function groupByDate(workouts: Workout[]): [string, Workout[]][] {
  const map = new Map<string, Workout[]>()
  for (const w of workouts) {
    const existing = map.get(w.date) ?? []
    map.set(w.date, [...existing, w])
  }
  return Array.from(map.entries())
}

export default function History() {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    setLoading(true)
    try {
      const rows = await listWorkouts(60)
      setWorkouts(rows.filter(isWorkoutCompleted))
    } catch {
      setError('Failed to load history.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const grouped = groupByDate(workouts)

  return (
    <div className="screen-content">
      <div className="workouts-header">
        <h1>Log</h1>
        <button className="workouts-refresh-btn" onClick={load} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <p className="goals-error">{error}</p>}

      {!loading && workouts.length === 0 && (
        <p className="placeholder-text">No completed workouts yet. Finish a session and it will appear here.</p>
      )}

      <div className="workouts-list">
        {grouped.map(([date, sessions]) => (
          <div key={date} className="workouts-day">
            <div className="workouts-date">{formatDateLabel(date)}</div>
            {sessions.map((workout) => {
              return (
                <div key={workout.id} className="workout-card history-card">
                  <div className="workout-card-title">{workout.session ?? workout.workoutType ?? 'Workout'}</div>
                  <div className="workout-card-meta">{workoutSummary(workout)}</div>
                  {(workout.entries ?? []).length > 0 && (
                    <ul className="workout-detail-list">
                      {(workout.entries ?? []).map((entry, i) => (
                        <li key={i}>{getExerciseName(entry.exerciseId)}</li>
                      ))}
                    </ul>
                  )}
                  {(workout.cardioOptions ?? []).length > 0 && (
                    <ul className="workout-detail-list">
                      {(workout.cardioOptions ?? []).map((opt, i) => (
                        <li key={i}>{opt.label}{opt.target ? ` (${opt.target})` : ''}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
