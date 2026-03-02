/**
 * E2E: HGV Inspections Workflow
 *
 * Tests core HGV inspection journeys:
 * - List and new pages load
 * - Existing detail page navigation works when data exists
 * - No console errors on key routes
 * - Human-facing workflow actions are visible
 *
 * Auth: employee storage state.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('HGV Inspections — Page Loading', () => {
  test('hgv-inspections list page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/hgv-inspections');
    await waitForAppReady(page);

    await expect(page.locator('body')).toContainText(/hgv inspection|inspection/i);
    expect(capture.getErrors(), 'No console errors on hgv-inspections list').toHaveLength(0);
  });

  test('hgv-inspections/new page loads without errors', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/hgv-inspections/new');
    await waitForAppReady(page);

    const bodyText = await page.locator('body').innerText();
    const hasFormContent = /inspection|checklist|hgv|save|submit/i.test(bodyText);
    expect(hasFormContent, 'New HGV inspection form should load').toBeTruthy();
    expect(capture.getErrors(), 'No console errors on hgv-inspections/new').toHaveLength(0);
  });
});

test.describe('HGV Inspections — Navigation', () => {
  test('no 404 on /hgv-inspections', async ({ page }) => {
    const response = await page.goto('/hgv-inspections');
    expect(response?.status()).not.toBe(404);
  });

  test('no 404 on /hgv-inspections/new', async ({ page }) => {
    const response = await page.goto('/hgv-inspections/new');
    expect(response?.status()).not.toBe(404);
  });

  test('can open an existing HGV inspection detail page when list has entries', async ({ page }) => {
    await page.goto('/hgv-inspections');
    await waitForAppReady(page);

    const detailLink = page.locator('a[href^="/hgv-inspections/"]:not([href$="/new"])').first();
    const hasDetailLink = (await detailLink.count()) > 0;
    test.skip(!hasDetailLink, 'No HGV inspection records available for this environment');

    await detailLink.click();
    await waitForAppReady(page);
    await expect(page).toHaveURL(/\/hgv-inspections\/.+/, { timeout: 10_000 });
    await expect(page.locator('body')).toContainText(/inspection|defect|submit|draft/i);
  });
});

test.describe('HGV Inspections — Content Verification', () => {
  test('list page keeps HGV naming and avoids old vehicle label', async ({ page }) => {
    await page.goto('/hgv-inspections');
    await waitForAppReady(page);

    const headings = await page.locator('h1, h2, h3').allInnerTexts();
    const vehicleHeadings = headings.filter((heading) => /vehicle\s+inspection/i.test(heading));
    expect(vehicleHeadings).toHaveLength(0);
  });

  test('new inspection page exposes workflow actions for human users', async ({ page }) => {
    await page.goto('/hgv-inspections/new');
    await waitForAppReady(page);

    const actionButton = page.getByRole('button', { name: /save|submit|create|start|complete/i });
    const actionCount = await actionButton.count();

    if (actionCount === 0) {
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      const hasExpectedEmptyState = /(no\s+.*(hgv|inspection|asset))|(select\s+.*(hgv|asset))/.test(bodyText);
      expect(hasExpectedEmptyState).toBeTruthy();
      return;
    }

    expect(actionCount).toBeGreaterThan(0);
  });
});
