// @ts-nocheck
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
    await page.goto('/fleet?tab=vans');
    await waitForAppReady(page);

    const bodyText = await page.locator('body').innerText();
    const hasFleetContent = /van|fleet|registration|asset/i.test(bodyText);
    expect(hasFleetContent, 'Fleet vans tab should render content').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on fleet vehicles').toHaveLength(0);
  });
});
