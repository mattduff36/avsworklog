/**
 * @tags @inspections @rams @messages
 * Tests page loading for inspections, RAMS, and messages.
 * Auth: employee storage state (via employee project).
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@inspections Inspections Module', () => {
  test('inspections page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/inspections');
    await waitForAppReady(page);

    await expect(page.getByText(/inspection/i).first()).toBeVisible();
    const errors = capture.getErrors();
    expect(errors, 'No page errors on inspections').toHaveLength(0);
  });
});

test.describe('@messages Messages Module', () => {
  test('messages page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/messages');
    await waitForAppReady(page);

    // Either we're on /messages or redirected to dashboard (if messages module not available for employee)
    const bodyText = await page.locator('body').innerText();
    const hasContent = /message|notification|dashboard/i.test(bodyText);
    expect(hasContent, 'Messages or dashboard should load').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on messages').toHaveLength(0);
  });
});
