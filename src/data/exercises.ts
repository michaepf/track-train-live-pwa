export interface Exercise {
  id: string
  name: string
  description: string
  tags: string[]
}

export const EXERCISES: Exercise[] = [
  {
    id: 'cable-chest-press',
    name: 'Cable Chest Press',
    description: 'Cable machine chest press with neutral grip',
    tags: ['push', 'chest', 'cables', 'neutral-grip'],
  },
  {
    id: 'db-bench-press',
    name: 'Dumbbell Bench Press',
    description: 'Flat dumbbell bench press with neutral grip',
    tags: ['push', 'chest', 'dumbbells', 'neutral-grip'],
  },
  {
    id: 'cable-row',
    name: 'Cable Row',
    description: 'Seated cable row with neutral grip handle',
    tags: ['pull', 'back', 'cables', 'neutral-grip'],
  },
  {
    id: 'db-row',
    name: 'Dumbbell Row',
    description: 'Single-arm dumbbell row, supported on bench',
    tags: ['pull', 'back', 'dumbbells', 'neutral-grip'],
  },
  {
    id: 'goblet-squat',
    name: 'Goblet Squat',
    description: 'Dumbbell held at chest, squat to comfortable depth',
    tags: ['legs', 'quads', 'dumbbells', 'knee-friendly'],
  },
  {
    id: 'cable-tricep-pushdown',
    name: 'Cable Tricep Pushdown',
    description: 'Cable tricep pushdown with rope or neutral bar',
    tags: ['push', 'triceps', 'cables', 'neutral-grip'],
  },
  {
    id: 'db-tricep-extension',
    name: 'Dumbbell Tricep Extension',
    description: 'Overhead or lying tricep extension with dumbbell',
    tags: ['push', 'triceps', 'dumbbells'],
  },
  {
    id: 'plank',
    name: 'Plank',
    description: 'Front plank on elbows or hands',
    tags: ['core', 'bodyweight'],
  },
  {
    id: 'lat-pulldown',
    name: 'Lat Pulldown',
    description: 'Cable lat pulldown with neutral grip attachment',
    tags: ['pull', 'back', 'cables', 'neutral-grip'],
  },
  {
    id: 'cable-chest-fly',
    name: 'Cable Chest Fly',
    description: 'Cable chest fly for chest isolation',
    tags: ['push', 'chest', 'cables'],
  },
  {
    id: 'db-chest-fly',
    name: 'Dumbbell Chest Fly',
    description: 'Flat dumbbell chest fly',
    tags: ['push', 'chest', 'dumbbells'],
  },
  {
    id: 'romanian-deadlift-db',
    name: 'Romanian Deadlift (Dumbbell)',
    description: 'Dumbbell RDL for posterior chain',
    tags: ['legs', 'hamstrings', 'dumbbells'],
  },
  {
    id: 'leg-extension',
    name: 'Leg Extension',
    description: 'Machine leg extension for quads',
    tags: ['legs', 'quads', 'machine'],
  },
  {
    id: 'face-pull',
    name: 'Face Pull',
    description: 'Cable face pull for rear delts and shoulder health',
    tags: ['pull', 'shoulders', 'cables', 'prehab'],
  },
  {
    id: 'cable-shoulder-press',
    name: 'Cable Shoulder Press',
    description: 'Cable overhead press with neutral grip',
    tags: ['push', 'shoulders', 'cables', 'neutral-grip'],
  },
  {
    id: 'db-shoulder-press',
    name: 'Dumbbell Shoulder Press',
    description: 'Seated or standing dumbbell overhead press with neutral grip',
    tags: ['push', 'shoulders', 'dumbbells', 'neutral-grip'],
  },
  {
    id: 'cable-bicep-curl',
    name: 'Cable Bicep Curl',
    description: 'Cable curl with EZ bar or neutral grip',
    tags: ['pull', 'biceps', 'cables'],
  },
  {
    id: 'db-bicep-curl',
    name: 'Dumbbell Bicep Curl',
    description: 'Standing dumbbell curl, neutral or supinated grip',
    tags: ['pull', 'biceps', 'dumbbells'],
  },
  {
    id: 'leg-press',
    name: 'Leg Press',
    description: 'Machine leg press',
    tags: ['legs', 'quads', 'machine'],
  },
  {
    id: 'leg-curl',
    name: 'Leg Curl',
    description: 'Machine leg curl for hamstrings',
    tags: ['legs', 'hamstrings', 'machine'],
  },
  {
    id: 'dead-bug',
    name: 'Dead Bug',
    description: 'Core exercise lying on back, opposite arm/leg movement',
    tags: ['core', 'bodyweight'],
  },
  {
    id: 'bench-press',
    name: 'Bench Press',
    description: 'Flat barbell bench press',
    tags: ['push', 'chest', 'barbell'],
  },
  {
    id: 'incline-db-press',
    name: 'Incline Dumbbell Press',
    description: 'Incline dumbbell chest press at 30-45 degrees',
    tags: ['push', 'chest', 'dumbbells'],
  },
  {
    id: 'overhead-press',
    name: 'Overhead Press',
    description: 'Standing barbell overhead press',
    tags: ['push', 'shoulders', 'barbell'],
  },
  {
    id: 'lateral-raise',
    name: 'Lateral Raise',
    description: 'Standing dumbbell lateral raise',
    tags: ['push', 'shoulders', 'dumbbells'],
  },
  {
    id: 'barbell-row',
    name: 'Barbell Row',
    description: 'Bent-over barbell row',
    tags: ['pull', 'back', 'barbell'],
  },
  {
    id: 'pullup',
    name: 'Pull-up',
    description: 'Bodyweight or weighted pull-up',
    tags: ['pull', 'back', 'pullup_bar'],
  },
  {
    id: 'barbell-curl',
    name: 'Barbell Curl',
    description: 'Standing barbell bicep curl',
    tags: ['pull', 'biceps', 'barbell'],
  },
  {
    id: 'squat',
    name: 'Barbell Squat',
    description: 'Back squat with barbell',
    tags: ['legs', 'quads', 'barbell', 'rack'],
  },
  {
    id: 'calf-raise',
    name: 'Standing Calf Raise',
    description: 'Standing calf raise on machine or step',
    tags: ['legs', 'calves'],
  },
]

/** id → display name lookup for built-in exercises */
export const EXERCISE_MAP: Record<string, string> = Object.fromEntries(
  EXERCISES.map((e) => [e.id, e.name]),
)

/** Runtime name lookup for user-added custom exercises. Populated via registerCustomExercises(). */
let customExerciseMap: Record<string, string> = {}

/**
 * Registers the current set of custom exercises so getExerciseName() can resolve them.
 * Call on app startup after loading from IndexedDB, and after any add/remove.
 */
export function registerCustomExercises(exercises: Exercise[]): void {
  customExerciseMap = Object.fromEntries(exercises.map((e) => [e.id, e.name]))
}

/**
 * Returns the display name for an exercise ID.
 * Checks custom exercises first, then built-ins, then humanizes the slug.
 */
export function getExerciseName(id: string): string {
  return (
    customExerciseMap[id] ??
    EXERCISE_MAP[id] ??
    id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

/**
 * Compact catalog listing for injection into the AI system prompt.
 * Always includes built-in exercises. Custom exercises are appended if provided.
 */
export function buildCatalogPromptSection(customExercises: Exercise[] = []): string {
  const catalog = [...EXERCISES, ...customExercises]
  const lines = catalog.map((e) => `  ${e.id}`)
  return [
    '## Exercise Catalog',
    '',
    'Use only these exerciseId values in workout entries. Do not invent new IDs.',
    'Use add_exercise to add a new exercise before referencing it.',
    '',
    ...lines,
  ].join('\n')
}
