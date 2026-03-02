/**
 * Auth setup — runs ONCE before all UI tests.
 * Logs in as each role and saves browser storage state to disk.
 * Subsequent tests reuse the saved state (instant auth, no login page).
 */
import { test as setup, expect } from '@playwright/test';
import { getTestUser, storageStatePath } from '../helpers/auth';

const roles = ['admin', 'manager', 'employee'] as const;

for (const role of roles) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    const user = getTestUser(role);
    await page.goto('/login');
    await page.getByLabel('Email Address').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait for navigation away from login
    await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 20_000 });

    // Handle must-change-password interstitial
    if (page.url().includes('/change-password')) {
      await page.locator('#new-password').fill(user.password);
      await page.locator('#confirm-password').fill(user.password);
      await page.getByRole('button', { name: /change password/i }).click();
      await page.waitForURL('**/dashboard', { timeout: 15_000 });
    }

    await expect(page).toHaveURL(/\/dashboard/);

    // Save storage state
    await page.context().storageState({ path: storageStatePath(role) });
  });
}
