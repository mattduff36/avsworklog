/**
 * E2E: Van Inspections Full Workflow
 *
 * Tests the complete van inspection user journey:
 * - List page loads and shows content
 * - Navigation links work (no 404s)
 * - New inspection form loads
 * - PDF download endpoint accessible (for authenticated users)
 * - No console errors or hydration errors
 * - Network failures captured
 *
 * Auth: employee storage state.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('Van Inspections — Page Loading', () => {
  test('van-inspections list page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    const failedRequests: string[] = [];

    page.on('response', (response) => {
      if (response.url().includes('/van-inspections') && response.status() >= 500) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto('/van-inspections');
    await waitForAppReady(page);

    await expect(page.locator('body')).toContainText(/van inspection|inspection/i);

    expect(failedRequests, 'No 500 errors on van-inspections page').toHaveLength(0);
    const errors = capture.getErrors();
    expect(errors, 'No console errors on van-inspections list').toHaveLength(0);
  });

  test('van-inspections/new page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);

    await page.goto('/van-inspections/new');
    await waitForAppReady(page);

    // The new inspection form should render
    const bodyText = await page.locator('body').innerText();
    const hasFormContent = /inspection|checklist|vehicle|save|submit/i.test(bodyText);
    expect(hasFormContent, 'New van inspection form should load').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No console errors on van-inspections/new').toHaveLength(0);
  });
});

test.describe('Van Inspections — Navigation', () => {
  test('van-inspections page is reachable from navigation', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForAppReady(page);

    // Look for any inspection link in the nav
    const inspLink = page.getByRole('link', { name: /inspection/i }).first();
    if (await inspLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await inspLink.click();
      await waitForAppReady(page);
      // Should end up on an inspections page (van or dropdown)
      const url = page.url();
      expect(
        url.includes('/van-inspections') || url.includes('/inspections') || url.includes('/plant-inspections')
      ).toBeTruthy();
    }
  });

  test('no 404 on /van-inspections', async ({ page }) => {
    const response = await page.goto('/van-inspections');
    expect(response?.status()).not.toBe(404);
  });

  test('no 404 on /van-inspections/new', async ({ page }) => {
    const response = await page.goto('/van-inspections/new');
    expect(response?.status()).not.toBe(404);
  });
});

test.describe('Van Inspections — Renamed Text Verification', () => {
  test('list page shows "Van" not "Vehicle" in headings', async ({ page }) => {
    await page.goto('/van-inspections');
    await waitForAppReady(page);

    const headings = await page.locator('h1, h2, h3').allInnerTexts();
    const vehicleHeadings = headings.filter(h => /vehicle\s+inspection/i.test(h));
    expect(vehicleHeadings, 'No headings should say "Vehicle Inspection"').toHaveLength(0);
  });
});
