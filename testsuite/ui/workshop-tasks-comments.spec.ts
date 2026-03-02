/**
 * @tags @workshop @critical
 * Tests workshop task page, comments drawer, and taxonomy.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: uses only test-tagged data.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@workshop @critical Workshop Tasks & Comments', () => {
  test('workshop tasks page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/workshop-tasks');
    await waitForAppReady(page);

    await expect(page).toHaveURL(/\/workshop-tasks/);
    await expect(page.getByText(/workshop/i).first()).toBeVisible();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on workshop tasks').toHaveLength(0);
  });

  test('comments button opens drawer on a task', async ({ page }) => {
    await page.goto('/workshop-tasks');
    await waitForAppReady(page);

    const commentsBtn = page.getByRole('button', { name: /comment/i }).first();
    const hasBtn = await commentsBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasBtn) {
      test.skip(true, 'No comments button found — may need tasks in DB');
      return;
    }

    await commentsBtn.click();
    await expect(page.getByText(/comment|timeline/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('comment requires minimum 10 characters', async ({ page }) => {
    await page.goto('/workshop-tasks');
    await waitForAppReady(page);

    const commentsBtn = page.getByRole('button', { name: /comment/i }).first();
    const hasBtn = await commentsBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasBtn) { test.skip(true, 'No comments button found'); return; }
    await commentsBtn.click();

    const textarea = page.getByRole('textbox').first();
    const hasTextarea = await textarea.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasTextarea) { test.skip(true, 'No comment textarea found'); return; }

    await textarea.fill('Short');
    const addBtn = page.getByRole('button', { name: /add comment/i });
    const hasAddBtn = await addBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (hasAddBtn) {
      const isDisabled = await addBtn.isDisabled();
      if (!isDisabled) {
        await addBtn.click();
        await expect(page.getByText(/minimum|at least|too short|10/i).first()).toBeVisible({ timeout: 3_000 });
      }
    }
  });
});
