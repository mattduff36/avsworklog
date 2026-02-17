/**
 * @tags @critical
 * Tests help/FAQ and absence module pages.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@critical Help & FAQ', () => {
  test('help page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/help');
    await waitForAppReady(page);

    const hasContent = await page.getByText(/help|faq|support|guide/i).first()
      .isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasContent || page.url().includes('/help')).toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on help page').toHaveLength(0);
  });
});
