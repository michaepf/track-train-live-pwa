import type { Page } from '@playwright/test'

export const MODELS_CONFIG_URL =
  'https://raw.githubusercontent.com/michaepf/track-train-live-pwa/main/config/models.json'

/** A list that differs from the built-in one, so tests can tell which was used. */
export const TEST_MODELS_CONFIG = {
  default: 'z-ai/glm-5.2:nitro',
  models: [
    { id: 'z-ai/glm-5.2:nitro', label: 'GLM 5.2', note: 'Affordable' },
    { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Premium' },
    { id: 'e2e/test-model', label: 'E2E Test Model', note: 'Only exists in the e2e fixture' },
  ],
}

/**
 * Answer the app's startup fetch of config/models.json, so tests never reach GitHub.
 * `'fail'` simulates the file being unreachable (the app should use its built-in list).
 */
export async function mockModelsConfig(page: Page, config: unknown | 'fail' = TEST_MODELS_CONFIG) {
  const hits: string[] = []
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    hits.push(route.request().url())
    if (config === 'fail' || route.request().url() !== MODELS_CONFIG_URL) {
      await route.fulfill({ status: 404, body: 'Not Found' })
      return
    }
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' },
      body: JSON.stringify(config),
    })
  })
  return { hits }
}
