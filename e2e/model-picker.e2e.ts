import { expect, test, type Page } from '@playwright/test'
import { MODELS_CONFIG_URL, TEST_MODELS_CONFIG, mockModelsConfig } from './fixtures/models.ts'
import { mockOpenRouter } from './fixtures/openrouter.ts'
import { seedSignedInUser } from './fixtures/seed.ts'

async function openModelMenu(page: Page) {
  await page.getByRole('button', { name: 'Chat options' }).click()
  return page.locator('.chat-menu-dropdown')
}

async function sendMessage(page: Page, text: string) {
  await page.locator('textarea').fill(text)
  await page.keyboard.press('Enter')
}

test('the picker lists every model in config/models.json and the request uses the chosen id', async ({ page }) => {
  const models = await mockModelsConfig(page)
  const openrouter = await mockOpenRouter(page, [
    { kind: 'text', text: 'First reply.' },
    { kind: 'text', text: 'Second reply.' },
  ])
  await seedSignedInUser(page)

  const menu = await openModelMenu(page)
  const options = menu.locator('.chat-menu-option:not(.chat-menu-option--danger)')
  await expect(options).toHaveCount(TEST_MODELS_CONFIG.models.length)
  for (const model of TEST_MODELS_CONFIG.models) {
    await expect(options.filter({ hasText: model.label })).toHaveCount(1)
  }
  // Nothing saved yet: the file's default is active.
  await expect(menu.locator('.chat-menu-option--active')).toContainText('GLM 5.2')

  await options.filter({ hasText: 'E2E Test Model' }).click()
  await sendMessage(page, 'Hello')
  await expect(page.getByText('First reply.')).toBeVisible()
  expect(openrouter.requests[0].model).toBe('e2e/test-model')

  // The choice is saved and survives a reload.
  await page.reload()
  await expect((await openModelMenu(page)).locator('.chat-menu-option--active')).toContainText('E2E Test Model')
  await page.keyboard.press('Escape')
  await page.locator('.chat-menu-backdrop').click()
  await sendMessage(page, 'Again')
  await expect(page.getByText('Second reply.')).toBeVisible()
  expect(openrouter.requests[1].model).toBe('e2e/test-model')

  expect(models.hits.every((url) => url === MODELS_CONFIG_URL)).toBe(true)
  expect(openrouter.unexpected).toEqual([])
})

test('an unreachable models file falls back to the built-in list', async ({ page }) => {
  await mockModelsConfig(page, 'fail')
  const openrouter = await mockOpenRouter(page, [{ kind: 'text', text: 'Reply.' }])
  await seedSignedInUser(page)

  const menu = await openModelMenu(page)
  const options = menu.locator('.chat-menu-option:not(.chat-menu-option--danger)')
  await expect(options).toHaveCount(2)
  await expect(options.filter({ hasText: 'E2E Test Model' })).toHaveCount(0)
  await menu.locator('.chat-menu-option', { hasText: 'Claude Sonnet 5' }).click()
  await sendMessage(page, 'Hello')
  await expect(page.getByText('Reply.')).toBeVisible()
  expect(openrouter.requests[0].model).toBe('anthropic/claude-sonnet-5')
})

test('a saved model that is no longer listed, or a legacy tier value, falls back to the default', async ({ page }) => {
  for (const saved of ['premium', 'retired/model']) {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await mockModelsConfig(page)
    const openrouter = await mockOpenRouter(page, [{ kind: 'text', text: `Reply for ${saved}.` }])
    await seedSignedInUser(page, { model: saved })
    await sendMessage(page, 'Hello')
    await expect(page.getByText(`Reply for ${saved}.`)).toBeVisible()
    expect(openrouter.requests[0].model, `saved=${saved}`).toBe(TEST_MODELS_CONFIG.default)
  }
})
