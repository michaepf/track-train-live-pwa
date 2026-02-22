import { useEffect, useRef, useState } from 'react'
import { getWorkoutsByDate, saveWorkout } from '../lib/db.ts'
import { getToday } from '../lib/context.ts'
import { getExerciseName } from '../data/exercises.ts'
import {
  getWorkoutStatus,
  type Difficulty,
  type Workout,
} from '../lib/schemas/index.ts'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function formatDateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}


function setTargetLabel(set: {
  plannedReps?: number
  targetSeconds?: number
  plannedDuration?: string
  plannedWeight?: number
}): string {
  const parts: string[] = []
  if (set.plannedReps) parts.push(`${set.plannedReps} reps`)
  if (set.targetSeconds) parts.push(`${set.targetSeconds}s`)
  if (set.plannedDuration) parts.push(set.plannedDuration)
  if (set.plannedWeight) parts.push(`@ ${set.plannedWeight} lb`)
  return parts.join(' • ') || 'Set'
}

function nextDifficulty(current: Difficulty | undefined, desired: Difficulty): Difficulty | undefined {
  return current === desired ? undefined : desired
}

export default function Today() {
  const [today] = useState(getToday())
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveStateByWorkout, setSaveStateByWorkout] = useState<Record<number, SaveState>>({})
  const [noteDraftByWorkout, setNoteDraftByWorkout] = useState<Record<number, string>>({})
  const [entryNoteDrafts, setEntryNoteDrafts] = useState<Record<string, string>>({})
  const noteSaveTimersRef = useRef<Record<string, number>>({})

  async function loadToday() {
    setError(null)
    setLoading(true)
    try {
      const rows = await getWorkoutsByDate(today)
      setWorkouts(rows)
      const drafts: Record<number, string> = {}
      const entryDrafts: Record<string, string> = {}
      for (const workout of rows) {
        if (!workout.id) continue
        const latestUserNote = [...(workout.feedback ?? [])]
          .reverse()
          .find((f) => f.source === 'user')?.note
        drafts[workout.id] = latestUserNote ?? ''
        for (let i = 0; i < (workout.entries ?? []).length; i++) {
          const entry = workout.entries?.[i]
          if (!entry) continue
          entryDrafts[`${workout.id}:${i}`] = entry.notes ?? ''
        }
      }
      setNoteDraftByWorkout(drafts)
      setEntryNoteDrafts(entryDrafts)
    } catch {
      setError('Failed to load today\'s workouts.')
    } finally {
      setLoading(false)
    }
  }

  function scheduleNotePersist(key: string, workout: Workout) {
    const existing = noteSaveTimersRef.current[key]
    if (existing) window.clearTimeout(existing)
    noteSaveTimersRef.current[key] = window.setTimeout(() => {
      void persistWorkout(workout)
      delete noteSaveTimersRef.current[key]
    }, 350)
  }

  function updateWorkoutNote(workoutId: number, value: string) {
    const workout = workouts.find((w) => w.id === workoutId)
    if (!workout) return
    const note = value.trim()

    const previous = (workout.feedback ?? []).filter((f) => f.source !== 'user')
    const updated: Workout = {
      ...workout,
      feedback: note
        ? [
            ...previous,
            {
              source: 'user',
              note,
              timestamp: new Date().toISOString(),
            },
          ]
        : previous,
    }
    setWorkouts((prev) => prev.map((w) => (w.id === workoutId ? updated : w)))
    scheduleNotePersist(`workout:${workoutId}`, updated)
  }

  function markWorkoutComplete(workoutId: number) {
    const workout = workouts.find((w) => w.id === workoutId)
    if (!workout) return
    if (workout.status === 'completed') {
      return
    }

    const updated: Workout = {
      ...workout,
      status: 'completed',
      completedAt: new Date().toISOString(),
    }
    setWorkouts((prev) => prev.map((w) => (w.id === workoutId ? updated : w)))
    void persistWorkout(updated)
  }

  function updateEntryNote(workoutId: number, entryIdx: number, value: string) {
    const workout = workouts.find((w) => w.id === workoutId)
    if (!workout || !workout.entries) return
    const note = value.trim()

    const updatedEntries = workout.entries.map((entry, i) =>
      i !== entryIdx ? entry : { ...entry, notes: note || null },
    )
    const updated: Workout = { ...workout, entries: updatedEntries }
    setWorkouts((prev) => prev.map((w) => (w.id === workoutId ? updated : w)))
    scheduleNotePersist(`entry:${workoutId}:${entryIdx}`, updated)
  }

  useEffect(() => {
    loadToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  useEffect(() => {
    return () => {
      for (const timer of Object.values(noteSaveTimersRef.current)) {
        window.clearTimeout(timer)
      }
      noteSaveTimersRef.current = {}
    }
  }, [])

  async function persistWorkout(updated: Workout) {
    const id = updated.id
    if (!id) return

    setSaveStateByWorkout((prev) => ({ ...prev, [id]: 'saving' }))
    try {
      const saved = await saveWorkout(updated)
      setWorkouts((prev) => prev.map((w) => (w.id === saved.id ? saved : w)))
      setSaveStateByWorkout((prev) => ({ ...prev, [id]: 'saved' }))
      window.setTimeout(() => {
        setSaveStateByWorkout((prev) => ({ ...prev, [id]: 'idle' }))
      }, 900)
    } catch {
      setSaveStateByWorkout((prev) => ({ ...prev, [id]: 'error' }))
    }
  }

  function updateSetDifficulty(
    workoutId: number,
    entryIdx: number,
    setIdx: number,
    desired: Difficulty,
  ) {
    const workout = workouts.find((w) => w.id === workoutId)
    if (!workout || !workout.entries) return

    const updatedEntries = workout.entries.map((entry, ei) => {
      if (ei !== entryIdx) return entry
      return {
        ...entry,
        sets: entry.sets.map((set, si) =>
          si !== setIdx ? set : { ...set, difficulty: nextDifficulty(set.difficulty, desired) },
        ),
      }
    })

    const updated: Workout = { ...workout, entries: updatedEntries }
    setWorkouts((prev) => prev.map((w) => (w.id === workoutId ? updated : w)))
    void persistWorkout(updated)
  }

  function updateCardioDifficulty(
    workoutId: number,
    optionIdx: number,
    desired: Difficulty,
  ) {
    const workout = workouts.find((w) => w.id === workoutId)
    if (!workout || !workout.cardioOptions) return

    const updatedOptions = workout.cardioOptions.map((option, oi) =>
      oi !== optionIdx
        ? option
        : { ...option, difficulty: nextDifficulty(option.difficulty, desired) },
    )

    const updated: Workout = { ...workout, cardioOptions: updatedOptions }
    setWorkouts((prev) => prev.map((w) => (w.id === workoutId ? updated : w)))
    void persistWorkout(updated)
  }

  return (
    <div className="screen-content">
      <div className="today-header">
        <h1>Today</h1>
        <button className="workouts-refresh-btn" onClick={loadToday} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      <div className="today-date">{formatDateLabel(today)}</div>

      {error && <p className="goals-error">{error}</p>}

      {!loading && workouts.length === 0 && (
        <p className="placeholder-text">
          No workouts planned for today. Ask Chat for a day-of workout or weekly plan.
        </p>
      )}

      <div className="today-list">
        {workouts.map((workout) => {
          const saveState = workout.id ? (saveStateByWorkout[workout.id] ?? 'idle') : 'idle'
          const status = getWorkoutStatus(workout)
          const manuallyCompleted = workout.status === 'completed'
          return (
            <section className="today-workout" key={workout.id ?? `${workout.date}-${workout.session}`}>
              <div className="today-workout-header">
                <div className="today-workout-title">{workout.session ?? workout.workoutType}</div>
                <span
                  className={`today-save-indicator today-save-indicator--${saveState}`}
                  title={
                    saveState === 'saving'
                      ? 'Saving...'
                      : saveState === 'saved'
                        ? 'Saved'
                        : saveState === 'error'
                          ? 'Save failed'
                          : 'Idle'
                  }
                />
              </div>

              {(workout.entries ?? []).map((entry, entryIdx) => (
                <div key={`${entry.exerciseId}-${entryIdx}`} className="today-entry">
                  <div className="today-entry-name">{getExerciseName(entry.exerciseId)}</div>
                  {entry.sets.map((set, setIdx) => (
                    <div key={`${entry.exerciseId}-${setIdx}`} className="today-set-row">
                      <span className="today-set-label">
                        Set {setIdx + 1}: {setTargetLabel(set)}
                      </span>
                      <div className="today-diff-buttons">
                        <button
                          className={`today-diff-btn ${set.difficulty === 'could_not_complete' ? 'is-active is-fail' : ''}`}
                          onClick={() =>
                            workout.id &&
                            updateSetDifficulty(workout.id, entryIdx, setIdx, 'could_not_complete')
                          }
                        >
                          Fail
                        </button>
                        <button
                          className={`today-diff-btn ${set.difficulty === 'completed' ? 'is-active is-done' : ''}`}
                          onClick={() =>
                            workout.id &&
                            updateSetDifficulty(workout.id, entryIdx, setIdx, 'completed')
                          }
                        >
                          Done
                        </button>
                        <button
                          className={`today-diff-btn ${set.difficulty === 'too_easy' ? 'is-active is-easy' : ''}`}
                          onClick={() =>
                            workout.id &&
                            updateSetDifficulty(workout.id, entryIdx, setIdx, 'too_easy')
                          }
                        >
                          Easy
                        </button>
                      </div>
                    </div>
                  ))}
                  {workout.id && (
                    <div className="today-entry-note-block">
                      <label className="today-note-label">Exercise notes (optional)</label>
                      <textarea
                        className="today-note-input today-note-input--short"
                        rows={1}
                        placeholder="e.g., Had to reduce weight or adjust range of motion."
                        value={entryNoteDrafts[`${workout.id}:${entryIdx}`] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value
                          setEntryNoteDrafts((prev) => ({
                            ...prev,
                            [`${workout.id}:${entryIdx}`]: value,
                          }))
                          updateEntryNote(workout.id as number, entryIdx, value)
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}

              {(workout.cardioOptions ?? []).length > 0 && (
                <div className="today-entry">
                  <div className="today-entry-name">Cardio</div>
                  {(workout.cardioOptions ?? []).map((option, optionIdx) => (
                    <div key={`${option.label}-${optionIdx}`} className="today-set-row">
                      <span className="today-set-label">
                        {option.label}{option.target ? ` (${option.target})` : ''}
                      </span>
                      <div className="today-diff-buttons">
                        <button
                          className={`today-diff-btn ${option.difficulty === 'could_not_complete' ? 'is-active is-fail' : ''}`}
                          onClick={() =>
                            workout.id &&
                            updateCardioDifficulty(workout.id, optionIdx, 'could_not_complete')
                          }
                        >
                          Fail
                        </button>
                        <button
                          className={`today-diff-btn ${option.difficulty === 'completed' ? 'is-active is-done' : ''}`}
                          onClick={() =>
                            workout.id &&
                            updateCardioDifficulty(workout.id, optionIdx, 'completed')
                          }
                        >
                          Done
                        </button>
                        <button
                          className={`today-diff-btn ${option.difficulty === 'too_easy' ? 'is-active is-easy' : ''}`}
                          onClick={() =>
                            workout.id &&
                            updateCardioDifficulty(workout.id, optionIdx, 'too_easy')
                          }
                        >
                          Easy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="today-note-block">
                <label className="today-note-label">Workout notes for your coach</label>
                <textarea
                  className="today-note-input"
                  rows={3}
                  placeholder="e.g., Had to drop bench from 40 lb to 30 lb; right shoulder felt tight."
                  value={workout.id ? (noteDraftByWorkout[workout.id] ?? '') : ''}
                  onChange={(e) => {
                    if (!workout.id) return
                    const value = e.target.value
                    setNoteDraftByWorkout((prev) => ({ ...prev, [workout.id as number]: value }))
                    updateWorkoutNote(workout.id as number, value)
                  }}
                />
              </div>

              <div className="today-complete-row">
                <button
                  className="today-complete-btn"
                  onClick={() => workout.id && markWorkoutComplete(workout.id)}
                  disabled={!workout.id || manuallyCompleted || saveState === 'saving'}
                >
                  {status === 'completed' ? 'Workout complete' : 'Complete workout'}
                </button>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
