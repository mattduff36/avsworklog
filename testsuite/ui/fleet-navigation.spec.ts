/**
 * @tags @fleet @critical
 * Tests fleet page tabs, data loading, and legacy redirects.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: read-only navigation.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@fleet @critical Fleet Navigation', () => {
  test('fleet page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/fleet');
    await waitForAppReady(page);

    expect(page.url()).toContain('/fleet');
    const bodyText = await page.locator('body').innerText();
    expect(/maintenance|fleet|vehicle/i.test(bodyText), 'Fleet page should have content').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on fleet').toHaveLength(0);
  });

  test('can switch to vehicles tab', async ({ page }) => {
    await page.goto('/fleet?tab=vehicles');
    await waitForAppReady(page);
    const bodyText = await page.locator('body').innerText();
    expect(/vehicle/i.test(bodyText)).toBeTruthy();
  });

  test('can switch to categories tab', async ({ page }) => {
    await page.goto('/fleet?tab=categories');
    await waitForAppReady(page);
    const bodyText = await page.locator('body').innerText();
    expect(/categor/i.test(bodyText)).toBeTruthy();
  });

  test('can switch to settings tab', async ({ page }) => {
    await page.goto('/fleet?tab=settings');
    await waitForAppReady(page);
    const bodyText = await page.locator('body').innerText();
    expect(/settings/i.test(bodyText)).toBeTruthy();
  });

  test('/maintenance redirects to /fleet', async ({ page }) => {
    await page.goto('/maintenance');
    await waitForAppReady(page);
    await expect(page).toHaveURL(/\/fleet/, { timeout: 10_000 });
  });
});
