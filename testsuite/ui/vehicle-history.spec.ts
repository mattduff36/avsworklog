/**
 * @tags @fleet
 * Tests vehicle history page tabs and data display.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@fleet Vehicle History', () => {
  test('can navigate to fleet vehicles tab', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/fleet?tab=vehicles');
    await waitForAppReady(page);

    await expect(page.getByText(/vehicle/i).first()).toBeVisible();
    const errors = capture.getErrors();
    expect(errors, 'No page errors on fleet vehicles').toHaveLength(0);
  });
});
