import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the demo pages in every engine the editor supports:
 *   npx playwright test             (all browsers)
 *   npx playwright test --project=webkit
 * The demo dev server is started automatically (or reused when already running).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // Safari's engine.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 14'] } }
  ],
  webServer: {
    command: 'npm run dev -w aveon-demo',
    url: 'http://localhost:5180',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
