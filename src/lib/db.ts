import {
  type Goals,
  type Workout,
  type Conversation,
  type ConversationType,
  migrateGoals,
  migrateWorkout,
  migrateConversation,
  isWorkoutCompleted,
} from './schemas/index.ts'

export const DB_NAME = 'track-train-live'
export const DB_VERSION = 1

let _db: Promise<IDBDatabase> | null = null

/** Clear the cached DB connection. Only call this in tests. */
export function _resetDB(): void {
  _db = null
}

function getDB(): Promise<IDBDatabase> {
  if (_db) return _db
  _db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => upgrade(event)
    request.onsuccess = () => resolve(request.result as IDBDatabase)
    request.onerror = () => {
      _db = null // clear cache so next call retries rather than reusing the rejected promise
      reject(request.error)
    }
    request.onblocked = () => {
      _db = null
      reject(new Error('IndexedDB upgrade blocked — close other tabs and retry'))
    }
  })
  return _db
}

function upgrade(event: IDBVersionChangeEvent): void {
  const db = (event.target as IDBOpenDBRequest).result
  const { oldVersion } = event

  if (oldVersion < 1) {
    // goals — fixed key "current", no keyPath
    db.createObjectStore('goals')

    // workouts — auto-increment id, date index for lookups
    const workouts = db.createObjectStore('workouts', {
      keyPath: 'id',
      autoIncrement: true,
    })
    workouts.createIndex('by_date', 'date', { unique: false })

    // conversations — auto-increment id
    db.createObjectStore('conversations', {
      keyPath: 'id',
      autoIncrement: true,
    })

    // summaries — keyed by weekOf string (YYYY-WNN)
    db.createObjectStore('summaries', { keyPath: 'weekOf' })

    // settings — out-of-line string keys, string values
    db.createObjectStore('settings')
  }

  // Future migrations: if (oldVersion < 2) { ... }
}

function idbReq<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export async function getGoals(): Promise<Goals | null> {
  const db = await getDB()
  const result = await idbReq(
    db.transaction('goals', 'readonly').objectStore('goals').get('current'),
  )
  return result ? migrateGoals(result) : null
}

export async function saveGoals(goals: Goals): Promise<void> {
  const db = await getDB()
  await idbReq(
    db.transaction('goals', 'readwrite').objectStore('goals').put(goals, 'current'),
  )
}

// ─── Workouts ─────────────────────────────────────────────────────────────────

export async function getWorkoutsByDate(date: string): Promise<Workout[]> {
  const db = await getDB()
  const results: unknown[] = await idbReq(
    db
      .transaction('workouts', 'readonly')
      .objectStore('workouts')
      .index('by_date')
      .getAll(date),
  )
  return results
    .map(migrateWorkout)
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}

export async function getWorkoutById(id: number): Promise<Workout | null> {
  const db = await getDB()
  const result = await idbReq(
    db.transaction('workouts', 'readonly').objectStore('workouts').get(id),
  )
  return result ? migrateWorkout(result) : null
}

export async function saveWorkout(workout: Workout): Promise<Workout> {
  // Note: saveWorkout intentionally does NOT block updates to completed workouts.
  // The tracking UI needs to save difficulty values to in-progress workouts freely;
  // blocking on isWorkoutCompleted() would prevent logging the 2nd+ set after the
  // first is recorded. Immutability is enforced at the correct boundaries:
  //   - deleteWorkout() throws if completed
  //   - propose_workout accept uses always-append (never replaces existing records)
  const db = await getDB()
  const store = db.transaction('workouts', 'readwrite').objectStore('workouts')

  if (workout.id !== undefined) {
    await idbReq(store.put(workout))
    return workout
  } else {
    const id = (await idbReq(store.add(workout))) as number
    return { ...workout, id }
  }
}

export async function deleteWorkout(id: number): Promise<void> {
  // Read and check in a separate transaction first — two-transaction approach
  // is safe for a single-user local app (no meaningful TOCTOU risk).
  const existing = await getWorkoutById(id)
  if (!existing) throw new Error(`Workout ${id} not found`)
  if (isWorkoutCompleted(existing)) {
    throw new Error(`Workout ${id} is completed and cannot be deleted`)
  }

  const db = await getDB()
  await idbReq(
    db.transaction('workouts', 'readwrite').objectStore('workouts').delete(id),
  )
}

export async function listWorkouts(limit: number): Promise<Workout[]> {
  const db = await getDB()
  const results: unknown[] = await idbReq(
    db.transaction('workouts', 'readonly').objectStore('workouts').getAll(),
  )
  return results
    .map(migrateWorkout)
    .sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date)
      return dateCmp !== 0 ? dateCmp : (b.id ?? 0) - (a.id ?? 0)
    })
    .slice(0, limit)
}

// ─── Conversations ─────────────────────────────────────────────────────────────

export async function getConversation(id: number): Promise<Conversation | null> {
  const db = await getDB()
  const result = await idbReq(
    db
      .transaction('conversations', 'readonly')
      .objectStore('conversations')
      .get(id),
  )
  return result ? migrateConversation(result) : null
}

export async function saveConversation(conv: Conversation): Promise<Conversation> {
  const db = await getDB()
  const store = db
    .transaction('conversations', 'readwrite')
    .objectStore('conversations')

  if (conv.id !== undefined) {
    await idbReq(store.put(conv))
    return conv
  } else {
    const id = (await idbReq(store.add(conv))) as number
    return { ...conv, id }
  }
}

export async function createConversation(type: ConversationType): Promise<Conversation> {
  const now = new Date().toISOString()
  return saveConversation({
    _v: 1,
    type,
    messages: [],
    createdAt: now,
    updatedAt: now,
  })
}

export async function listConversations(limit: number): Promise<Conversation[]> {
  const db = await getDB()
  const results: unknown[] = await idbReq(
    db
      .transaction('conversations', 'readonly')
      .objectStore('conversations')
      .getAll(),
  )
  return results
    .map(migrateConversation)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

// ─── Summaries ────────────────────────────────────────────────────────────────

export async function getSummary(weekOf: string): Promise<string | null> {
  const db = await getDB()
  const result = await idbReq(
    db.transaction('summaries', 'readonly').objectStore('summaries').get(weekOf),
  )
  return result ? (result as { weekOf: string; text: string }).text : null
}

export async function saveSummary(weekOf: string, text: string): Promise<void> {
  const db = await getDB()
  await idbReq(
    db
      .transaction('summaries', 'readwrite')
      .objectStore('summaries')
      .put({ weekOf, text, createdAt: new Date().toISOString() }),
  )
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDB()
  const result = await idbReq(
    db.transaction('settings', 'readonly').objectStore('settings').get(key),
  )
  return result ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDB()
  await idbReq(
    db.transaction('settings', 'readwrite').objectStore('settings').put(value, key),
  )
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDB()
  await idbReq(
    db.transaction('settings', 'readwrite').objectStore('settings').delete(key),
  )
}

// ─── Maintenance ───────────────────────────────────────────────────────────────

/**
 * Clears all local app data from IndexedDB (goals, workouts, conversations,
 * summaries, settings). Useful for "start over" flows in development and UI.
 */
export async function clearAllData(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(
    ['goals', 'workouts', 'conversations', 'summaries', 'settings'],
    'readwrite',
  )

  tx.objectStore('goals').clear()
  tx.objectStore('workouts').clear()
  tx.objectStore('conversations').clear()
  tx.objectStore('summaries').clear()
  tx.objectStore('settings').clear()

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
