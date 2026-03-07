/**
 * System prompt assembly and context utilities.
 *
 * Responsible for:
 * - Building the system prompt for each conversation type
 * - Computing the D0–D6 planning window
 * - Formatting workout history for injection into context
 * - Goal review trigger logic
 */

import {
  getWorkoutStatus,
  type Goals,
  type Workout,
} from './schemas/index.ts'
import { buildCatalogPromptSection, type Exercise } from '../data/exercises.ts'
import { buildBaselinePromptSection } from '../data/exerciseBaselines.ts'

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

const DIFF_SHORT: Record<string, string> = {
  could_not_complete: 'Fail',
  completed: 'Done',
  too_easy: 'Easy',
}

function formatSetCompact(set: {
  plannedReps?: number
  targetSeconds?: number
  plannedWeight?: number
}): string {
  if (set.targetSeconds) return `${set.targetSeconds}s`
  const reps = set.plannedReps ?? '?'
  const weight = set.plannedWeight != null ? `x${set.plannedWeight}` : ''
  return `${reps}${weight}`
}

function formatPlannedSet(set: {
  plannedReps?: number
  targetSeconds?: number
  plannedWeight?: number
}): string {
  if (set.targetSeconds) return `${set.targetSeconds}s`
  const reps = set.plannedReps ?? '?'
  const weight = set.plannedWeight != null ? `x${set.plannedWeight}` : ''
  return `${reps}${weight}`
}

/**
 * Compact session format used for recent workouts in the planning context.
 *
 * Example:
 *   2026-02-18 Push A
 *     db-bench-press | 8x50 8x50 8x50 | Easy Easy Easy
 *     cable-row | 10x65 10x65 10x65 | Done Done Done | "felt good"
 */
function formatWorkoutCompact(workout: Workout): string {
  const label = workout.session ?? workout.workoutType ?? 'workout'
  const lines: string[] = [`${workout.date} ${label}`]

  for (const entry of workout.entries ?? []) {
    const name = entry.exerciseId
    const sets = entry.sets.map(formatSetCompact).join(' ')
    const diffs = entry.sets
      .map((s) => (s.difficulty ? (DIFF_SHORT[s.difficulty] ?? s.difficulty) : '—'))
      .join(' ')
    const note = entry.notes ? ` | "${entry.notes}"` : ''
    lines.push(`  ${name} | ${sets} | ${diffs}${note}`)
  }

  for (const opt of workout.cardioOptions ?? []) {
    const diff = opt.difficulty ? ` [${DIFF_SHORT[opt.difficulty] ?? opt.difficulty}]` : ''
    lines.push(`  Cardio: ${opt.label}${diff}`)
  }

  const latestUserFeedback = [...(workout.feedback ?? [])]
    .reverse()
    .find((f) => f.source === 'user')?.note
  if (latestUserFeedback) {
    lines.push(`  note: "${latestUserFeedback}"`)
  }

  return lines.join('\n')
}

// ─── Weekly summary generator ──────────────────────────────────────────────────

/**
 * Returns the dominant difficulty across a set of sets: whichever of
 * Easy / Fail / Done appears most. Ties break toward the more informative
 * signal (Fail beats Done, Easy beats Done).
 */
function dominantDiff(sets: { difficulty?: string }[]): string {
  let easy = 0, done = 0, fail = 0
  for (const s of sets) {
    if (s.difficulty === 'too_easy') easy++
    else if (s.difficulty === 'could_not_complete') fail++
    else if (s.difficulty === 'completed') done++
  }
  if (easy === 0 && done === 0 && fail === 0) return '—'
  if (easy >= fail && easy >= done) return 'Easy'
  if (fail >= easy && fail >= done) return 'Fail'
  return 'Done'
}

/**
 * Generates a ONE-LINE trend summary of a week's workouts for injection into
 * the planning context for weeks older than the 3-week full-detail window.
 *
 * Weights are omitted — the AI gets precise weight data from the recent section.
 * This line only provides the trend signal (Easy/Done/Fail per session type).
 *
 * Example:
 *   2026-W05 (3 sessions): Push A: Easy/Easy/Easy, Pull A: Done/Easy/Done, Legs A: Fail/Fail/Done
 */
export function generateWeeklySummary(weekKey: string, workouts: Workout[]): string {
  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date))
  const n = sorted.length

  const sessionParts = sorted.map((w) => {
    const label = w.session ?? w.workoutType ?? 'workout'
    const exDiffs = (w.entries ?? []).map((e) => dominantDiff(e.sets)).join('/')
    const cardioDiffs = (w.cardioOptions ?? [])
      .filter((o) => o.difficulty)
      .map((o) => DIFF_SHORT[o.difficulty!] ?? o.difficulty!)
      .join('/')
    const diffs = [exDiffs, cardioDiffs].filter(Boolean).join('/')
    return diffs ? `${label}: ${diffs}` : label
  })

  return `${weekKey} (${n} session${n === 1 ? '' : 's'}): ${sessionParts.join(', ')}`
}

// ─── History context builder ───────────────────────────────────────────────────

/** Days of full-detail history before falling back to weekly summaries. */
export const RECENT_HISTORY_DAYS = 42

/**
 * Builds the history section for the system prompt.
 *
 * Strategy:
 * - Last 6 weeks: compact per-session detail including weights and per-set difficulty
 * - Older weeks: one line per week from stored summaries (trend signal only, no weights)
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
  cutoff.setDate(cutoff.getDate() - RECENT_HISTORY_DAYS)
  const cutoffStr = cutoff.toLocaleDateString('en-CA', { timeZone: tz })

  const recentWorkouts = workouts.filter((w) => w.date >= cutoffStr)
  const olderWorkouts = workouts.filter((w) => w.date < cutoffStr)

  const parts: string[] = []

  // Recent workouts: compact detail, most-recent-first
  if (recentWorkouts.length > 0) {
    const recentLines = recentWorkouts.map(formatWorkoutCompact)
    parts.push('Recent workouts (last 3 weeks):\n' + recentLines.join('\n'))
  }

  // Older weeks: one summary line per week (trend signal only), most-recent-first
  const olderWeekKeys = new Set(olderWorkouts.map((w) => getWeekKey(w.date)))
  const olderLines: string[] = []
  for (const [weekKey, summary] of summaries) {
    if (olderWeekKeys.has(weekKey)) {
      olderLines.push(summary)
    }
  }
  if (olderLines.length > 0) {
    parts.push('Older training history:\n' + olderLines.join('\n'))
  }

  return parts.join('\n\n')
}

/**
 * Builds a compact summary of workouts already present in the current D0-D6
 * planning window so the planner can avoid accidental duplicates/conflicts.
 */
export function buildUpcomingPlannedContext(workouts: Workout[]): string {
  const windowDates = new Set(getPlanningWindow().map((d) => d.date))
  const inWindow = workouts
    .filter((w) => windowDates.has(w.date))
    .sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date)
      return dateCmp !== 0 ? dateCmp : (a.id ?? 0) - (b.id ?? 0)
    })

  if (inWindow.length === 0) return ''

  const lines = [
    'Existing workouts in D0-D6 window (use these ids for edit_workout/swap_exercise):',
    'For not_started workouts, all planned sets are editable. For in_progress workouts, only sets marked "open" are editable.',
  ]
  for (const workout of inWindow) {
    const status = getWorkoutStatus(workout)
    const title = workout.session ?? workout.workoutType ?? 'workout'
    const exerciseCount = workout.entries?.length ?? 0
    const cardioCount = workout.cardioOptions?.length ?? 0
    const detailParts: string[] = []
    if (exerciseCount > 0) detailParts.push(`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`)
    if (cardioCount > 0) detailParts.push(`${cardioCount} cardio option${cardioCount === 1 ? '' : 's'}`)
    const detail = detailParts.length > 0 ? ` (${detailParts.join(', ')})` : ''
    const idLabel = workout.id !== undefined ? `id=${workout.id}` : 'id=missing'
    lines.push(`- ${idLabel} | ${workout.date}: ${title} [${status}]${detail}`)
    const entryMap = (workout.entries ?? []).map((entry, idx) => `E${idx}:${entry.exerciseId}`).join(', ')
    if (entryMap) {
      lines.push(`  - entries: ${entryMap}`)
    }

    if (status === 'not_started') {
      lines.push('  - all sets editable')
      continue
    }

    if (status === 'completed') {
      lines.push('  - workout locked (completed)')
      continue
    }

    for (const [entryIndex, entry] of (workout.entries ?? []).entries()) {
      const setSummary = entry.sets
        .map((set, idx) => {
          const lock = set.difficulty !== undefined ? 'locked' : 'open'
          const diff = set.difficulty ? `:${DIFF_SHORT[set.difficulty] ?? set.difficulty}` : ''
          return `S${idx + 1} ${lock}${diff} ${formatPlannedSet(set)}`
        })
        .join(', ')
      lines.push(`  - E${entryIndex}:${entry.exerciseId} -> ${setSummary}`)
    }
  }

  return lines.join('\n')
}

// ─── System prompt builder ─────────────────────────────────────────────────────

type ConvMode = 'onboarding' | 'goal_review' | 'planning'

const ROLE_INSTRUCTIONS: Record<ConvMode, string> = {
  onboarding: `You are an AI personal trainer helping a new user establish their training goals. Ask thoughtful questions about their fitness background, current goals, available equipment and time, and any physical limitations. When you have gathered enough to write a useful goals summary, call the \`propose_goals\` tool. Keep the tone conversational and encouraging. Do not dump all questions at once — have a natural back-and-forth.`,

  goal_review: `You are an AI personal trainer reviewing a user's training goals. Acknowledge what's currently set, ask about recent changes or new priorities, and when ready, call \`propose_goals\` with an updated summary. Keep it focused — this should be a short review, not a full re-onboarding.`,

  planning: `You are an AI personal trainer. Answer questions conversationally. When the user asks you to plan, schedule, add, or broadly change workouts, call \`propose_workout\` with an array of workout objects — each using a date from the D0–D6 planning window. Always append new workouts; never attempt to replace or delete existing ones without explicit instruction.

For user-facing text responses:
- Do not use D0/D1/D2 labels in final wording; use real dates or weekday names.
- Do not use markdown tables.
- Prefer short plain text sections or bullet lists.`,
}

const TOOL_INSTRUCTIONS: Record<ConvMode, string> = {
  onboarding: `When you have enough information, call \`propose_goals\` with a clear, concise goals summary (max 2000 characters). The user will review it and can accept or ask for changes. Do not narrate or describe the tool call in plain text — emit an actual tool call.`,

  goal_review: `Call \`propose_goals\` when you have an updated goals summary ready. The user will review and confirm. Do not narrate or describe the tool call in plain text — emit an actual tool call.`,

  planning: `Use \`propose_workout\` when proposing or replacing workouts in the schedule. Use \`edit_workout\` only for small patches to planned set values in an existing workout. Use \`swap_exercise\` to replace one entry's exercise without changing the overall workout structure. For general questions, answer directly without calling any tool.

When proposing: call \`propose_workout\` with an array of 1–7 workout objects, each using a date from the D0–D6 planning window. Review "Existing Workouts in Planning Window" before proposing — append around existing sessions; do not duplicate them. Each strength exercise entry must include multiple set objects in the \`sets\` array (typically 3 sets), each with \`plannedReps\` and \`plannedWeight\` in lb. Always include a weight — use the most recent result from history, or a conservative beginner estimate if no history exists. Omit \`plannedWeight\` only for bodyweight-only or timed-hold exercises (e.g. plank, dead bug).

Always include \`warmup\` and \`cooldown\` on every strength workout:
- \`warmup\`: use \`{ cardio: { type, duration, intensity }, mobility: [...] }\` — cardio is a single object (e.g. \`{ type: "bike", duration: "5 min", intensity: "easy" }\`), mobility is an array of checklist items with \`name\` and \`duration\` or \`reps\`.
- \`cooldown\`: use \`{ stretching: [...] }\` — an array of checklist items with \`name\` and \`duration\`.

When editing: call \`edit_workout\` with a \`workoutId\` and set-level patches only (\`entryIndex\` + \`setIndex\`). Use the workout ids listed in "Existing Workouts in Planning Window". You may update only \`plannedReps\`, \`plannedWeight\`, or \`targetSeconds\`. Never edit workouts with status \`completed\`, and never edit sets that already have a \`difficulty\` value logged.

When swapping: call \`swap_exercise\` with \`workoutId\`, \`entryIndex\`, and \`toExerciseId\`. Use \`entryIndex\` from the \`E0/E1\` mapping in "Existing Workouts in Planning Window". Never swap an entry that is already in progress (has any set with \`difficulty\`).

Do not output markdown tables or D-label shorthand in user-visible text.`,
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
  upcomingContext = '',
  customExercises: Exercise[] = [],
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

  const upcomingSection = upcomingContext
    ? `## Existing Workouts in Planning Window\n\n${upcomingContext}`
    : ''

  const sections = [
    `# Track Train Live — AI Trainer`,
    `Today: ${today}`,
    `## Your Role\n\n${ROLE_INSTRUCTIONS[mode]}`,
    `## Tool Instructions\n\n${TOOL_INSTRUCTIONS[mode]}`,
    `## Planning Window (D0–D6)\n\n${windowStr}`,
    goalsSection,
    mode === 'planning' ? buildCatalogPromptSection(customExercises) : '',
    mode !== 'goal_review' ? buildBaselinePromptSection() : '',
    upcomingSection,
    historySection,
  ].filter(Boolean)

  return sections.join('\n\n')
}
