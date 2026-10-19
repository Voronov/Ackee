import { defineConfig, devices } from '@playwright/test'

// Browser tests against a running Ackee (see e2e/docker-compose.yml). No retries: a test
// that needs a second try is a flaky test, and it should show.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.browser.js',
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    // Maps a name like ackee.localhost to the container that serves Ackee, see e2e/docker-compose.yml
    launchOptions: process.env.E2E_RESOLVE ? { args: [`--host-resolver-rules=MAP ${process.env.E2E_RESOLVE}`] } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
