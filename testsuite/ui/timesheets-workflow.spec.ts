/**
 * @tags @timesheets @critical
 * Tests timesheet page navigation and listing.
 * Auth: manager storage state (via timesheets project).
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@timesheets @critical Timesheets Workflow', () => {
  test('timesheets page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/timesheets');
    await waitForAppReady(page);

    expect(page.url()).toContain('/timesheets');
    const bodyText = await page.locator('body').innerText();
    expect(/timesheet/i.test(bodyText), 'Timesheets page should show content').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on timesheets').toHaveLength(0);
  });

  test('new timesheet form loads', async ({ page }) => {
    await page.goto('/timesheets/new');
    await waitForAppReady(page);

    const bodyText = await page.locator('body').innerText();
    expect(/week ending|timesheet|new/i.test(bodyText)).toBeTruthy();
  });
});
