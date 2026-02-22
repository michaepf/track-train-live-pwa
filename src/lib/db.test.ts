import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  _resetDB,
  getGoals,
  saveGoals,
  getWorkoutsByDate,
  getWorkoutById,
  saveWorkout,
  deleteWorkout,
  listWorkouts,
  getConversation,
  saveConversation,
  createConversation,
  listConversations,
  getSummary,
  saveSummary,
  getSetting,
  setSetting,
  deleteSetting,
} from './db.ts'
import type { Goals, Workout } from './schemas/index.ts'

// Give each test a fresh in-memory IndexedDB
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  _resetDB()
})

// ─── Goals ────────────────────────────────────────────────────────────────────

describe('goals', () => {
  it('returns null when no goals saved', async () => {
    expect(await getGoals()).toBeNull()
  })

  it('round-trips goals', async () => {
    const goals: Goals = {
      _v: 1,
      text: 'Get stronger, stay consistent',
      updatedAt: '2026-02-21T10:00:00.000Z',
      pendingReview: false,
    }
    await saveGoals(goals)
    expect(await getGoals()).toEqual(goals)
  })

  it('overwrites existing goals on save', async () => {
    const first: Goals = {
      _v: 1,
      text: 'First goals',
      updatedAt: '2026-02-21T10:00:00.000Z',
      pendingReview: false,
    }
    const second: Goals = {
      _v: 1,
      text: 'Updated goals',
      updatedAt: '2026-02-21T12:00:00.000Z',
      pendingReview: true,
    }
    await saveGoals(first)
    await saveGoals(second)
    expect(await getGoals()).toEqual(second)
  })
})

// ─── Workouts ─────────────────────────────────────────────────────────────────

function makeWorkout(date: string, overrides: Partial<Workout> = {}): Workout {
  return {
    _v: 1,
    date,
    workoutType: 'strength',
    entries: [
      {
        exerciseId: 'bench-press',
        sets: [{ plannedReps: 8, plannedWeight: 135 }],
      },
    ],
    cardioMode: 'pick_one',
    feedback: [],
    ...overrides,
  }
}

describe('workouts', () => {
  it('saves and retrieves by date', async () => {
    const workout = makeWorkout('2026-02-21')
    const saved = await saveWorkout(workout)
    expect(saved.id).toBeDefined()
    const results = await getWorkoutsByDate('2026-02-21')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(saved.id)
    expect(results[0].date).toBe('2026-02-21')
  })

  it('supports multiple workouts on the same date', async () => {
    const a = await saveWorkout(makeWorkout('2026-02-21', { workoutType: 'strength' }))
    const b = await saveWorkout(makeWorkout('2026-02-21', { workoutType: 'cardio' }))
    const results = await getWorkoutsByDate('2026-02-21')
    expect(results).toHaveLength(2)
    // sorted by id ascending
    expect(results[0].id).toBe(a.id)
    expect(results[1].id).toBe(b.id)
  })

  it('returns empty array for date with no workouts', async () => {
    expect(await getWorkoutsByDate('2026-01-01')).toEqual([])
  })

  it('retrieves by id', async () => {
    const saved = await saveWorkout(makeWorkout('2026-02-21'))
    const result = await getWorkoutById(saved.id!)
    expect(result).not.toBeNull()
    expect(result!.id).toBe(saved.id)
  })

  it('returns null for unknown id', async () => {
    expect(await getWorkoutById(999)).toBeNull()
  })

  it('updates existing workout when id is present', async () => {
    const saved = await saveWorkout(makeWorkout('2026-02-21'))
    const updated = { ...saved, workoutType: 'updated' }
    await saveWorkout(updated)
    const result = await getWorkoutById(saved.id!)
    expect(result!.workoutType).toBe('updated')
    // Still just one record for this date
    expect(await getWorkoutsByDate('2026-02-21')).toHaveLength(1)
  })

  it('listWorkouts returns sorted date desc then id desc', async () => {
    const a = await saveWorkout(makeWorkout('2026-02-20'))
    const b = await saveWorkout(makeWorkout('2026-02-21'))
    const c = await saveWorkout(makeWorkout('2026-02-21'))
    const list = await listWorkouts(10)
    expect(list.map((w) => w.id)).toEqual([c.id, b.id, a.id])
  })

  it('listWorkouts respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await saveWorkout(makeWorkout(`2026-02-${String(i + 1).padStart(2, '0')}`))
    }
    expect(await listWorkouts(3)).toHaveLength(3)
  })

  it('deletes an unstarted workout', async () => {
    const saved = await saveWorkout(makeWorkout('2026-02-21'))
    await deleteWorkout(saved.id!)
    expect(await getWorkoutById(saved.id!)).toBeNull()
  })

  it('throws when deleting a completed workout', async () => {
    const workout = makeWorkout('2026-02-21', {
      entries: [
        {
          exerciseId: 'bench-press',
          sets: [{ plannedReps: 8, difficulty: 'completed' }],
        },
      ],
    })
    const saved = await saveWorkout(workout)
    await expect(deleteWorkout(saved.id!)).rejects.toThrow('completed')
  })

  it('throws when deleting a non-existent workout', async () => {
    await expect(deleteWorkout(999)).rejects.toThrow('not found')
  })
})

// ─── Conversations ─────────────────────────────────────────────────────────────

describe('conversations', () => {
  it('creates a conversation with id and timestamps', async () => {
    const conv = await createConversation('planning')
    expect(conv.id).toBeDefined()
    expect(conv.type).toBe('planning')
    expect(conv.messages).toEqual([])
    expect(conv.createdAt).toBeTruthy()
  })

  it('round-trips a conversation', async () => {
    const created = await createConversation('onboarding')
    const fetched = await getConversation(created.id!)
    expect(fetched).not.toBeNull()
    expect(fetched!.type).toBe('onboarding')
  })

  it('returns null for unknown id', async () => {
    expect(await getConversation(999)).toBeNull()
  })

  it('updates an existing conversation', async () => {
    const created = await createConversation('planning')
    const updated = {
      ...created,
      messages: [{ role: 'user' as const, content: 'Hello' }],
    }
    await saveConversation(updated)
    const fetched = await getConversation(created.id!)
    expect(fetched!.messages).toHaveLength(1)
  })

  it('listConversations returns most recent first', async () => {
    const a = await createConversation('onboarding')
    await new Promise((r) => setTimeout(r, 5)) // ensure different timestamps
    const b = await createConversation('planning')
    const list = await listConversations(10)
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
  })
})

// ─── Summaries ────────────────────────────────────────────────────────────────

describe('summaries', () => {
  it('returns null when no summary exists', async () => {
    expect(await getSummary('2026-W08')).toBeNull()
  })

  it('round-trips a summary', async () => {
    await saveSummary('2026-W08', 'Good week, hit all lifts.')
    expect(await getSummary('2026-W08')).toBe('Good week, hit all lifts.')
  })

  it('overwrites existing summary', async () => {
    await saveSummary('2026-W08', 'First version')
    await saveSummary('2026-W08', 'Updated version')
    expect(await getSummary('2026-W08')).toBe('Updated version')
  })
})

// ─── Settings ─────────────────────────────────────────────────────────────────

describe('settings', () => {
  it('returns null for missing key', async () => {
    expect(await getSetting('apiKey')).toBeNull()
  })

  it('round-trips a setting', async () => {
    await setSetting('apiKey', 'sk-test-123')
    expect(await getSetting('apiKey')).toBe('sk-test-123')
  })

  it('overwrites existing setting', async () => {
    await setSetting('model', 'premium')
    await setSetting('model', 'affordable')
    expect(await getSetting('model')).toBe('affordable')
  })

  it('deletes a setting', async () => {
    await setSetting('apiKey', 'sk-test-123')
    await deleteSetting('apiKey')
    expect(await getSetting('apiKey')).toBeNull()
  })
})
