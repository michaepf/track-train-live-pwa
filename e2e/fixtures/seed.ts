import type { Page } from '@playwright/test'

/** A fake key. It only has to be non-empty; OpenRouter is mocked, so it is never checked. */
export const FAKE_API_KEY = 'sk-or-v1-e2e-fake-key-not-real'

/**
 * Put the app into a signed-in, onboarded state without the OAuth redirect.
 *
 * Writes go through the app's own src/lib/db.ts (loaded from the Vite dev
 * server), so the stores, keys and schema versions are exactly the app's.
 * Profile, goals and an active plan mean Chat opens in planning mode.
 */
export async function seedSignedInUser(page: Page, opts: { model?: string } = {}) {
  await page.goto('/')
  await page.evaluate(
    async ({ apiKey, model }) => {
      const db = await import('/src/lib/db.ts')
      const now = new Date().toISOString()
      const today = new Date().toLocaleDateString('en-CA', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      await db.setSetting('apiKey', apiKey)
      if (model) await db.setSetting('model', model)
      await db.saveRestTimerEnabled(false)
      await db.saveProfile({
        _v: 1, sex: null, experience: 'intermediate', availableDays: 3, sessionMinutes: 45,
        equipment: ['dumbbells', 'cable machine'], injuries: null, notes: null, updatedAt: now,
      })
      await db.saveGoals({ _v: 1, text: 'Build general strength.', updatedAt: now, pendingReview: false })
      await db.saveTrainingPlan({
        _v: 1, name: 'E2E Plan', split: 'Full body', daysPerWeek: 3, durationWeeks: 6,
        focus: 'general fitness', strategy: 'Fixture plan for end-to-end tests.', startDate: today,
        status: 'active', pendingReview: false, createdAt: now, updatedAt: now,
      })
    },
    { apiKey: FAKE_API_KEY, model: opts.model ?? null },
  )
  await page.reload()
}

/** Today's date (YYYY-MM-DD) in the browser's timezone, as the app computes it. */
export function todayIn(timeZone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone })
}
