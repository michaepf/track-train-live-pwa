import { useState } from 'react'
import { getExercise, getExerciseName } from '../data/exercises.ts'

interface ExerciseTipProps {
  exerciseId: string
}

export default function ExerciseTip({ exerciseId }: ExerciseTipProps) {
  const [open, setOpen] = useState(false)
  const info = getExercise(exerciseId)
  const name = info?.name ?? getExerciseName(exerciseId)

  if (!info) {
    return <>{name}</>
  }

  return (
    <>
      <button className="exercise-tip-trigger" onClick={() => setOpen((o) => !o)}>
        {name}
        <span className="exercise-tip-icon" aria-hidden="true">ⓘ</span>
      </button>
      {open && (
        <div className="exercise-tip-panel">
          <div className="exercise-tip-desc">{info.description}</div>
          {info.tags.length > 0 && (
            <div className="exercise-tip-tags">
              {info.tags.map((tag) => (
                <span key={tag} className="exercise-tip-tag">{tag}</span>
              ))}
            </div>
          )}
          <a
            className="exercise-tip-demo"
            href={`https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' exercise form')}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Watch demo
          </a>
        </div>
      )}
    </>
  )
}
