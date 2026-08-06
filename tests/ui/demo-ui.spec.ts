import path from 'path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ADMIN_STATE = path.resolve('testsuite/.state/storage-state-admin.json');
const EMPLOYEE_STATE = path.resolve('testsuite/.state/storage-state-employee.json');

const PROTECTED_ROUTES = [
  '/demo',
  '/demo/dashboard',
  '/demo/timesheets',
  '/demo/timesheets/00000000-0000-0000-0000-000000000000',
  '/demo/approvals',
  '/demo/van-inspections/new',
  '/demo/absence',
  '/demo/fleet',
  '/demo/workshop-tasks',
  '/demo/inventory',
  '/demo/quotes',
  '/demo/customers',
  '/demo/profile',
] as const;

interface StyleSnapshot {
  bodyBackground: string;
  bodyImage: string;
  mainPadding: string;
  headingSize: string;
  navBackground: string;
  primary: string;
  demoStorageKeys: string[];
}

async function openAuthenticatedPage(
  context: BrowserContext,
  route: string
): Promise<{ page: Page; errors: string[] }> {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
  return { page, errors };
}

async function getProductionStyleSnapshot(page: Page): Promise<StyleSnapshot> {
  return page.evaluate(() => {
    const accent = document.querySelector('[data-accent]');
    const body = getComputedStyle(document.body);
    const main = getComputedStyle(document.querySelector('main')!);
    const heading = getComputedStyle(document.querySelector('h1')!);
    const nav = getComputedStyle(document.querySelector('nav')!);
    return {
      bodyBackground: body.backgroundColor,
      bodyImage: body.backgroundImage,
      mainPadding: main.padding,
      headingSize: heading.fontSize,
      navBackground: nav.backgroundColor,
      primary: accent ? getComputedStyle(accent).getPropertyValue('--primary').trim() : '',
      demoStorageKeys: Object.keys(localStorage)
        .filter((key) => key.startsWith('demo-ui'))
        .sort(),
    };
  });
}

test.describe('Fresh UI demo', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    test(`T1 protected routes render at ${viewport.name} size`, async ({ browser }) => {
      const context = await browser.newContext({
        storageState: ADMIN_STATE,
        viewport,
        reducedMotion: 'reduce',
      });

      for (const route of PROTECTED_ROUTES) {
        const { page, errors } = await openAuthenticatedPage(context, route);
        expect(errors, `${route} should not emit browser errors`).toEqual([]);
        await expect(page.locator('[data-ui="v2"]')).toHaveCount(1);
        await page.close();
      }

      await context.close();
    });
  }

  test('T1 public login is available and protected routes redirect anonymously', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/demo/login');
    await expect(page.getByRole('heading', { name: 'Work in clear view.' })).toBeVisible();
    await expect(page.getByLabel('Email Address')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

    await page.goto('/demo/approvals');
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await context.close();
  });

  test('T2 demo navigation does not change production styles or storage', async ({ browser }) => {
    const context = await browser.newContext({ storageState: ADMIN_STATE });
    const page = await context.newPage();

    const openTimesheets = async () => {
      await page.goto('/timesheets', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main h1')).toBeVisible({ timeout: 20_000 });
    };

    await openTimesheets();
    const before = await getProductionStyleSnapshot(page);
    await page.goto('/demo/dashboard');
    await expect(page.locator('h1')).toBeVisible({ timeout: 20_000 });
    await openTimesheets();
    const after = await getProductionStyleSnapshot(page);

    expect(after).toEqual(before);
    expect(after).toMatchObject({
      bodyBackground: 'rgb(15, 23, 42)',
      mainPadding: '32px',
      headingSize: '30px',
      navBackground: 'rgba(15, 23, 42, 0.5)',
      primary: '210 90% 50%',
      demoStorageKeys: [],
    });
    await context.close();
  });

  test('T7 denied modules fail closed before sensitive data requests', async ({ browser }) => {
    const context = await browser.newContext({ storageState: EMPLOYEE_STATE });
    const page = await context.newPage();
    const sensitiveRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/(?:quotes|customers)|\/api\/sensitive-access/.test(request.url())) {
        sensitiveRequests.push(request.url());
      }
    });

    await page.goto('/demo/quotes');
    await expect(page.getByText('Module access denied')).toBeVisible({ timeout: 20_000 });
    expect(sensitiveRequests).toEqual([]);
    await context.close();
  });
});
