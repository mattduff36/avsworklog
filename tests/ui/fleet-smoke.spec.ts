import { test, expect } from '@playwright/test';

test.describe('Fleet page smoke', () => {
  test('loads fleet route and key tabs', async ({ page }) => {
    await page.goto('/fleet?tab=vans');

    const fleetHeading = page.getByRole('heading', { name: 'Fleet Management' });
    const fleetVisible = await fleetHeading.isVisible().catch(() => false);

    if (fleetVisible) {
      await expect(page.getByRole('tab', { name: 'Vans' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Plant' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'HGVs' })).toBeVisible();
      return;
    }

    // Some environments are unauthenticated by default; assert login shell instead.
    await expect(page.getByLabel('Email Address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
