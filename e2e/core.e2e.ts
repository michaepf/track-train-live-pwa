import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { TIMEZONE } from '../playwright.config.ts'
import { E2E_SESSION, proposeWorkoutTurn } from './fixtures/conversations.ts'
import { mockOpenRouter } from './fixtures/openrouter.ts'
import { FAKE_API_KEY, seedSignedInUser, todayIn } from './fixtures/seed.ts'

/** Collect console errors and uncaught page errors for the whole test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function openTab(page: Page, label: string) {
  await page.locator('nav.tab-bar button', { hasText: label }).click()
}

test('the app loads signed in with no console errors', async ({ page }) => {
  const errors = watchErrors(page)
  const openrouter = await mockOpenRouter(page, [])
  await seedSignedInUser(page)

  await expect(page.locator('nav.tab-bar')).toBeVisible()
  for (const label of ['Today', 'Workouts', 'Log', 'Settings', 'Chat']) {
    await openTab(page, label)
  }
  await expect(page.locator('textarea')).toBeVisible()

  expect(openrouter.requests).toHaveLength(0)
  expect(openrouter.unexpected).toEqual([])
  expect(errors).toEqual([])
})

test('chat proposes a workout, Today logs and completes it, Log shows it', async ({ page }) => {
  const errors = watchErrors(page)
  const today = todayIn(TIMEZONE)
  const openrouter = await mockOpenRouter(page, [proposeWorkoutTurn(today)])
  await seedSignedInUser(page)

  await test.step('chat: the proposal arrives through the tool-call flow and is accepted', async () => {
    await page.locator('textarea').fill('Plan an upper-body workout for today.')
    await page.keyboard.press('Enter')
    const card = page.locator('.tool-card', { hasText: 'Proposed Workouts' })
    await expect(card).toBeVisible()
    await expect(card).toContainText(E2E_SESSION)
    await card.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByText('Saved 1 workout to your plan.').first()).toBeVisible()

    expect(openrouter.requests).toHaveLength(1)
    const [request] = openrouter.requests
    expect(request.stream).toBe(true)
    expect(request.toolNames).toContain('propose_workout')
    expect(request.authorization).toBe(`Bearer ${FAKE_API_KEY}`)
  })

  await test.step('Today: log every set and complete the workout', async () => {
    await openTab(page, 'Today')
    const workout = page.locator('section', { hasText: E2E_SESSION })
    await expect(workout).toBeVisible()
    const doneButtons = workout.locator('.today-diff-btn', { hasText: 'Done' })
    await expect(doneButtons).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await doneButtons.nth(i).click()
      await expect(doneButtons.nth(i)).toHaveClass(/is-done/)
    }
    await workout.getByRole('button', { name: 'Complete workout' }).click()
    await expect(workout.getByRole('button', { name: /Workout complete/ })).toBeVisible()
  })

  await test.step('Log: the completed session is listed', async () => {
    const debriefHeading = page.getByRole('heading', { name: 'Workout done!' })
    await expect(debriefHeading).toBeVisible()
    const notNow = page.getByRole('button', { name: 'Not now', exact: true })
    await expect(notNow).toBeVisible()
    await notNow.click()
    await expect(debriefHeading).toBeHidden()
    await openTab(page, 'Log')
    await expect(page.locator('.history-card', { hasText: E2E_SESSION })).toBeVisible()
  })

  expect(openrouter.remaining()).toBe(0)
  expect(openrouter.unexpected).toEqual([])
  expect(errors).toEqual([])
})
