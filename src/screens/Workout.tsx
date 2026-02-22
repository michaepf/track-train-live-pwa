import { useEffect, useMemo, useState } from 'react'
import { listWorkouts } from '../lib/db.ts'
import type { Workout } from '../lib/schemas/index.ts'

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

  if (exerciseCount > 0) {
    parts.push(`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`)
  }
  if (cardioCount > 0) {
    parts.push(`${cardioCount} cardio option${cardioCount === 1 ? '' : 's'}`)
  }

  return parts.join(' • ') || 'No details'
}

function humanizeExerciseId(exerciseId: string): string {
  return exerciseId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function Workout() {
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadWorkouts() {
    setError(null)
    setLoading(true)
    try {
      const rows = await listWorkouts(200)
      setWorkouts(rows)
    } catch {
      setError('Failed to load workouts.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadWorkouts()
  }, [])

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
        <button className="workouts-refresh-btn" onClick={loadWorkouts} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <p className="goals-error">{error}</p>}

      {!loading && grouped.length === 0 && (
        <p className="placeholder-text">No workouts yet. Accept a plan in Chat to save workouts here.</p>
      )}

      <div className="workouts-list">
        {grouped.map(([date, dayWorkouts]) => (
          <section key={date} className="workouts-day">
            <h2 className="workouts-date">{formatDateLabel(date)}</h2>
            {dayWorkouts.map((workout) => (
              <div className="workout-card" key={workout.id ?? `${date}-${workout.workoutType}`}>
                <div className="workout-card-title">{workout.session ?? workout.workoutType}</div>
                <div className="workout-card-meta">{summarizeWorkout(workout)}</div>
                {(workout.entries?.length ?? 0) > 0 && (
                  <ul className="workout-detail-list">
                    {(workout.entries ?? []).map((entry, i) => (
                      <li key={`${entry.exerciseId}-${i}`}>
                        {humanizeExerciseId(entry.exerciseId)} ({entry.sets.length} set
                        {entry.sets.length === 1 ? '' : 's'})
                      </li>
                    ))}
                  </ul>
                )}
                {(workout.cardioOptions?.length ?? 0) > 0 && (
                  <ul className="workout-detail-list">
                    {(workout.cardioOptions ?? []).map((opt, i) => (
                      <li key={`${opt.label}-${i}`}>{opt.label}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
