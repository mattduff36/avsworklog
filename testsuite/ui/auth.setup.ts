/**
 * Auth setup — runs ONCE before all UI tests.
 * Logs in as each role and saves browser storage state to disk.
 * Subsequent tests reuse the saved state (instant auth, no login page).
 */
import { test as setup, expect } from '@playwright/test';
import { login, saveStorageState } from '../helpers/auth';

const roles = ['admin', 'manager', 'employee'] as const;

for (const role of roles) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await login(page, role);
    await expect(page).toHaveURL(/\/dashboard/);
    await saveStorageState(page.context(), role);
  });
}
