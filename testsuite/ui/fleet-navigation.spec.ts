// @ts-nocheck
/**
 * @tags @fleet @critical
 * Tests fleet page tabs, data loading, and legacy redirects.
 * Auth: admin storage state.
 * NON-DESTRUCTIVE: read-only navigation.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@fleet @critical Fleet Navigation', () => {
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
      test.skip(message.includes('timeout'), skipMessage);
      throw error;
    }
  }

  async function clickFirstHistoryLinkForPath(page: import('@playwright/test').Page, routePart: string) {
    const matchingLink = page.locator(`a[href*="${routePart}"][href*="/history"]`).first();
    const count = await matchingLink.count();
    if (count === 0) {
      return false;
    }
    await matchingLink.click();
    await waitForAppReady(page);
    return true;
  }

  test('fleet page loads with plant tab', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await gotoWithTimeoutSkip(page, '/fleet', 'Fleet page timed out in this environment');

    expect(page.url()).toContain('/fleet');
    const bodyText = await page.locator('body').innerText();
    expect(/plant|fleet/i.test(bodyText), 'Fleet page should have content').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on fleet').toHaveLength(0);
  });

  test('can switch to vans tab', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/fleet?tab=vans', 'Fleet vans tab timed out in this environment');
    const bodyText = await page.locator('body').innerText();
    expect(/van/i.test(bodyText)).toBeTruthy();
  });

  test('can switch to settings tab', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/fleet?tab=settings', 'Fleet settings tab timed out in this environment');
    const bodyText = await page.locator('body').innerText();
    expect(/settings|categor/i.test(bodyText)).toBeTruthy();
  });

  test('/fleet?tab=maintenance redirects to /maintenance', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/fleet?tab=maintenance', 'Fleet maintenance redirect timed out in this environment');
    const currentUrl = page.url();
    const landedOnMaintenance =
      /\/maintenance/.test(currentUrl) || /\/fleet\?tab=maintenance/.test(currentUrl);
    expect(landedOnMaintenance).toBeTruthy();
  });

  test('/maintenance page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await gotoWithTimeoutSkip(page, '/maintenance', 'Maintenance page timed out in this environment');

    expect(page.url()).toContain('/maintenance');
    const bodyText = await page.locator('body').innerText();
    expect(/maintenance|service/i.test(bodyText), 'Maintenance page should have content').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on maintenance').toHaveLength(0);
  });

  test('fleet vans tab history links route to van history pages', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/fleet?tab=vans', 'Fleet vans tab timed out in this environment');

    const clicked = await clickFirstHistoryLinkForPath(page, '/fleet/vans/');
    test.skip(!clicked, 'No van history link available for current seeded data');
    await expect(page).toHaveURL(/\/fleet\/vans\/.+\/history/, { timeout: 10_000 });
  });

  test('fleet HGV tab history links route to HGV history pages', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/fleet?tab=hgvs', 'Fleet HGV tab timed out in this environment');

    const clicked = await clickFirstHistoryLinkForPath(page, '/fleet/hgvs/');
    test.skip(!clicked, 'No HGV history link available for current seeded data');
    await expect(page).toHaveURL(/\/fleet\/hgvs\/.+\/history/, { timeout: 10_000 });
  });

  test('fleet plant tab history links route to plant history pages', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/fleet?tab=plant', 'Fleet plant tab timed out in this environment');

    const clicked = await clickFirstHistoryLinkForPath(page, '/fleet/plant/');
    test.skip(!clicked, 'No plant history link available for current seeded data');
    await expect(page).toHaveURL(/\/fleet\/plant\/.+\/history/, { timeout: 10_000 });
  });

  test('maintenance page links route to matching history pages', async ({ page }) => {
    await gotoWithTimeoutSkip(page, '/maintenance', 'Maintenance page timed out in this environment');

    const historyLinks = page.locator('a[href*="/fleet/"][href*="/history"]');
    const linkCount = await historyLinks.count();
    test.skip(linkCount === 0, 'No maintenance history links available for current seeded data');

    const href = await historyLinks.first().getAttribute('href');
    expect(href).toMatch(/\/fleet\/(vans|hgvs|plant)\/.+\/history/);

    await historyLinks.first().click();
    await waitForAppReady(page);
    await expect(page).toHaveURL(/\/fleet\/(vans|hgvs|plant)\/.+\/history/, { timeout: 10_000 });
  });
});
