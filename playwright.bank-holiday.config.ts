import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  testMatch: /bank-holiday-self-override\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4000/pwa-debug',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AVS_BANK_HOLIDAY_E2E_TOKEN: process.env.AVS_BANK_HOLIDAY_E2E_TOKEN || '',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-e2e-only',
    },
  },
});
