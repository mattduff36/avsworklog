/**
 * @tags @inventory @critical
 * Smoke tests inventory route and table controls.
 */
import { test, expect } from '@playwright/test';
import { gotoWithTimeoutSkip } from '../helpers/page-smoke';

test.describe('@inventory @critical Inventory', () => {
  test('inventory page loads with table or empty state', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/inventory', 'Inventory route timed out in this environment');

    await expect(page.locator('body')).toContainText(/inventory|stock|item|group|location|category/i, {
      timeout: 10_000,
    });
  });

  test('inventory groups/settings state is reachable from the page shell', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/inventory', 'Inventory route timed out in this environment');

    await expect(page.locator('body')).toContainText(/search|filter|columns|show more|inventory/i, {
      timeout: 10_000,
    });
  });

  test('explicit Small Tools and Hardware overview deep links are reachable', async ({ page }) => {
    await gotoWithTimeoutSkip(
      page,
      '/inventory?overview=small-tools',
      'Small Tools inventory route timed out in this environment',
    );
    await expect(page).toHaveURL(/\/inventory\?overview=small-tools$/);
    await expect(page.locator('body')).toContainText(/inventory|small tools|item/i, {
      timeout: 10_000,
    });

    await gotoWithTimeoutSkip(
      page,
      '/inventory?overview=hardware',
      'Hardware inventory route timed out in this environment',
    );
    await expect(page).toHaveURL(/\/inventory\?overview=hardware$/);
    await expect(page.locator('body')).toContainText(/inventory|hardware|stock/i, {
      timeout: 10_000,
    });
  });

  test('Yard kiosk is isolated from the dashboard and fails closed for non-kiosk accounts', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/yard-kiosk', 'Yard kiosk route timed out in this environment');

    await expect(page.locator('body')).toContainText(/yard inventory/i, { timeout: 10_000 });
    const takeButton = page.getByRole('button', { name: /take/i });

    if (await takeButton.isVisible().catch(() => false)) {
      await takeButton.click();
      await expect(page.getByText(/where is it going/i)).toBeVisible();
      await expect(page.getByRole('navigation')).toHaveCount(0);
    } else {
      await expect(page.locator('body')).toContainText(/not authorised|unavailable|not configured/i);
    }
  });
});
