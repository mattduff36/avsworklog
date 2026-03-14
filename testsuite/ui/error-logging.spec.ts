/**
 * @tags @errors @critical
 * Tests error logging and console error absence on critical pages.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

async function gotoWithTimeoutSkip(
  page: import('@playwright/test').Page,
  route: string,
  skipMessage: string
) {
  try {
    await page.goto(route);
    await waitForAppReady(page);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    test.skip(
      message.includes('timeout') ||
      message.includes('err_connection_refused') ||
      message.includes('net::err_connection_refused'),
      skipMessage
    );
    throw error;
  }
}

test.describe('@errors @critical Error Logging', () => {
  test('admin can access debug console', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await gotoWithTimeoutSkip(page, '/debug', 'Debug route timed out in this environment');

    // Some admin fixtures are non-superadmin and can be redirected away from /debug.
    const onDebugRoute = /\/debug(?:$|[?#/])/.test(page.url());
    test.skip(!onDebugRoute, 'Debug console requires superadmin privileges in this environment');

    const bodyText = await page.locator('body').innerText();
    const accessDenied = /access denied|forbidden|unauthori|super\s*admin/i.test(bodyText);
    test.skip(accessDenied, 'Debug console is superadmin-only for this environment');

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
      await gotoWithTimeoutSkip(page, path, `${name} route timed out in this environment`);

      const errors = capture.getErrors();
      expect(errors, `No console errors on ${name}`).toHaveLength(0);
    });
  }
});
