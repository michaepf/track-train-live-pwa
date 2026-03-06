import { useEffect, useRef, useState } from 'react'
import { getWorkoutsByDate, saveWorkout, deleteWorkout } from '../lib/db.ts'
import { getToday } from '../lib/context.ts'
import ExerciseTip from '../components/ExerciseTip.tsx'
import {
  getWorkoutStatus,
  isWorkoutCompleted,
  isSetCompleted,
  type Difficulty,
  type Workout,
  type WorkoutSet,
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

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
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
  const actualToday = getToday()
  const [viewDate, setViewDate] = useState(actualToday)
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveStateByWorkout, setSaveStateByWorkout] = useState<Record<number, SaveState>>({})
  const [noteDraftByWorkout, setNoteDraftByWorkout] = useState<Record<number, string>>({})
  const [entryNoteDrafts, setEntryNoteDrafts] = useState<Record<string, string>>({})
  const [editingWorkoutId, setEditingWorkoutId] = useState<number | null>(null)
  const noteSaveTimersRef = useRef<Record<string, number>>({})

  async function loadToday() {
    setError(null)
    setLoading(true)
    try {
      const rows = await getWorkoutsByDate(viewDate)
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
  }, [viewDate])

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

  function updatePlannedSet(
    workoutId: number,
    entryIdx: number,
    setIdx: number,
    field: keyof Pick<WorkoutSet, 'plannedReps' | 'plannedWeight' | 'targetSeconds'>,
    value: number | undefined,
  ) {
    const workout = workouts.find((w) => w.id === workoutId)
    if (!workout || !workout.entries) return

    const updatedEntries = workout.entries.map((entry, ei) => {
      if (ei !== entryIdx) return entry
      return {
        ...entry,
        sets: entry.sets.map((set, si) =>
          si !== setIdx ? set : { ...set, [field]: value },
        ),
      }
    })
    const updated: Workout = { ...workout, entries: updatedEntries }
    setWorkouts((prev) => prev.map((w) => (w.id === workoutId ? updated : w)))
    scheduleNotePersist(`set:${workoutId}:${entryIdx}:${setIdx}`, updated)
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

  function toggleWarmupItem(
    workoutId: number,
    section: 'cardio' | 'cardioOptions' | 'mobility',
    idx: number,
    done: boolean,
  ) {
    const workout = workouts.find((w) => w.id === workoutId)
    if (!workout?.warmup) return

    const warmup = { ...workout.warmup }
    if (section === 'cardio' && Array.isArray(warmup.cardio)) {
      const items = [...warmup.cardio]
      items[idx] = { ...items[idx], done }
      warmup.cardio = items
    } else if (section === 'cardioOptions' && warmup.cardioOptions) {
      const items = [...warmup.cardioOptions]
      items[idx] = { ...items[idx], done }
      warmup.cardioOptions = items
    } else if (section === 'mobility' && warmup.mobility) {
      const items = [...warmup.mobility]
      items[idx] = { ...items[idx], done }
      warmup.mobility = items
    }

    const updated: Workout = { ...workout, warmup }
    setWorkouts((prev) => prev.map((w) => (w.id === workoutId ? updated : w)))
    void persistWorkout(updated)
  }

  function toggleCooldownItem(workoutId: number, idx: number, done: boolean) {
    const workout = workouts.find((w) => w.id === workoutId)
    if (!workout?.cooldown) return

    let cooldown: Workout['cooldown']
    if (Array.isArray(workout.cooldown)) {
      const items = [...workout.cooldown]
      items[idx] = { ...items[idx], done }
      cooldown = items
    } else {
      const stretching = [...(workout.cooldown.stretching ?? [])]
      stretching[idx] = { ...stretching[idx], done }
      cooldown = { ...workout.cooldown, stretching }
    }

    const updated: Workout = { ...workout, cooldown }
    setWorkouts((prev) => prev.map((w) => (w.id === workoutId ? updated : w)))
    void persistWorkout(updated)
  }

  async function handleDeleteWorkout(workoutId: number) {
    if (!window.confirm('Delete this workout? This cannot be undone.')) return
    try {
      await deleteWorkout(workoutId)
      setWorkouts((prev) => prev.filter((w) => w.id !== workoutId))
    } catch {
      alert('Could not delete workout.')
    }
  }

  return (
    <div className="screen-content">
      <div className="today-header">
        <h1>Today</h1>
        <button className="workouts-refresh-btn" onClick={loadToday} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      <div className="today-date-nav">
        <button className="today-nav-btn" onClick={() => setViewDate((d) => addDays(d, -1))}>‹</button>
        <span className="today-date">{formatDateLabel(viewDate)}</span>
        <button className="today-nav-btn" onClick={() => setViewDate((d) => addDays(d, 1))}>›</button>
        {viewDate !== actualToday && (
          <button className="today-today-btn" onClick={() => setViewDate(actualToday)}>Today</button>
        )}
      </div>

      {error && <p className="goals-error">{error}</p>}

      {!loading && workouts.length === 0 && (
        <p className="placeholder-text">
          {viewDate === actualToday
            ? 'No workouts planned for today. Ask Chat for a day-of workout or weekly plan.'
            : 'No workouts planned for this day.'}
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
                <div className="today-workout-title">
                  {workout.session ?? workout.workoutType}
                  {status !== 'not_started' && (
                    <span className={`today-status-badge today-status-badge--${status}`}>
                      {status === 'completed' ? 'Done' : 'In Progress'}
                    </span>
                  )}
                </div>
                <div className="today-workout-header-right">
                  {workout.id && !manuallyCompleted && (
                    editingWorkoutId === workout.id ? (
                      <button
                        className="today-edit-done-btn"
                        onClick={() => setEditingWorkoutId(null)}
                      >
                        Done
                      </button>
                    ) : (
                      <button
                        className="today-edit-btn"
                        onClick={() => setEditingWorkoutId(workout.id as number)}
                        title="Edit planned values"
                      >
                        Edit
                      </button>
                    )
                  )}
                  {workout.id && !isWorkoutCompleted(workout) && (
                    <button
                      className="today-delete-btn"
                      onClick={() => handleDeleteWorkout(workout.id as number)}
                      title="Delete this workout"
                    >
                      Delete
                    </button>
                  )}
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
              </div>

              {workout.warmup && (() => {
                const w = workout.warmup
                const cardioItems = Array.isArray(w.cardio) ? w.cardio : null
                const cardioOptions = w.cardioOptions ?? []
                const mobility = w.mobility ?? []
                const hasWarmup = cardioItems?.length || cardioOptions.length || mobility.length
                if (!hasWarmup) return null
                return (
                  <div className="today-phase-section">
                    <div className="today-phase-label">Warm-up</div>
                    {cardioItems && cardioItems.length > 0 && (
                      <div className="today-checklist">
                        {cardioItems.map((item, i) => (
                          <label key={i} className="today-checklist-item">
                            <input
                              type="checkbox"
                              checked={item.done ?? false}
                              onChange={(e) =>
                                workout.id && toggleWarmupItem(workout.id, 'cardio', i, e.target.checked)
                              }
                            />
                            <span className={item.done ? 'today-checklist-done' : ''}>
                              {item.name ?? item.exercise ?? 'Item'}
                              {(item.reps || item.duration) && (
                                <span className="today-checklist-detail"> — {item.reps ?? item.duration}</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    {cardioOptions.length > 0 && (
                      <div className="today-checklist">
                        {cardioOptions.map((item, i) => (
                          <label key={i} className="today-checklist-item">
                            <input
                              type="checkbox"
                              checked={item.done ?? false}
                              onChange={(e) =>
                                workout.id && toggleWarmupItem(workout.id, 'cardioOptions', i, e.target.checked)
                              }
                            />
                            <span className={item.done ? 'today-checklist-done' : ''}>
                              {item.name ?? item.exercise ?? 'Item'}
                              {(item.reps || item.duration) && (
                                <span className="today-checklist-detail"> — {item.reps ?? item.duration}</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    {mobility.length > 0 && (
                      <div className="today-checklist">
                        <div className="today-checklist-title">Mobility</div>
                        {mobility.map((item, i) => (
                          <label key={i} className="today-checklist-item">
                            <input
                              type="checkbox"
                              checked={item.done ?? false}
                              onChange={(e) =>
                                workout.id && toggleWarmupItem(workout.id, 'mobility', i, e.target.checked)
                              }
                            />
                            <span className={item.done ? 'today-checklist-done' : ''}>
                              {item.name ?? item.exercise ?? 'Item'}
                              {(item.reps || item.duration) && (
                                <span className="today-checklist-detail"> — {item.reps ?? item.duration}</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              {(workout.entries ?? []).map((entry, entryIdx) => (
                <div key={`${entry.exerciseId}-${entryIdx}`} className="today-entry">
                  <div className="today-entry-name"><ExerciseTip exerciseId={entry.exerciseId} /></div>
                  {entry.sets.map((set, setIdx) => {
                    const isEditing = editingWorkoutId === workout.id && !isSetCompleted(set)
                    return (
                      <div key={`${entry.exerciseId}-${setIdx}`} className="today-set-row">
                        {isEditing ? (
                          <div className="today-set-edit">
                            <span className="today-set-edit-label">Set {setIdx + 1}</span>
                            {set.targetSeconds !== undefined ? (
                              <label className="today-set-edit-field">
                                <input
                                  type="number"
                                  className="today-set-edit-input"
                                  min={1}
                                  value={set.targetSeconds ?? ''}
                                  onChange={(e) => {
                                    const v = parseInt(e.target.value)
                                    workout.id && updatePlannedSet(workout.id, entryIdx, setIdx, 'targetSeconds', isNaN(v) ? undefined : v)
                                  }}
                                />
                                <span className="today-set-edit-unit">sec</span>
                              </label>
                            ) : (
                              <label className="today-set-edit-field">
                                <input
                                  type="number"
                                  className="today-set-edit-input"
                                  min={1}
                                  value={set.plannedReps ?? ''}
                                  onChange={(e) => {
                                    const v = parseInt(e.target.value)
                                    workout.id && updatePlannedSet(workout.id, entryIdx, setIdx, 'plannedReps', isNaN(v) ? undefined : v)
                                  }}
                                />
                                <span className="today-set-edit-unit">reps</span>
                              </label>
                            )}
                            <label className="today-set-edit-field">
                              <input
                                type="number"
                                className="today-set-edit-input"
                                min={0}
                                step={2.5}
                                value={set.plannedWeight ?? ''}
                                placeholder="—"
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value)
                                  workout.id && updatePlannedSet(workout.id, entryIdx, setIdx, 'plannedWeight', isNaN(v) ? undefined : v)
                                }}
                              />
                              <span className="today-set-edit-unit">lb</span>
                            </label>
                          </div>
                        ) : (
                          <span className={`today-set-label${isSetCompleted(set) && editingWorkoutId === workout.id ? ' today-set-label--locked' : ''}`}>
                            Set {setIdx + 1}: {setTargetLabel(set)}
                          </span>
                        )}
                        {!isEditing && (
                          <div className="today-diff-buttons">
                            <button
                              className={`today-diff-btn ${set.difficulty === 'could_not_complete' ? 'is-active is-fail' : ''}`}
                              disabled={manuallyCompleted}
                              onClick={() =>
                                workout.id &&
                                updateSetDifficulty(workout.id, entryIdx, setIdx, 'could_not_complete')
                              }
                            >
                              Fail
                            </button>
                            <button
                              className={`today-diff-btn ${set.difficulty === 'completed' ? 'is-active is-done' : ''}`}
                              disabled={manuallyCompleted}
                              onClick={() =>
                                workout.id &&
                                updateSetDifficulty(workout.id, entryIdx, setIdx, 'completed')
                              }
                            >
                              Done
                            </button>
                            <button
                              className={`today-diff-btn ${set.difficulty === 'too_easy' ? 'is-active is-easy' : ''}`}
                              disabled={manuallyCompleted}
                              onClick={() =>
                                workout.id &&
                                updateSetDifficulty(workout.id, entryIdx, setIdx, 'too_easy')
                              }
                            >
                              Easy
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
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
                          disabled={manuallyCompleted}
                          onClick={() =>
                            workout.id &&
                            updateCardioDifficulty(workout.id, optionIdx, 'could_not_complete')
                          }
                        >
                          Fail
                        </button>
                        <button
                          className={`today-diff-btn ${option.difficulty === 'completed' ? 'is-active is-done' : ''}`}
                          disabled={manuallyCompleted}
                          onClick={() =>
                            workout.id &&
                            updateCardioDifficulty(workout.id, optionIdx, 'completed')
                          }
                        >
                          Done
                        </button>
                        <button
                          className={`today-diff-btn ${option.difficulty === 'too_easy' ? 'is-active is-easy' : ''}`}
                          disabled={manuallyCompleted}
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

              {workout.cooldown && (() => {
                const cd = workout.cooldown
                const stretches = Array.isArray(cd) ? cd : (cd.stretching ?? [])
                const notes = Array.isArray(cd) ? undefined : cd.notes
                if (!stretches.length && !notes) return null
                return (
                  <div className="today-phase-section">
                    <div className="today-phase-label">Cool-down</div>
                    {stretches.length > 0 && (
                      <div className="today-checklist">
                        {stretches.map((item, i) => (
                          <label key={i} className="today-checklist-item">
                            <input
                              type="checkbox"
                              checked={item.done ?? false}
                              onChange={(e) =>
                                workout.id && toggleCooldownItem(workout.id, i, e.target.checked)
                              }
                            />
                            <span className={item.done ? 'today-checklist-done' : ''}>
                              {item.name ?? item.exercise ?? 'Item'}
                              {(item.reps || item.duration) && (
                                <span className="today-checklist-detail"> — {item.reps ?? item.duration}</span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    {notes && <p className="today-phase-notes">{notes}</p>}
                  </div>
                )
              })()}

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
