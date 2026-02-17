/**
 * @tags @admin @critical
 * Tests dashboard page loading. Uses admin storage state.
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@admin @critical Dashboard Module', () => {
  test('dashboard loads with module tiles', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/dashboard');
    await waitForAppReady(page);

    expect(page.url()).toContain('/dashboard');

    const bodyText = await page.locator('body').innerText();
    const hasContent = /workshop|fleet|timesheet|inspection|dashboard/i.test(bodyText);
    expect(hasContent, 'Dashboard should show module tiles').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on dashboard').toHaveLength(0);
  });
});
