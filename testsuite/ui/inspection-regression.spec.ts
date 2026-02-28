/**
 * E2E: Inspection Refactor Regression Checks
 *
 * Smoke tests for pages that could break due to the inspection table rename:
 * - Dashboard still loads
 * - Fleet page still loads
 * - Workshop tasks still loads
 * - Reports page still loads
 * - No broken routes from inspection rename
 * - No hydration errors
 *
 * Auth: admin storage state.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

const SMOKE_ROUTES = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/fleet', name: 'Fleet' },
  { path: '/workshop-tasks', name: 'Workshop Tasks' },
  { path: '/reports', name: 'Reports' },
  { path: '/actions', name: 'Actions' },
  { path: '/timesheets', name: 'Timesheets' },
];

test.describe('Regression Smoke — Core Pages', () => {
  for (const route of SMOKE_ROUTES) {
    test(`${route.name} page loads without 404 or 500`, async ({ page }) => {
      const capture = attachConsoleErrorCapture(page);
      const response = await page.goto(route.path);

      expect(response?.status(), `${route.name} should not 404`).not.toBe(404);
      expect(response?.status(), `${route.name} should not 500`).not.toBe(500);

      await waitForAppReady(page);

      const errors = capture.getErrors();
      expect(errors, `No console errors on ${route.name}`).toHaveLength(0);
    });
  }
});

test.describe('Regression — Old Inspection Routes', () => {
  test('/inspections redirects or shows content (not 500)', async ({ page }) => {
    const response = await page.goto('/inspections');
    // Old route should either redirect to /van-inspections or 404 (not 500)
    expect(response?.status()).not.toBe(500);
  });
});

test.describe('Regression — No Hydration Errors', () => {
  test('van-inspections has no hydration mismatch', async ({ page }) => {
    const hydrationErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('hydration')) {
        hydrationErrors.push(msg.text());
      }
    });

    await page.goto('/van-inspections');
    await waitForAppReady(page);

    // Wait a bit for any delayed hydration errors
    await page.waitForTimeout(2000);
    expect(hydrationErrors, 'No hydration errors').toHaveLength(0);
  });

  test('plant-inspections has no hydration mismatch', async ({ page }) => {
    const hydrationErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('hydration')) {
        hydrationErrors.push(msg.text());
      }
    });

    await page.goto('/plant-inspections');
    await waitForAppReady(page);

    await page.waitForTimeout(2000);
    expect(hydrationErrors, 'No hydration errors').toHaveLength(0);
  });
});
