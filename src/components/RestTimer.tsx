import { useEffect, useRef, useState } from 'react'

interface RestTimerProps {
  /** Total rest duration in seconds */
  duration: number
  /** Called when user dismisses or timer expires */
  onDismiss: () => void
}

export default function RestTimer({ duration, onDismiss }: RestTimerProps) {
  const [remaining, setRemaining] = useState(duration)
  const [paused, setPaused] = useState(false)
  const startRef = useRef(Date.now())
  const elapsedBeforePauseRef = useRef(0)

  useEffect(() => {
    if (paused) return

    startRef.current = Date.now()

    const id = setInterval(() => {
      const elapsed = elapsedBeforePauseRef.current + (Date.now() - startRef.current) / 1000
      const left = Math.max(0, duration - elapsed)
      setRemaining(left)

      if (left <= 0) {
        clearInterval(id)
        try { navigator.vibrate?.(200) } catch { /* no-op */ }
      }
    }, 250)

    return () => clearInterval(id)
  }, [duration, paused])

  function togglePause() {
    if (paused) {
      // Resuming — reset start time, keep accumulated elapsed
      setPaused(false)
    } else {
      // Pausing — accumulate elapsed so far
      elapsedBeforePauseRef.current += (Date.now() - startRef.current) / 1000
      setPaused(true)
    }
  }

  const expired = remaining <= 0
  const minutes = Math.floor(remaining / 60)
  const seconds = Math.ceil(remaining % 60)
  const display = expired ? '0:00' : `${minutes}:${seconds.toString().padStart(2, '0')}`

  // Progress ring
  const fraction = duration > 0 ? remaining / duration : 0
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - fraction)

  return (
    <div className={`rest-timer${expired ? ' rest-timer--expired' : ''}`}>
      <svg className="rest-timer-ring" width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={radius} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="22" cy="22" r={radius}
          fill="none"
          stroke={expired ? 'var(--accent)' : 'var(--accent)'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 22 22)"
          className="rest-timer-progress"
        />
      </svg>

      <button className="rest-timer-time" onClick={togglePause}>
        <span className="rest-timer-display">{display}</span>
        <span className="rest-timer-hint">
          {expired ? 'done' : paused ? 'paused' : 'rest'}
        </span>
      </button>

      <button className="rest-timer-dismiss" onClick={onDismiss} aria-label="Dismiss timer">
        &times;
      </button>
    </div>
  )
}

// ─── Rest duration helper ───────────────────────────────────────────────────

const COMPOUND_REST = 120 // 2:00
const DEFAULT_REST = 60   // 1:00

const COMPOUND_TAGS = new Set(['barbell', 'rack'])

export function getRestDuration(tags: string[]): number {
  return tags.some((t) => COMPOUND_TAGS.has(t)) ? COMPOUND_REST : DEFAULT_REST
}
