import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getToday,
  getWeekKey,
  getPlanningWindow,
  needsGoalReview,
  buildHistoryContext,
  buildSystemPrompt,
  generateWeeklySummary,
} from './context.ts'
import type { Goals, Workout } from './schemas/index.ts'

// ─── getToday ─────────────────────────────────────────────────────────────────

describe('getToday', () => {
  it('returns a YYYY-MM-DD string', () => {
    const today = getToday()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ─── getWeekKey ───────────────────────────────────────────────────────────────

describe('getWeekKey', () => {
  it('returns correct ISO week for a known Monday', () => {
    // 2026-02-16 is a Monday — ISO week 8 of 2026
    expect(getWeekKey('2026-02-16')).toBe('2026-W08')
  })

  it('returns correct ISO week for a Sunday (end of week)', () => {
    // 2026-02-22 is a Sunday — still in ISO week 8
    expect(getWeekKey('2026-02-22')).toBe('2026-W08')
  })

  it('returns correct ISO week for Jan 1 in a year where it is week 1', () => {
    // 2024-01-01 is a Monday — ISO week 1
    expect(getWeekKey('2024-01-01')).toBe('2024-W01')
  })

  it('groups Thursday through next Wednesday into the same week', () => {
    // 2026-02-19 (Thu) through 2026-02-25 (Wed) should all be W08
    const dates = ['2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22']
    const weeks = dates.map(getWeekKey)
    expect(new Set(weeks).size).toBe(1)
    expect(weeks[0]).toBe('2026-W08')
  })
})

// ─── getPlanningWindow ────────────────────────────────────────────────────────

describe('getPlanningWindow', () => {
  it('returns exactly 7 days', () => {
    expect(getPlanningWindow()).toHaveLength(7)
  })

  it('D0 label starts with "Today"', () => {
    const [d0] = getPlanningWindow()
    expect(d0.label).toMatch(/^Today/)
  })

  it('D1 label starts with "Tomorrow"', () => {
    const [, d1] = getPlanningWindow()
    expect(d1.label).toMatch(/^Tomorrow/)
  })

  it('D2+ labels do not start with Today or Tomorrow', () => {
    const days = getPlanningWindow().slice(2)
    for (const d of days) {
      expect(d.label).not.toMatch(/^Today|^Tomorrow/)
    }
  })

  it('dates are in YYYY-MM-DD format', () => {
    for (const d of getPlanningWindow()) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('dates are consecutive', () => {
    const days = getPlanningWindow()
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(days[i - 1].date + 'T12:00:00Z')
      const curr = new Date(days[i].date + 'T12:00:00Z')
      const diffMs = curr.getTime() - prev.getTime()
      expect(diffMs).toBe(86400000) // exactly one day
    }
  })

  it('D0 date matches getToday()', () => {
    const [d0] = getPlanningWindow()
    expect(d0.date).toBe(getToday())
  })
})

// ─── needsGoalReview ──────────────────────────────────────────────────────────

describe('needsGoalReview', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeGoals(opts: { pendingReview?: boolean; updatedAt: string }): Goals {
    return {
      _v: 1,
      text: 'Get stronger',
      updatedAt: opts.updatedAt,
      pendingReview: opts.pendingReview ?? false,
    }
  }

  it('returns true when pendingReview is true', () => {
    const goals = makeGoals({
      pendingReview: true,
      updatedAt: new Date().toISOString(),
    })
    expect(needsGoalReview(goals)).toBe(true)
  })

  it('returns false for fresh goals (1 day old)', () => {
    const updatedAt = new Date(Date.now() - 86400000).toISOString() // 1 day ago
    const goals = makeGoals({ updatedAt })
    expect(needsGoalReview(goals)).toBe(false)
  })

  it('returns false for goals updated 5 weeks ago', () => {
    const fiveWeeksAgo = new Date(Date.now() - 5 * 7 * 24 * 60 * 60 * 1000).toISOString()
    const goals = makeGoals({ updatedAt: fiveWeeksAgo })
    expect(needsGoalReview(goals)).toBe(false)
  })

  it('returns true for goals updated 7 weeks ago', () => {
    const sevenWeeksAgo = new Date(Date.now() - 7 * 7 * 24 * 60 * 60 * 1000).toISOString()
    const goals = makeGoals({ updatedAt: sevenWeeksAgo })
    expect(needsGoalReview(goals)).toBe(true)
  })
})

// ─── buildHistoryContext ──────────────────────────────────────────────────────

const RECENT_DATE = getToday() // use actual today so it's always "recent"

const sampleWorkout: Workout = {
  _v: 1,
  id: 1,
  date: RECENT_DATE,
  workoutType: 'strength',
  entries: [
    { exerciseId: 'bench-press', sets: [{ plannedReps: 8, plannedWeight: 135, difficulty: 'completed' }] },
  ],
  cardioMode: 'pick_one',
  feedback: [],
}

describe('buildHistoryContext', () => {
  it('returns empty string when no workouts or summaries', () => {
    expect(buildHistoryContext([], new Map())).toBe('')
  })

  it('includes recent workout details', () => {
    const ctx = buildHistoryContext([sampleWorkout], new Map())
    expect(ctx).toContain('bench-press') // exercise ID used directly
    expect(ctx).toContain(RECENT_DATE)
    expect(ctx).toContain('Done') // compact format: 'completed' → 'Done'
  })

  it('includes summary for older weeks', () => {
    // Workout from 4 weeks ago
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 28)
    const oldDateStr = oldDate.toLocaleDateString('en-CA')
    const oldWorkout: Workout = { ...sampleWorkout, id: 2, date: oldDateStr }
    const weekKey = getWeekKey(oldDateStr)
    const summaries = new Map([[weekKey, 'Good week, hit all lifts']])

    const ctx = buildHistoryContext([sampleWorkout, oldWorkout], summaries)
    expect(ctx).toContain('Good week, hit all lifts')
  })
})

// ─── generateWeeklySummary ────────────────────────────────────────────────────

describe('generateWeeklySummary', () => {
  it('produces a single line', () => {
    const summary = generateWeeklySummary('2026-W08', [sampleWorkout])
    expect(summary.split('\n')).toHaveLength(1)
  })

  it('includes the week key', () => {
    const summary = generateWeeklySummary('2026-W08', [sampleWorkout])
    expect(summary).toContain('2026-W08')
  })

  it('reports session count (singular)', () => {
    const summary = generateWeeklySummary('2026-W08', [sampleWorkout])
    expect(summary).toContain('1 session')
    expect(summary).not.toContain('1 sessions')
  })

  it('reports session count (plural)', () => {
    const w2: Workout = { ...sampleWorkout, id: 2, date: '2026-02-17' }
    const summary = generateWeeklySummary('2026-W08', [sampleWorkout, w2])
    expect(summary).toContain('2 sessions')
  })

  it('includes abbreviated difficulty signal', () => {
    const summary = generateWeeklySummary('2026-W08', [sampleWorkout])
    expect(summary).toContain('Done') // 'completed' → 'Done'
  })

  it('does not include weights or exercise names (trend only)', () => {
    const summary = generateWeeklySummary('2026-W08', [sampleWorkout])
    expect(summary).not.toContain('135') // no weight values
    expect(summary).not.toContain('Bench Press') // no exercise names
  })
})

// ─── buildSystemPrompt ────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('includes today date', () => {
    const prompt = buildSystemPrompt(null, 'planning')
    expect(prompt).toContain('Today:')
  })

  it('includes onboarding instructions for onboarding mode', () => {
    const prompt = buildSystemPrompt(null, 'onboarding')
    expect(prompt).toContain('propose_goals')
    expect(prompt).toContain('goals')
  })

  it('includes planning instructions for planning mode', () => {
    const prompt = buildSystemPrompt(null, 'planning')
    expect(prompt).toContain('propose_workout')
  })

  it('includes D0–D6 planning window', () => {
    const prompt = buildSystemPrompt(null, 'planning')
    expect(prompt).toContain('D0:')
    expect(prompt).toContain('D6:')
  })

  it('includes goals text when provided', () => {
    const goals: Goals = {
      _v: 1,
      text: 'Build muscle mass',
      updatedAt: '2026-02-21T10:00:00.000Z',
      pendingReview: false,
    }
    const prompt = buildSystemPrompt(goals, 'planning')
    expect(prompt).toContain('Build muscle mass')
  })

  it('notes goals not established when null', () => {
    const prompt = buildSystemPrompt(null, 'planning')
    expect(prompt).toContain('Not yet established')
  })

  it('includes history context when provided', () => {
    const prompt = buildSystemPrompt(null, 'planning', 'Ran 5k on Monday')
    expect(prompt).toContain('Ran 5k on Monday')
  })
})
