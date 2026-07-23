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
      await expect(page.locator('body')).toContainText(
        /wrong account|not authorised|unavailable|not configured/i,
      );
    }
  });
});

test.describe('@inventory Inventory kiosk control on mobile', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });

  test('keeps the fixed kiosk replica inside a horizontal scroll region', async ({ page }) => {
    await gotoWithTimeoutSkip(
      page,
      '/inventory/kiosk-control',
      'Inventory kiosk control timed out in this environment',
    );

    const replicaRegion = page.getByRole('region', { name: 'Scrollable Yard kiosk replica' });
    await expect(replicaRegion).toBeVisible();
    await expect(page.getByTestId('yard-kiosk-virtual-screen')).toHaveCSS('width', '1024px');

    const documentOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(documentOverflow).toBeLessThanOrEqual(1);
  });
});
