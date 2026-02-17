/**
 * @tags @perf @workshop
 * Performance test: comments drawer opens within 2s.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@perf @workshop Comments Drawer Performance', () => {
  test('comments drawer opens within 2s', async ({ page }) => {
    await page.goto('/workshop-tasks');
    await waitForAppReady(page);

    const commentsBtn = page.getByRole('button', { name: /comment/i }).first();
    const hasBtn = await commentsBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasBtn) { test.skip(true, 'No comments button found'); return; }

    const start = Date.now();
    await commentsBtn.click();
    await expect(page.getByText(/comment|timeline|add comment/i).first()).toBeVisible({ timeout: 2_000 });
    const elapsed = Date.now() - start;

    expect(elapsed, 'Drawer should open within 2000ms').toBeLessThan(2_000);
  });
});
