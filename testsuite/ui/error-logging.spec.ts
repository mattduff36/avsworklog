/**
 * @tags @errors @critical
 * Tests error logging and console error absence on critical pages.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@errors @critical Error Logging', () => {
  test('admin can access debug console', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/debug');
    await waitForAppReady(page);

    // Should not be redirected away
    const bodyText = await page.locator('body').innerText();
    const hasContent = /debug|error|log|report/i.test(bodyText);
    expect(hasContent, 'Debug console should be accessible to admin').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on debug console').toHaveLength(0);
  });

  test('error logging endpoint responds', async ({ request }) => {
    const res = await request.post('/api/test-error-logging');
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe('@errors @critical No Console Errors on Critical Pages', () => {
  const criticalPages = [
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Workshop Tasks', path: '/workshop-tasks' },
    { name: 'Fleet', path: '/fleet' },
    { name: 'Timesheets', path: '/timesheets' },
  ];

  for (const { name, path } of criticalPages) {
    test(`no console errors on ${name}`, async ({ page }) => {
      const capture = attachConsoleErrorCapture(page);
      await page.goto(path);
      await waitForAppReady(page);

      const errors = capture.getErrors();
      expect(errors, `No console errors on ${name}`).toHaveLength(0);
    });
  }
});
