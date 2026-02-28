/**
 * E2E: Plant Inspections Full Workflow
 *
 * Tests the complete plant inspection user journey:
 * - List page loads and shows content
 * - Navigation links work (no 404s)
 * - New inspection form loads
 * - No console errors or hydration errors
 * - Network failures captured
 *
 * Auth: employee storage state.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('Plant Inspections — Page Loading', () => {
  test('plant-inspections list page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    const failedRequests: string[] = [];

    page.on('response', (response) => {
      if (response.url().includes('/plant-inspections') && response.status() >= 500) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto('/plant-inspections');
    await waitForAppReady(page);

    await expect(page.locator('body')).toContainText(/plant inspection|inspection/i);

    expect(failedRequests, 'No 500 errors on plant-inspections page').toHaveLength(0);
    const errors = capture.getErrors();
    expect(errors, 'No console errors on plant-inspections list').toHaveLength(0);
  });

  test('plant-inspections/new page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);

    await page.goto('/plant-inspections/new');
    await waitForAppReady(page);

    const bodyText = await page.locator('body').innerText();
    const hasFormContent = /inspection|checklist|plant|save|submit/i.test(bodyText);
    expect(hasFormContent, 'New plant inspection form should load').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No console errors on plant-inspections/new').toHaveLength(0);
  });
});

test.describe('Plant Inspections — Navigation', () => {
  test('no 404 on /plant-inspections', async ({ page }) => {
    const response = await page.goto('/plant-inspections');
    expect(response?.status()).not.toBe(404);
  });

  test('no 404 on /plant-inspections/new', async ({ page }) => {
    const response = await page.goto('/plant-inspections/new');
    expect(response?.status()).not.toBe(404);
  });
});

test.describe('Plant Inspections — Content Verification', () => {
  test('list page shows "Plant" in content', async ({ page }) => {
    await page.goto('/plant-inspections');
    await waitForAppReady(page);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.toLowerCase()).toContain('plant');
  });

  test('no "Vehicle Inspection" text in headings', async ({ page }) => {
    await page.goto('/plant-inspections');
    await waitForAppReady(page);

    const headings = await page.locator('h1, h2, h3').allInnerTexts();
    const vehicleHeadings = headings.filter(h => /vehicle\s+inspection/i.test(h));
    expect(vehicleHeadings, 'No headings should say "Vehicle Inspection"').toHaveLength(0);
  });
});
