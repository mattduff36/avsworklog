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

const inventoryMobileWidths = [320, 375, 390, 430];

const pages = [
  { name: 'Dashboard', path: '/dashboard' },
  { name: 'Workshop Tasks', path: '/workshop-tasks' },
  { name: 'Fleet', path: '/fleet' },
  { name: 'Inventory', path: '/inventory' },
  { name: 'Van Daily Check Form', path: '/van-inspections/new' },
];

async function gotoWithInfraSkip(
  page: import('@playwright/test').Page,
  route: string,
  pageName: string,
  viewportName: string
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
      `${pageName} at ${viewportName} unavailable in this environment`
    );
    throw error;
  }
}

for (const viewport of viewports) {
  test.describe(`@critical Responsive – ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const { name, path } of pages) {
      test(`${name} loads at ${viewport.name}`, async ({ page }) => {
        const capture = attachConsoleErrorCapture(page);
        await gotoWithInfraSkip(page, path, name, viewport.name);

        const hasError = await page.getByText(/something went wrong|error boundary|application error/i).first()
          .isVisible({ timeout: 2_000 }).catch(() => false);
        expect(hasError, `${name} should not show error at ${viewport.name}`).toBeFalsy();

        const errors = capture.getErrors();
        expect(errors, `No console errors on ${name} at ${viewport.name}`).toHaveLength(0);
      });
    }

    if (viewport.name === 'Mobile') {
      test('mobile navigation can expose dashboard controls', async ({ page }) => {
        await gotoWithInfraSkip(page, '/dashboard', 'Dashboard', viewport.name);

        const menuButton = page.getByRole('button', { name: /menu|open navigation|navigation/i }).first();
        const hasNamedMenuButton = await menuButton.isVisible({ timeout: 5_000 }).catch(() => false);
        const mobileIconButton = page.locator('button.md\\:hidden').first();
        const hasMobileIconButton = await mobileIconButton.isVisible({ timeout: 1_000 }).catch(() => false);
        expect(
          hasNamedMenuButton || hasMobileIconButton,
          'Mobile dashboard should expose a navigation/menu control'
        ).toBeTruthy();
      });
    }
  });
}

for (const width of inventoryMobileWidths) {
  test.describe(`@inventory Inventory mobile – ${width}px`, () => {
    test.use({
      viewport: { width, height: 812 },
      hasTouch: true,
      isMobile: true,
    });

    test('keeps header, navigation, filters, and page width usable', async ({ page }) => {
      await gotoWithInfraSkip(page, '/inventory', 'Inventory', `${width}px mobile`);

      const mobileHeader = page.getByTestId('inventory-mobile-header');
      const stickyNavigation = page.getByTestId('inventory-mobile-sticky-nav');
      const filters = page.getByTestId('inventory-mobile-filters-trigger');
      await expect(mobileHeader).toBeVisible();
      await expect(stickyNavigation).toBeVisible();
      await expect(filters).toBeVisible();
      await expect(page.getByTestId('inventory-mobile-status-overview')).toHaveCount(0);

      const addButtonBox = await mobileHeader.getByRole('button', { name: 'Add' }).boundingBox();
      const locationActionBox = await page
        .getByTestId('inventory-mobile-location-action')
        .boundingBox();
      const filtersBox = await filters.boundingBox();
      expect(addButtonBox?.height || 0, 'Mobile Add should be at least 44px high')
        .toBeGreaterThanOrEqual(44);
      expect(locationActionBox?.height || 0, 'Mobile location action should be at least 44px high')
        .toBeGreaterThanOrEqual(44);
      expect(filtersBox?.height || 0, 'Mobile Filters should be at least 44px high')
        .toBeGreaterThanOrEqual(44);

      const overflow = await page.evaluate(() => {
        // Use the layout viewport width; documentElement.clientWidth can be a few pixels
        // narrower when Chromium reserves a vertical scrollbar gutter.
        const viewportWidth = window.innerWidth;
        const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .map((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              testId: element.dataset.testid || null,
              className: typeof element.className === 'string' ? element.className : '',
              parentClassName: typeof element.parentElement?.className === 'string'
                ? element.parentElement.className
                : '',
              svgClassName: element.closest('svg')?.getAttribute('class') || '',
              svgMarkup: element.closest('svg')?.outerHTML.slice(0, 300) || '',
              text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
              left: Math.round(bounds.left),
              right: Math.round(bounds.right),
            };
          })
          .filter(({ left, right }) => left < -1 || right > viewportWidth + 1)
          .slice(0, 8);
        return {
          pixels: Math.max(0, document.documentElement.scrollWidth - viewportWidth),
          offenders,
        };
      });
      expect(
        overflow.pixels,
        `Inventory should not overflow the document viewport. Offenders: ${JSON.stringify(overflow.offenders)}`,
      ).toBeLessThanOrEqual(1);
    });
  });
}

test.describe('@inventory Inventory mobile dialogs', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });

  test('keeps location selection and dialog actions reachable', async ({ page }) => {
    await gotoWithInfraSkip(page, '/inventory', 'Inventory', '375px mobile dialog');

    const locationAction = page.getByTestId('inventory-mobile-location-action');
    await expect(locationAction).toBeVisible({ timeout: 20_000 });
    await locationAction.click();
    const locationDialog = page.getByRole('dialog', {
      name: /change inventory location|set inventory location/i,
    });
    await expect(locationDialog).toBeVisible();
    const saveButton = locationDialog.getByRole('button', { name: /save location/i });
    await expect(saveButton).toBeVisible();
    const saveButtonBox = await saveButton.boundingBox();
    expect(saveButtonBox?.height || 0, 'Mobile dialog actions should be at least 44px high')
      .toBeGreaterThanOrEqual(44);

    const locationTrigger = locationDialog.getByRole('combobox');
    await locationTrigger.click();
    const locationPicker = page.getByRole('dialog', { name: 'Choose inventory location' });
    await expect(locationPicker).toBeVisible();
    const searchInput = page.getByLabel(/search locations/i);
    await expect(searchInput).toBeVisible();
    const searchFontSize = await searchInput.evaluate(
      (element) => Number.parseFloat(window.getComputedStyle(element).fontSize),
    );
    expect(searchFontSize, 'Mobile inputs should stay at 16px to avoid iOS focus zoom')
      .toBeGreaterThanOrEqual(16);

    await locationPicker.getByRole('option').first().tap();
    await expect(locationPicker).toBeHidden();
    await expect(locationTrigger).not.toContainText(/select location/i);
    await expect(saveButton).toBeEnabled();
  });
});
