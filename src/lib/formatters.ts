/**
 * Shared formatting utilities used across screens and components.
 * Consolidates duplicated helpers from Today, Workout, History, ToolCard, and chatTools.
 */

// ─── Date formatting ─────────────────────────────────────────────────────────

export function formatDateLabel(date: string, style: 'short' | 'long' = 'long'): string {
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString('en-US', {
    weekday: style,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-CA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

// ─── Set / workout formatting ────────────────────────────────────────────────

export function formatSetLabel(set: {
  plannedReps?: number
  plannedWeight?: number
  targetSeconds?: number
  plannedDuration?: string
}): string {
  const parts: string[] = []
  if (set.plannedReps) parts.push(`${set.plannedReps} reps`)
  if (set.targetSeconds) parts.push(`${set.targetSeconds}s`)
  if (set.plannedDuration) parts.push(set.plannedDuration)
  if (set.plannedWeight) parts.push(`@ ${set.plannedWeight} lb`)
  return parts.join(' ') || '—'
}

export function summarizeWorkout(workout: {
  entries?: unknown[]
  cardioOptions?: unknown[]
}): string {
  const parts: string[] = []
  const entryCount = workout.entries?.length ?? 0
  const cardioCount = workout.cardioOptions?.length ?? 0
  if (entryCount > 0) parts.push(`${entryCount} exercise${entryCount === 1 ? '' : 's'}`)
  if (cardioCount > 0) parts.push(`${cardioCount} cardio option${cardioCount === 1 ? '' : 's'}`)
  return parts.join(' • ') || 'No details'
}

// ─── Grouping ────────────────────────────────────────────────────────────────

export function groupByDate<T extends { date: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const existing = map.get(item.date) ?? []
    map.set(item.date, [...existing, item])
  }
  return Array.from(map.entries())
}
