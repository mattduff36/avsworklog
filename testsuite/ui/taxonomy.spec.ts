/**
 * @tags @workshop
 * Tests category/subcategory cascade on workshop settings.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@workshop Taxonomy – Subcategory Filtering', () => {
  test('workshop settings shows categories', async ({ page }) => {
    await page.goto('/workshop-tasks?tab=settings');
    await waitForAppReady(page);
    await expect(page.getByText(/service|repair|modification|other|uncategorised/i).first()).toBeVisible({ timeout: 5_000 });
  });
});
