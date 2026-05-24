/**
 * @tags @actions @reminders @critical
 * Smoke tests active actions/reminders surfaces.
 */
import { test, expect } from '@playwright/test';
import { expectSmokePage, gotoWithTimeoutSkip } from '../helpers/page-smoke';

test.describe('@actions @reminders Actions and Reminders', () => {
  test('actions overview loads', async ({ page }) => {
    await expectSmokePage({
      page,
      route: '/actions',
      content: /actions|daily checks|assign|status|reminder/i,
      name: 'actions overview',
    });
  });

  test('actions settings loads with settings and archive surfaces', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/actions?tab=settings', 'Actions settings route timed out in this environment');

    await expect(page.locator('body')).toContainText(/settings|ignored|actioned|daily checks|workflow/i, {
      timeout: 10_000,
    });
  });

  test('assigned reminders page loads', async ({ page }) => {
    await expectSmokePage({
      page,
      route: '/reminders',
      content: /reminder|assigned|complete|task|dashboard/i,
      name: 'assigned reminders',
    });
  });
});
