import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run the real app in Chromium against the Vite dev server.
// OpenRouter is never contacted: e2e/fixtures/openrouter.ts answers every
// request from scripted streaming fixtures, and any unexpected call fails the test.
const PORT = 5179
export const TIMEZONE = 'America/Los_Angeles'

export default defineConfig({
  testDir: './e2e',
  // *.e2e.ts, not *.test.ts / *.spec.ts, so vitest never collects these files.
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    timezoneId: TIMEZONE,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
