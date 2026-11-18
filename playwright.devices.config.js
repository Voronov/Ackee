import { defineConfig, devices } from '@playwright/test'

import base from './playwright.config.js'

// The same journey on the browsers and devices people use (ACKEE-130): `npx playwright test -c playwright.devices.config.js`
export default defineConfig({
  ...base,
  testMatch: 'devices.browser.js',
  reporter: [['list'], ['json', { outputFile: 'test-results/devices.json' }]],
  use: { ...base.use, launchOptions: {}, video: 'off' },
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'Desktop Firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'Desktop Safari', use: { ...devices['Desktop Safari'] } },
    { name: 'iPhone 15', use: { ...devices['iPhone 15'] } },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'] } },
    { name: 'Galaxy S9+', use: { ...devices['Galaxy S9+'] } },
    { name: 'iPad (gen 7)', use: { ...devices['iPad (gen 7)'] } },
  ],
})
