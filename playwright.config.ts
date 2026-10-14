import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'deployment.spec.ts',
  fullyParallel: true,
  // The API and Vite both cold-start slowly here (the health endpoint alone can
  // take ~40s while the Postgres pool comes up), so the very first tests to run
  // can race that warm-up and time out on a locator. One retry absorbs that
  // without hiding a real failure, which would fail twice.
  retries: process.env.CI ? 2 : 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  // Both halves are waited on, and separately: the API's readiness is its own
  // health check, not the Vite page, because on a real database the server
  // answers 500 to every request during the window when it is listening but the
  // pool is not up yet. Vite is waited on too, so a test never starts while the
  // page is still 5173-refused. A single `npm run dev` gates only on the URL it
  // is given, which is how a test came to begin against a Vite that was not up.
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
