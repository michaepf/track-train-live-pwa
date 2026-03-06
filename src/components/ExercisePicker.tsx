import { useEffect, useRef, useState } from 'react'
import { EXERCISES } from '../data/exercises.ts'
import type { Exercise } from '../data/exercises.ts'
import { getCustomExercises } from '../lib/db.ts'

interface ExercisePickerProps {
  currentExerciseId: string
  onSelect: (id: string) => void
  onClose: () => void
}

export default function ExercisePicker({ currentExerciseId, onSelect, onClose }: ExercisePickerProps) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [customExercises, setCustomExercises] = useState<Exercise[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getCustomExercises().then(setCustomExercises)
    searchRef.current?.focus()
  }, [])

  const current = EXERCISES.find((e) => e.id === currentExerciseId)
  const currentTags = current?.tags ?? []

  const allExercises = [...EXERCISES, ...customExercises]

  const filtered = allExercises.filter((ex) => {
    if (!ex?.id || !ex?.name) return false
    if (ex.id === currentExerciseId) return false
    const matchesQuery = !query || ex.name.toLowerCase().includes(query.toLowerCase())
    const exTags = ex.tags ?? []
    const matchesTags = showAll || currentTags.length === 0 || currentTags.some((t) => exTags.includes(t))
    return matchesQuery && matchesTags
  })

  return (
    <div className="exercise-picker-overlay" onClick={onClose}>
      <div className="exercise-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="exercise-picker-header">
          <input
            ref={searchRef}
            className="exercise-picker-search"
            type="text"
            placeholder="Search exercises..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="exercise-picker-close" onClick={onClose}>✕</button>
        </div>
        {currentTags.length > 0 && (
          <div className="exercise-picker-filter">
            <button
              className={`exercise-picker-filter-btn${!showAll ? ' is-active' : ''}`}
              onClick={() => setShowAll(false)}
            >
              Similar
            </button>
            <button
              className={`exercise-picker-filter-btn${showAll ? ' is-active' : ''}`}
              onClick={() => setShowAll(true)}
            >
              All
            </button>
          </div>
        )}
        <div className="exercise-picker-list">
          {filtered.length === 0 && (
            <p className="exercise-picker-empty">No exercises found.</p>
          )}
          {filtered.map((ex) => (
            <button
              key={ex.id}
              className="exercise-picker-item"
              onClick={() => onSelect(ex.id)}
            >
              <span className="exercise-picker-item-name">{ex.name}</span>
              <span className="exercise-picker-item-tags">{(ex.tags ?? []).join(' · ')}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
