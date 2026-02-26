/**
 * Development fixtures for Phase 5c context-size and agent-behavior testing.
 *
 * Three scenarios — same exercises and weights, different difficulty signals:
 *   A: All Progressing  — consistently too_easy; agent should increase weights across the board
 *   B: Mixed Progress   — push easy, pull appropriate, legs struggling; agent should adjust per-exercise
 *   C: Stuck            — consistently could_not_complete; agent should deload or lower weights
 *
 * Sessions span two recency buckets:
 *   - Days 22–36 ago → summarized (outside the 3-week full-detail window)
 *   - Days 5–14 ago  → full detail in planning context
 *
 * All weights are the same across scenarios so AI recommendations are directly comparable.
 */

import type { Workout } from './schemas/index.ts'

type Diff = 'could_not_complete' | 'completed' | 'too_easy'

/** Returns a YYYY-MM-DD date string N days before today in the device's local timezone. */
function relDate(daysBack: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return d.toLocaleDateString('en-CA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

/** Creates 3 identical sets with the given reps, weight, and difficulty. */
function s3(reps: number, weight: number, diff: Diff) {
  return Array.from({ length: 3 }, () => ({
    plannedReps: reps,
    plannedWeight: weight,
    difficulty: diff,
  }))
}

type ExEntry = { id: string; reps: number; weight: number; diff: Diff; note?: string }

function makeSession(
  daysBack: number,
  workoutType: string,
  sessionName: string,
  exercises: ExEntry[],
  feedbackNote?: string,
): Workout {
  return {
    _v: 1,
    date: relDate(daysBack),
    workoutType,
    session: sessionName,
    entries: exercises.map((e) => ({
      exerciseId: e.id,
      sets: s3(e.reps, e.weight, e.diff),
      ...(e.note ? { notes: e.note } : {}),
    })),
    cardioMode: 'pick_one',
    feedback: feedbackNote
      ? [
          {
            timestamp: new Date(Date.now() - daysBack * 86400000).toISOString(),
            note: feedbackNote,
            source: 'user',
          },
        ]
      : [],
  }
}

function makeCardio(daysBack: number, label: string, diff: Diff): Workout {
  return {
    _v: 1,
    date: relDate(daysBack),
    workoutType: 'cardio',
    session: 'Cardio',
    entries: [],
    cardioOptions: [{ label, difficulty: diff }],
    cardioMode: 'pick_one',
    feedback: [],
  }
}

// ─── Shared exercise definitions ───────────────────────────────────────────────
// Same exercises and weights used in all three scenarios. Only difficulty differs.

type ExDef = { id: string; reps: number; weight: number }

const PUSH: ExDef[] = [
  { id: 'db-bench-press', reps: 8, weight: 50 },
  { id: 'cable-shoulder-press', reps: 10, weight: 35 },
  { id: 'cable-tricep-pushdown', reps: 12, weight: 40 },
]

const PULL: ExDef[] = [
  { id: 'lat-pulldown', reps: 10, weight: 80 },
  { id: 'cable-row', reps: 10, weight: 65 },
  { id: 'db-bicep-curl', reps: 12, weight: 22 },
]

const LEGS: ExDef[] = [
  { id: 'goblet-squat', reps: 10, weight: 45 },
  { id: 'romanian-deadlift-db', reps: 10, weight: 45 },
  { id: 'leg-curl', reps: 12, weight: 55 },
]

// ─── Scenario A — All Progressing ─────────────────────────────────────────────

export const SCENARIO_A: Workout[] = [
  // Older (will be summarized — outside 3-week window)
  makeSession(
    36, 'strength', 'Push A',
    PUSH.map((e) => ({ ...e, diff: 'too_easy' as Diff })),
    'Everything felt light. Ready to add weight.',
  ),
  makeSession(
    29, 'strength', 'Pull A',
    PULL.map((e) => ({ ...e, diff: 'too_easy' as Diff })),
    'Pull exercises all too easy.',
  ),
  makeSession(
    22, 'strength', 'Legs A',
    LEGS.map((e) => ({ ...e, diff: 'too_easy' as Diff })),
    'Legs also too easy. Need heavier weight.',
  ),

  // Recent (full detail in planning context)
  makeSession(
    14, 'strength', 'Push A',
    PUSH.map((e) => ({ ...e, diff: 'too_easy' as Diff })),
    'Still too easy. Going up next session.',
  ),
  makeSession(
    10, 'strength', 'Pull A',
    PULL.map((e) => ({ ...e, diff: 'too_easy' as Diff })),
  ),
  makeSession(
    5, 'strength', 'Legs A',
    LEGS.map((e) => ({ ...e, diff: 'too_easy' as Diff })),
    'All reps felt easy. Ready for a significant weight jump on everything.',
  ),
]

// ─── Scenario B — Mixed Progress ──────────────────────────────────────────────
// Push: too_easy — weights should go up
// Pull: completed — appropriate weight, hold
// Legs: struggling — weights should come down

export const SCENARIO_B: Workout[] = [
  // Older (summarized)
  makeSession(
    36, 'strength', 'Push A',
    [
      { ...PUSH[0], diff: 'too_easy' },
      { ...PUSH[1], diff: 'too_easy' },
      { ...PUSH[2], diff: 'completed' },
    ],
    'Bench and shoulder press very easy. Triceps felt about right.',
  ),
  makeSession(
    29, 'strength', 'Pull A',
    [
      { ...PULL[0], diff: 'completed' },
      { ...PULL[1], diff: 'completed' },
      { ...PULL[2], diff: 'too_easy' },
    ],
  ),
  makeSession(
    22, 'strength', 'Legs A',
    [
      { ...LEGS[0], diff: 'could_not_complete', note: 'Had to stop after 2 sets' },
      { ...LEGS[1], diff: 'completed' },
      { ...LEGS[2], diff: 'could_not_complete' },
    ],
    'Squats were too hard, had to stop early. RDL ok. Leg curl too heavy.',
  ),

  // Recent (full detail)
  makeSession(
    14, 'strength', 'Push A',
    [
      { ...PUSH[0], diff: 'too_easy' },
      { ...PUSH[1], diff: 'too_easy' },
      { ...PUSH[2], diff: 'completed' },
    ],
    'Push still easy. Need to increase bench and shoulder weight.',
  ),
  makeSession(
    10, 'strength', 'Pull A',
    [
      { ...PULL[0], diff: 'completed' },
      { ...PULL[1], diff: 'completed' },
      { ...PULL[2], diff: 'too_easy' },
    ],
  ),
  makeSession(
    5, 'strength', 'Legs A',
    [
      { ...LEGS[0], diff: 'could_not_complete', note: 'Failed last 2 reps on every set' },
      { ...LEGS[1], diff: 'completed' },
      { ...LEGS[2], diff: 'could_not_complete', note: 'Dropped reps, weight too heavy' },
    ],
    'Squats and leg curl still too hard. RDL is the right weight.',
  ),
]

// ─── Scenario C — Stuck / Struggling ──────────────────────────────────────────
// Everything is too heavy. Consistent could_not_complete across all exercises.
// 5 sessions/week (Push + Cardio + Pull + Cardio + Legs) across 4 weeks.

export const SCENARIO_C: Workout[] = [
  // ── Recent (most recent first) ──

  makeSession(
    3, 'strength', 'Legs A',
    [
      { ...LEGS[0], diff: 'could_not_complete', note: 'Squats still failing' },
      { ...LEGS[1], diff: 'could_not_complete' },
      { ...LEGS[2], diff: 'could_not_complete' },
    ],
    'Legs still not working. Need a full deload.',
  ),
  makeSession(
    5, 'strength', 'Pull A',
    [
      { ...PULL[0], diff: 'could_not_complete', note: 'Only got 6 reps' },
      { ...PULL[1], diff: 'completed' },
      { ...PULL[2], diff: 'could_not_complete' },
    ],
  ),
  makeCardio(6, 'Treadmill 20 min', 'completed'),
  makeSession(
    7, 'strength', 'Push A',
    [
      { ...PUSH[0], diff: 'could_not_complete', note: 'Still failing on bench' },
      { ...PUSH[1], diff: 'could_not_complete' },
      { ...PUSH[2], diff: 'completed' },
    ],
    'Four weeks of failing. Something has to change.',
  ),
  makeSession(
    12, 'strength', 'Legs A',
    [
      { ...LEGS[0], diff: 'could_not_complete', note: "Couldn't finish any sets at this weight" },
      { ...LEGS[1], diff: 'could_not_complete', note: 'Too heavy' },
      { ...LEGS[2], diff: 'could_not_complete' },
    ],
    'Everything is still too heavy.',
  ),
  makeCardio(14, 'Elliptical 20 min', 'completed'),
  makeSession(
    15, 'strength', 'Pull A',
    [
      { ...PULL[0], diff: 'could_not_complete', note: 'Lat pulldown still too heavy' },
      { ...PULL[1], diff: 'completed' },
      { ...PULL[2], diff: 'could_not_complete' },
    ],
  ),
  makeCardio(17, 'Treadmill 20 min', 'completed'),
  makeSession(
    18, 'strength', 'Push A',
    [
      { ...PUSH[0], diff: 'could_not_complete', note: 'Still failing. Weight is too high.' },
      { ...PUSH[1], diff: 'could_not_complete' },
      { ...PUSH[2], diff: 'completed' },
    ],
    'Nothing is improving. Need a deload week.',
  ),

  // ── Older (most recent first — will be summarized) ──

  makeSession(
    22, 'strength', 'Legs A',
    [
      { ...LEGS[0], diff: 'could_not_complete', note: 'Same as last week. Stuck.' },
      { ...LEGS[1], diff: 'could_not_complete' },
      { ...LEGS[2], diff: 'could_not_complete' },
    ],
    'Legs still too heavy across the board.',
  ),
  makeCardio(24, 'Elliptical 20 min', 'completed'),
  makeSession(
    26, 'strength', 'Pull A',
    [
      { ...PULL[0], diff: 'could_not_complete', note: 'Getting worse, not better' },
      { ...PULL[1], diff: 'completed' },
      { ...PULL[2], diff: 'could_not_complete' },
    ],
  ),
  makeCardio(27, 'Treadmill 20 min', 'completed'),
  makeSession(
    28, 'strength', 'Push A',
    [
      { ...PUSH[0], diff: 'could_not_complete', note: 'Still failing. No improvement.' },
      { ...PUSH[1], diff: 'could_not_complete' },
      { ...PUSH[2], diff: 'completed' },
    ],
    'No progress on push. Might need a deload.',
  ),
  makeSession(
    29, 'strength', 'Legs A',
    [
      { ...LEGS[0], diff: 'could_not_complete', note: 'Had to stop after 2 sets, too heavy' },
      { ...LEGS[1], diff: 'could_not_complete' },
      { ...LEGS[2], diff: 'could_not_complete' },
    ],
    'Everything in legs failed. All weights are too heavy right now.',
  ),
  makeCardio(31, 'Elliptical 20 min', 'completed'),
  makeSession(
    32, 'strength', 'Pull A',
    [
      { ...PULL[0], diff: 'could_not_complete', note: 'Could only do 7 reps each set' },
      { ...PULL[1], diff: 'completed' },
      { ...PULL[2], diff: 'could_not_complete' },
    ],
  ),
  makeCardio(34, 'Treadmill 20 min', 'completed'),
  makeSession(
    35, 'strength', 'Push A',
    [
      { ...PUSH[0], diff: 'could_not_complete', note: 'Failed last 2 reps each set, form broke down' },
      { ...PUSH[1], diff: 'could_not_complete' },
      { ...PUSH[2], diff: 'completed' },
    ],
    'Bench and shoulder too heavy. Triceps barely managed.',
  ),
]

// ─── Scenario registry ────────────────────────────────────────────────────────

export const SCENARIOS = {
  'all-progressing': {
    label: 'All Progressing',
    description: 'All exercises too_easy — agent should increase weights across the board',
    workouts: SCENARIO_A,
  },
  mixed: {
    label: 'Mixed Progress',
    description: 'Push easy, pull appropriate, legs struggling — agent should adjust per-exercise',
    workouts: SCENARIO_B,
  },
  stuck: {
    label: 'Stuck / Struggling',
    description: 'Consistently could_not_complete — agent should deload or lower weights',
    workouts: SCENARIO_C,
  },
} as const

export type ScenarioKey = keyof typeof SCENARIOS
