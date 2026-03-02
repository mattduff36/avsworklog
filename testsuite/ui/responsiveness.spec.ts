/**
 * @tags @critical
 * Tests critical pages at desktop, tablet, and mobile viewports.
 * Auth: admin storage state (via responsive project).
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

const viewports = [
  { name: 'Desktop', width: 1920, height: 1080 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Mobile', width: 375, height: 812 },
];

const pages = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Workshop Tasks', path: '/workshop-tasks' },
  { name: 'Fleet', path: '/fleet' },
];

for (const viewport of viewports) {
  test.describe(`@critical Responsive – ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const { name, path } of pages) {
      test(`${name} loads at ${viewport.name}`, async ({ page }) => {
        const capture = attachConsoleErrorCapture(page);
        await page.goto(path);
        await waitForAppReady(page);

        const hasError = await page.getByText(/something went wrong|error boundary|application error/i).first()
          .isVisible({ timeout: 2_000 }).catch(() => false);
        expect(hasError, `${name} should not show error at ${viewport.name}`).toBeFalsy();

        const errors = capture.getErrors();
        expect(errors, `No console errors on ${name} at ${viewport.name}`).toHaveLength(0);
      });
    }
  });
}
