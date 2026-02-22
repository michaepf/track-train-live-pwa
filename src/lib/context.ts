/**
 * System prompt assembly and context utilities.
 *
 * Responsible for:
 * - Building the system prompt for each conversation type
 * - Computing the D0–D6 planning window
 * - Formatting workout history for injection into context
 * - Goal review trigger logic
 */

import type { Goals, Workout } from './schemas/index.ts'

// ─── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns today's date in YYYY-MM-DD format using the device's local timezone.
 * Per contract: "Today" is always computed this way throughout the app.
 */
export function getToday(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

/**
 * Converts a YYYY-MM-DD date string to an ISO 8601 week key (YYYY-WNN).
 * ISO week: starts Monday, week 1 contains the year's first Thursday.
 */
export function getWeekKey(dateStr: string): string {
  // Use noon UTC to avoid DST boundary edge cases
  const date = new Date(`${dateStr}T12:00:00Z`)
  const dow = date.getUTCDay() // 0=Sun … 6=Sat
  const isoDay = dow === 0 ? 7 : dow // ISO: 1=Mon … 7=Sun

  // Find Thursday of this ISO week
  const thursday = new Date(date)
  thursday.setUTCDate(date.getUTCDate() + 4 - isoDay)

  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)

  return `${thursday.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

// ─── Planning window ───────────────────────────────────────────────────────────

export interface PlanningDay {
  /** YYYY-MM-DD in device local timezone */
  date: string
  /** Human-readable label, e.g. "Today (Mon Feb 24)" */
  label: string
}

/**
 * Returns the D0–D6 planning window — 7 days starting from today —
 * with human-readable labels for injection into the system prompt.
 *
 * Dates are computed in the device's local timezone to match workout date storage.
 */
export function getPlanningWindow(): PlanningDay[] {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = new Date()
  const days: PlanningDay[] = []

  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + i)

    const dateStr = d.toLocaleDateString('en-CA', { timeZone: tz })
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })
    const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: tz })
    const dayNum = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: tz })

    let label: string
    if (i === 0) label = `Today (${weekday} ${month} ${dayNum})`
    else if (i === 1) label = `Tomorrow (${weekday} ${month} ${dayNum})`
    else label = `${weekday} ${month} ${dayNum}`

    days.push({ date: dateStr, label })
  }

  return days
}

// ─── Goal review trigger ───────────────────────────────────────────────────────

const SIX_WEEKS_MS = 6 * 7 * 24 * 60 * 60 * 1000

/**
 * Returns true if goals should be reviewed:
 * - explicitly flagged (pendingReview = true), or
 * - older than 6 weeks
 */
export function needsGoalReview(goals: Goals): boolean {
  if (goals.pendingReview) return true
  return Date.now() - new Date(goals.updatedAt).getTime() > SIX_WEEKS_MS
}

// ─── Workout formatting ────────────────────────────────────────────────────────

function formatSet(set: {
  plannedReps?: number
  targetSeconds?: number
  plannedWeight?: number
  difficulty?: string
}): string {
  const parts: string[] = []
  if (set.plannedReps) parts.push(`${set.plannedReps} reps`)
  if (set.targetSeconds) parts.push(`${set.targetSeconds}s hold`)
  if (set.plannedWeight) parts.push(`@ ${set.plannedWeight}lb`)
  if (set.difficulty) parts.push(`[${set.difficulty}]`)
  return parts.join(' ') || 'set'
}

function formatWorkout(workout: Workout): string {
  const lines: string[] = [
    `Date: ${workout.date}`,
    `Type: ${workout.workoutType ?? 'unknown'}`,
  ]

  if (workout.entries && workout.entries.length > 0) {
    lines.push('Exercises:')
    for (const entry of workout.entries) {
      const setStrs = entry.sets.map(formatSet).join(', ')
      lines.push(`  ${entry.exerciseId}: ${setStrs}`)
    }
  }

  if (workout.cardioOptions && workout.cardioOptions.length > 0) {
    lines.push('Cardio:')
    for (const opt of workout.cardioOptions) {
      const diff = opt.difficulty ? ` [${opt.difficulty}]` : ''
      lines.push(`  ${opt.label}${diff}`)
    }
  }

  return lines.join('\n')
}

// ─── History context builder ───────────────────────────────────────────────────

/**
 * Builds the history section for the system prompt.
 *
 * Strategy:
 * - Last 3 weeks: full workout detail
 * - Older weeks: summary text (if available in summaries map)
 *
 * Workouts should be passed sorted most-recent-first (as returned by listWorkouts).
 */
export function buildHistoryContext(
  workouts: Workout[],
  summaries: Map<string, string>,
): string {
  if (workouts.length === 0 && summaries.size === 0) return ''

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 21)
  const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: tz })

  const recentWorkouts = workouts.filter((w) => w.date >= cutoffStr)
  const olderWorkouts = workouts.filter((w) => w.date < cutoffStr)

  const parts: string[] = []

  // Older weeks: use summaries if available
  const olderWeeks = new Set(olderWorkouts.map((w) => getWeekKey(w.date)))
  for (const [weekKey, summary] of summaries) {
    if (olderWeeks.has(weekKey)) {
      parts.push(`Week ${weekKey} summary:\n${summary}`)
    }
  }

  // Recent workouts: full detail (oldest first for readability)
  if (recentWorkouts.length > 0) {
    parts.push('Recent workouts (last 3 weeks):')
    for (const workout of [...recentWorkouts].reverse()) {
      parts.push(formatWorkout(workout))
      parts.push('---')
    }
  }

  return parts.join('\n\n')
}

// ─── System prompt builder ─────────────────────────────────────────────────────

type ConvMode = 'onboarding' | 'goal_review' | 'planning'

const ROLE_INSTRUCTIONS: Record<ConvMode, string> = {
  onboarding: `You are an AI personal trainer helping a new user establish their training goals. Ask thoughtful questions about their fitness background, current goals, available equipment and time, and any physical limitations. When you have gathered enough to write a useful goals summary, call the \`propose_goals\` tool. Keep the tone conversational and encouraging. Do not dump all questions at once — have a natural back-and-forth.`,

  goal_review: `You are an AI personal trainer reviewing a user's training goals. Acknowledge what's currently set, ask about recent changes or new priorities, and when ready, call \`propose_goals\` with an updated summary. Keep it focused — this should be a short review, not a full re-onboarding.`,

  planning: `You are an AI personal trainer helping plan the user's workouts. Review the training history and goals provided, then propose a practical workout plan. When ready, call \`propose_workout\` with an array of workout objects — each using a date from the D0–D6 planning window. Always append new workouts; never attempt to replace or delete existing ones.`,
}

const TOOL_INSTRUCTIONS: Record<ConvMode, string> = {
  onboarding: `When you have enough information, call \`propose_goals\` with a clear, concise goals summary (max 2000 characters). The user will review it and can accept or ask for changes. Do not narrate or describe the tool call in plain text — emit an actual tool call.`,

  goal_review: `Call \`propose_goals\` when you have an updated goals summary ready. The user will review and confirm. Do not narrate or describe the tool call in plain text — emit an actual tool call.`,

  planning: `Call \`propose_workout\` with an array of workout objects. Each workout must use a date from the D0–D6 planning window shown below. You may propose 1–7 workouts in a single call.`,
}

/**
 * Builds the full system prompt for a conversation.
 *
 * @param goals - Current user goals (null if not yet set)
 * @param mode  - The conversation type driving instructions and tool selection
 * @param historyContext - Pre-built history string from buildHistoryContext()
 */
export function buildSystemPrompt(
  goals: Goals | null,
  mode: ConvMode,
  historyContext = '',
): string {
  const window = getPlanningWindow()
  const windowStr = window.map((d, i) => `  D${i}: ${d.date} — ${d.label}`).join('\n')
  const today = window[0].date

  const goalsSection = goals
    ? `## User Goals\n\n${goals.text}`
    : `## User Goals\n\nNot yet established.`

  const historySection = historyContext
    ? `## Training History\n\n${historyContext}`
    : ''

  const sections = [
    `# Track Train Live — AI Trainer`,
    `Today: ${today}`,
    `## Your Role\n\n${ROLE_INSTRUCTIONS[mode]}`,
    `## Tool Instructions\n\n${TOOL_INSTRUCTIONS[mode]}`,
    `## Planning Window (D0–D6)\n\n${windowStr}`,
    goalsSection,
    historySection,
  ].filter(Boolean)

  return sections.join('\n\n')
}
