/**
 * @tags @admin @critical
 * Tests admin user management page navigation and basic controls.
 * NON-DESTRUCTIVE: only navigates and reads page content.
 * Auth: uses pre-cached admin storage state.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@admin @critical Admin Users Module', () => {
  test('admin can access user management page', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/admin/users');
    await waitForAppReady(page);

    // Should stay on admin/users (not redirected away)
    expect(page.url()).toContain('/admin/users');
    // Page should have rendered content
    await expect(page.locator('body')).not.toBeEmpty();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on admin users').toHaveLength(0);
  });

  test('admin users page shows user list', async ({ page }) => {
    await page.goto('/admin/users');
    await waitForAppReady(page);

    // Should show some table or list content
    const bodyText = await page.locator('body').innerText();
    const hasUserContent = /user|employee|manager|admin|email/i.test(bodyText);
    expect(hasUserContent, 'Admin users page should show user content').toBeTruthy();
  });
});
