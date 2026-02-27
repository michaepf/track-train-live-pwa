import { EXERCISES } from './exercises.ts'

export type Sex = 'male' | 'female'
export type ExperienceLevel = 'inexperienced' | 'moderate' | 'experienced'

export type BaselineUnit =
  | 'lb_total'
  | 'lb_per_hand'
  | 'assist_lb'
  | 'seconds'
  | 'reps_per_side'
  | 'bodyweight_or_weighted'

export interface BaselineRange {
  min: number
  max: number
  unit: BaselineUnit
}

export interface ExerciseBaseline {
  id: string
  male: Record<ExperienceLevel, BaselineRange>
  female: Record<ExperienceLevel, BaselineRange>
  notes?: string
}

function r(min: number, max: number, unit: BaselineUnit): BaselineRange {
  return { min, max, unit }
}

export const EXERCISE_BASELINES: Record<string, ExerciseBaseline> = {
  'cable-chest-press': {
    id: 'cable-chest-press',
    male: {
      inexperienced: r(30, 50, 'lb_total'),
      moderate: r(50, 80, 'lb_total'),
      experienced: r(80, 120, 'lb_total'),
    },
    female: {
      inexperienced: r(15, 30, 'lb_total'),
      moderate: r(30, 50, 'lb_total'),
      experienced: r(50, 80, 'lb_total'),
    },
  },
  'db-bench-press': {
    id: 'db-bench-press',
    male: {
      inexperienced: r(20, 30, 'lb_per_hand'),
      moderate: r(35, 50, 'lb_per_hand'),
      experienced: r(55, 80, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(10, 20, 'lb_per_hand'),
      moderate: r(20, 35, 'lb_per_hand'),
      experienced: r(35, 55, 'lb_per_hand'),
    },
  },
  'cable-row': {
    id: 'cable-row',
    male: {
      inexperienced: r(40, 60, 'lb_total'),
      moderate: r(60, 90, 'lb_total'),
      experienced: r(90, 130, 'lb_total'),
    },
    female: {
      inexperienced: r(20, 40, 'lb_total'),
      moderate: r(40, 65, 'lb_total'),
      experienced: r(65, 95, 'lb_total'),
    },
  },
  'db-row': {
    id: 'db-row',
    male: {
      inexperienced: r(25, 40, 'lb_per_hand'),
      moderate: r(45, 70, 'lb_per_hand'),
      experienced: r(75, 110, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(15, 25, 'lb_per_hand'),
      moderate: r(30, 45, 'lb_per_hand'),
      experienced: r(50, 75, 'lb_per_hand'),
    },
  },
  'goblet-squat': {
    id: 'goblet-squat',
    male: {
      inexperienced: r(25, 40, 'lb_per_hand'),
      moderate: r(45, 70, 'lb_per_hand'),
      experienced: r(75, 100, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(15, 25, 'lb_per_hand'),
      moderate: r(30, 45, 'lb_per_hand'),
      experienced: r(50, 75, 'lb_per_hand'),
    },
  },
  'cable-tricep-pushdown': {
    id: 'cable-tricep-pushdown',
    male: {
      inexperienced: r(20, 35, 'lb_total'),
      moderate: r(35, 55, 'lb_total'),
      experienced: r(55, 80, 'lb_total'),
    },
    female: {
      inexperienced: r(10, 20, 'lb_total'),
      moderate: r(20, 35, 'lb_total'),
      experienced: r(35, 55, 'lb_total'),
    },
  },
  'db-tricep-extension': {
    id: 'db-tricep-extension',
    male: {
      inexperienced: r(15, 25, 'lb_per_hand'),
      moderate: r(25, 40, 'lb_per_hand'),
      experienced: r(45, 60, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(8, 15, 'lb_per_hand'),
      moderate: r(15, 25, 'lb_per_hand'),
      experienced: r(25, 40, 'lb_per_hand'),
    },
  },
  plank: {
    id: 'plank',
    male: {
      inexperienced: r(20, 40, 'seconds'),
      moderate: r(40, 75, 'seconds'),
      experienced: r(75, 120, 'seconds'),
    },
    female: {
      inexperienced: r(20, 40, 'seconds'),
      moderate: r(40, 75, 'seconds'),
      experienced: r(75, 120, 'seconds'),
    },
    notes: 'Isometric hold target duration.',
  },
  'lat-pulldown': {
    id: 'lat-pulldown',
    male: {
      inexperienced: r(50, 80, 'lb_total'),
      moderate: r(80, 120, 'lb_total'),
      experienced: r(120, 170, 'lb_total'),
    },
    female: {
      inexperienced: r(30, 50, 'lb_total'),
      moderate: r(50, 80, 'lb_total'),
      experienced: r(80, 120, 'lb_total'),
    },
  },
  'cable-chest-fly': {
    id: 'cable-chest-fly',
    male: {
      inexperienced: r(10, 20, 'lb_total'),
      moderate: r(20, 35, 'lb_total'),
      experienced: r(35, 55, 'lb_total'),
    },
    female: {
      inexperienced: r(5, 12, 'lb_total'),
      moderate: r(12, 20, 'lb_total'),
      experienced: r(20, 35, 'lb_total'),
    },
  },
  'db-chest-fly': {
    id: 'db-chest-fly',
    male: {
      inexperienced: r(10, 20, 'lb_per_hand'),
      moderate: r(20, 30, 'lb_per_hand'),
      experienced: r(30, 45, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(5, 10, 'lb_per_hand'),
      moderate: r(10, 20, 'lb_per_hand'),
      experienced: r(20, 30, 'lb_per_hand'),
    },
  },
  'romanian-deadlift-db': {
    id: 'romanian-deadlift-db',
    male: {
      inexperienced: r(20, 35, 'lb_per_hand'),
      moderate: r(40, 60, 'lb_per_hand'),
      experienced: r(65, 90, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(12, 20, 'lb_per_hand'),
      moderate: r(22, 35, 'lb_per_hand'),
      experienced: r(40, 60, 'lb_per_hand'),
    },
  },
  'leg-extension': {
    id: 'leg-extension',
    male: {
      inexperienced: r(40, 70, 'lb_total'),
      moderate: r(70, 110, 'lb_total'),
      experienced: r(110, 160, 'lb_total'),
    },
    female: {
      inexperienced: r(20, 40, 'lb_total'),
      moderate: r(40, 70, 'lb_total'),
      experienced: r(70, 110, 'lb_total'),
    },
  },
  'face-pull': {
    id: 'face-pull',
    male: {
      inexperienced: r(20, 35, 'lb_total'),
      moderate: r(35, 55, 'lb_total'),
      experienced: r(55, 75, 'lb_total'),
    },
    female: {
      inexperienced: r(10, 20, 'lb_total'),
      moderate: r(20, 35, 'lb_total'),
      experienced: r(35, 55, 'lb_total'),
    },
  },
  'cable-shoulder-press': {
    id: 'cable-shoulder-press',
    male: {
      inexperienced: r(20, 35, 'lb_total'),
      moderate: r(35, 55, 'lb_total'),
      experienced: r(55, 80, 'lb_total'),
    },
    female: {
      inexperienced: r(10, 20, 'lb_total'),
      moderate: r(20, 35, 'lb_total'),
      experienced: r(35, 55, 'lb_total'),
    },
  },
  'db-shoulder-press': {
    id: 'db-shoulder-press',
    male: {
      inexperienced: r(15, 25, 'lb_per_hand'),
      moderate: r(25, 40, 'lb_per_hand'),
      experienced: r(45, 65, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(8, 15, 'lb_per_hand'),
      moderate: r(15, 25, 'lb_per_hand'),
      experienced: r(25, 40, 'lb_per_hand'),
    },
  },
  'cable-bicep-curl': {
    id: 'cable-bicep-curl',
    male: {
      inexperienced: r(15, 30, 'lb_total'),
      moderate: r(30, 45, 'lb_total'),
      experienced: r(45, 70, 'lb_total'),
    },
    female: {
      inexperienced: r(8, 15, 'lb_total'),
      moderate: r(15, 25, 'lb_total'),
      experienced: r(25, 40, 'lb_total'),
    },
  },
  'db-bicep-curl': {
    id: 'db-bicep-curl',
    male: {
      inexperienced: r(10, 20, 'lb_per_hand'),
      moderate: r(20, 30, 'lb_per_hand'),
      experienced: r(30, 45, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(5, 12, 'lb_per_hand'),
      moderate: r(10, 20, 'lb_per_hand'),
      experienced: r(20, 30, 'lb_per_hand'),
    },
  },
  'leg-press': {
    id: 'leg-press',
    male: {
      inexperienced: r(120, 220, 'lb_total'),
      moderate: r(220, 360, 'lb_total'),
      experienced: r(360, 540, 'lb_total'),
    },
    female: {
      inexperienced: r(80, 140, 'lb_total'),
      moderate: r(140, 240, 'lb_total'),
      experienced: r(240, 360, 'lb_total'),
    },
  },
  'leg-curl': {
    id: 'leg-curl',
    male: {
      inexperienced: r(40, 70, 'lb_total'),
      moderate: r(70, 110, 'lb_total'),
      experienced: r(110, 150, 'lb_total'),
    },
    female: {
      inexperienced: r(20, 40, 'lb_total'),
      moderate: r(40, 70, 'lb_total'),
      experienced: r(70, 110, 'lb_total'),
    },
  },
  'dead-bug': {
    id: 'dead-bug',
    male: {
      inexperienced: r(6, 10, 'reps_per_side'),
      moderate: r(10, 15, 'reps_per_side'),
      experienced: r(15, 20, 'reps_per_side'),
    },
    female: {
      inexperienced: r(6, 10, 'reps_per_side'),
      moderate: r(10, 15, 'reps_per_side'),
      experienced: r(15, 20, 'reps_per_side'),
    },
  },
  'bench-press': {
    id: 'bench-press',
    male: {
      inexperienced: r(65, 95, 'lb_total'),
      moderate: r(105, 155, 'lb_total'),
      experienced: r(165, 245, 'lb_total'),
    },
    female: {
      inexperienced: r(45, 65, 'lb_total'),
      moderate: r(65, 95, 'lb_total'),
      experienced: r(95, 145, 'lb_total'),
    },
  },
  'incline-db-press': {
    id: 'incline-db-press',
    male: {
      inexperienced: r(20, 30, 'lb_per_hand'),
      moderate: r(35, 50, 'lb_per_hand'),
      experienced: r(55, 75, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(10, 20, 'lb_per_hand'),
      moderate: r(20, 30, 'lb_per_hand'),
      experienced: r(35, 50, 'lb_per_hand'),
    },
  },
  'overhead-press': {
    id: 'overhead-press',
    male: {
      inexperienced: r(55, 85, 'lb_total'),
      moderate: r(85, 125, 'lb_total'),
      experienced: r(125, 185, 'lb_total'),
    },
    female: {
      inexperienced: r(35, 55, 'lb_total'),
      moderate: r(55, 85, 'lb_total'),
      experienced: r(85, 125, 'lb_total'),
    },
  },
  'lateral-raise': {
    id: 'lateral-raise',
    male: {
      inexperienced: r(8, 15, 'lb_per_hand'),
      moderate: r(15, 25, 'lb_per_hand'),
      experienced: r(25, 35, 'lb_per_hand'),
    },
    female: {
      inexperienced: r(5, 10, 'lb_per_hand'),
      moderate: r(10, 15, 'lb_per_hand'),
      experienced: r(15, 25, 'lb_per_hand'),
    },
  },
  'barbell-row': {
    id: 'barbell-row',
    male: {
      inexperienced: r(75, 115, 'lb_total'),
      moderate: r(115, 185, 'lb_total'),
      experienced: r(185, 275, 'lb_total'),
    },
    female: {
      inexperienced: r(45, 75, 'lb_total'),
      moderate: r(75, 115, 'lb_total'),
      experienced: r(115, 165, 'lb_total'),
    },
  },
  pullup: {
    id: 'pullup',
    male: {
      inexperienced: r(90, 120, 'assist_lb'),
      moderate: r(40, 80, 'assist_lb'),
      experienced: r(0, 20, 'assist_lb'),
    },
    female: {
      inexperienced: r(110, 140, 'assist_lb'),
      moderate: r(70, 110, 'assist_lb'),
      experienced: r(0, 40, 'assist_lb'),
    },
    notes: 'Numbers = lb of machine assistance (higher = more help). Progress by reducing assistance and adding reps — NOT by adding weight. Do NOT assign weighted pullups; that is a separate exercise.',
  },
  'barbell-curl': {
    id: 'barbell-curl',
    male: {
      inexperienced: r(45, 65, 'lb_total'),
      moderate: r(65, 95, 'lb_total'),
      experienced: r(95, 135, 'lb_total'),
    },
    female: {
      inexperienced: r(25, 40, 'lb_total'),
      moderate: r(40, 60, 'lb_total'),
      experienced: r(60, 85, 'lb_total'),
    },
  },
  squat: {
    id: 'squat',
    male: {
      inexperienced: r(95, 145, 'lb_total'),
      moderate: r(145, 225, 'lb_total'),
      experienced: r(225, 335, 'lb_total'),
    },
    female: {
      inexperienced: r(65, 95, 'lb_total'),
      moderate: r(95, 145, 'lb_total'),
      experienced: r(145, 225, 'lb_total'),
    },
  },
  'calf-raise': {
    id: 'calf-raise',
    male: {
      inexperienced: r(70, 130, 'lb_total'),
      moderate: r(130, 220, 'lb_total'),
      experienced: r(220, 320, 'lb_total'),
    },
    female: {
      inexperienced: r(40, 80, 'lb_total'),
      moderate: r(80, 140, 'lb_total'),
      experienced: r(140, 220, 'lb_total'),
    },
  },
}

export function getBaselineRange(
  exerciseId: string,
  sex: Sex,
  level: ExperienceLevel,
): BaselineRange | null {
  const baseline = EXERCISE_BASELINES[exerciseId]
  if (!baseline) return null
  return baseline[sex][level]
}

const UNIT_LABEL: Record<BaselineUnit, string> = {
  lb_total:              'lb total',
  lb_per_hand:           'lb/hand',
  assist_lb:             'lb assist',
  seconds:               'sec',
  reps_per_side:         'reps/side',
  bodyweight_or_weighted:'BW/weighted',
}

/**
 * Compact baseline table for injection into the AI system prompt.
 *
 * Format (one line per exercise):
 *   exercise-id | M inexp/mod/exp | F inexp/mod/exp | unit
 *
 * Units follow the exercise (all levels use the same unit).
 */
export function buildBaselinePromptSection(): string {
  const LEVELS: ExperienceLevel[] = ['inexperienced', 'moderate', 'experienced']

  function rangeStr(r: BaselineRange): string {
    return `${r.min}–${r.max}`
  }

  const lines = Object.values(EXERCISE_BASELINES).flatMap((b) => {
    const mRanges = LEVELS.map((l) => rangeStr(b.male[l])).join('/')
    const fRanges = LEVELS.map((l) => rangeStr(b.female[l])).join('/')
    const unit = UNIT_LABEL[b.male.inexperienced.unit]
    const row = `  ${b.id} | M ${mRanges} | F ${fRanges} | ${unit}`
    return b.notes ? [row, `    note: ${b.notes}`] : [row]
  })

  return [
    '## Starter Weight Reference',
    '',
    'Use when proposing weights for a user with no prior workout history for a given exercise.',
    'Columns: inexperienced / moderate / experienced.',
    'IMPORTANT: Always default to the minimum of the inexperienced range unless the user\'s goals clearly state they are already training that movement at a higher weight. Starting too light is always preferable — the user can increase weight next session. Starting too heavy risks injury and discouragement.',
    '',
    ...lines,
  ].join('\n')
}

/**
 * Utility for sanity checks: returns exercise IDs present in catalog but
 * missing baseline entries.
 */
export function listExercisesMissingBaselines(): string[] {
  return EXERCISES.map((e) => e.id).filter((id) => !EXERCISE_BASELINES[id])
}
