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
  test('fleet page loads with plant tab', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/fleet');
    await waitForAppReady(page);

    expect(page.url()).toContain('/fleet');
    const bodyText = await page.locator('body').innerText();
    expect(/plant|fleet/i.test(bodyText), 'Fleet page should have content').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on fleet').toHaveLength(0);
  });

  test('can switch to vans tab', async ({ page }) => {
    await page.goto('/fleet?tab=vans');
    await waitForAppReady(page);
    const bodyText = await page.locator('body').innerText();
    expect(/van/i.test(bodyText)).toBeTruthy();
  });

  test('can switch to settings tab', async ({ page }) => {
    await page.goto('/fleet?tab=settings');
    await waitForAppReady(page);
    const bodyText = await page.locator('body').innerText();
    expect(/settings|categor/i.test(bodyText)).toBeTruthy();
  });

  test('/fleet?tab=maintenance redirects to /maintenance', async ({ page }) => {
    await page.goto('/fleet?tab=maintenance');
    await waitForAppReady(page);
    await expect(page).toHaveURL(/\/maintenance/, { timeout: 10_000 });
  });

  test('/maintenance page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/maintenance');
    await waitForAppReady(page);

    expect(page.url()).toContain('/maintenance');
    const bodyText = await page.locator('body').innerText();
    expect(/maintenance|service/i.test(bodyText), 'Maintenance page should have content').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on maintenance').toHaveLength(0);
  });
});
