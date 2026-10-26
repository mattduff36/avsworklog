import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin@avsworklog.test';
const ADMIN_PASSWORD = 'TestPass123!';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  try {
    await page.waitForURL('**/dashboard', { timeout: 60_000 });
  } catch (error) {
    const alerts = await page.getByRole('alert').allTextContents().catch(() => []);
    throw new Error(`Login did not reach the dashboard (${page.url()}). ${alerts.join(' ')}`.trim(), { cause: error });
  }
}

async function mockReportApis(page: Page, posts: string[]) {
  await page.route('**/api/reports/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.includes('/api/reports/suggestions')) {
      if (method !== 'GET') posts.push(method);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suggestions: method === 'POST'
            ? [{ id: 's1', title: 'Team trend', body: 'Monthly absence', created_at: '2026-10-01T00:00:00.000Z', user: { full_name: 'Test User' } }]
            : [],
        }),
      });
      return;
    }
    if (url.includes('/api/reports/timesheets/job-labour')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          filters: { dateFrom: '2026-06-01', dateTo: '2026-06-07', hoursPerDay: 8, jobCodes: [] },
          summary: [{ jobCode: '40065-GH', allocatedHours: 8, manDays: 1, entryCount: 1 }],
          detail: [],
          totals: { allocatedHours: 8, manDays: 1, entryCount: 1 },
          unmatchedJobCodes: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Buffer.from('excel'),
    });
  });
}

test.describe('Reports catalogue', () => {
  test.describe.configure({ timeout: 90_000 });
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('groups every module and keeps old report links', async ({ page }) => {
    const posts: string[] = [];
    await mockReportApis(page, posts);
    await page.goto('/reports');
    for (const heading of ['Timesheets', 'Daily Allocation', 'Daily Checks', 'Absence & Leave']) {
      await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Quotes', level: 2 })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Plant Usage/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Job Labour/ })).toBeVisible();
    await expect(page.getByText('not the live Daily Allocation board')).toBeVisible();
    await expect(page.getByText('Quotes Conversion Funnel')).toHaveCount(0);
    await expect(page.getByText('More Reports')).toHaveCount(0);
    await expect(page.getByText('No settings for this module yet.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Download Excel for/ })).toHaveCount(0);

    await page.goto('/reports?reportTab=quotes');
    await expect(page.getByRole('heading', { name: 'Timesheets', level: 2 })).toBeVisible();
    await expect(page.getByText('Quotes Conversion Funnel')).toHaveCount(0);

    await page.goto('/reports?reportTab=timesheets');
    await expect(page.getByRole('button', { name: /Payroll Export/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Plant Usage/ })).toHaveCount(0);

    await page.goto('/reports?reportTab=inspections');
    await expect(page.getByRole('button', { name: /Daily Checks Defects Log/ })).toBeVisible();

    await page.goto('/reports?reportTab=future');
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Payroll Export/ })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
    expect(posts).toEqual([]);

    await page.goto('/reports?tab=settings');
    await expect(page.getByRole('button', { name: /Weekly Timesheet Summary/ })).toBeVisible();
    await expect(page.getByText('No settings for this module yet.')).toHaveCount(0);
  });

  test('search with no results, date validation, and download wiring', async ({ page }) => {
    const posts: string[] = [];
    await mockReportApis(page, posts);
    await page.goto('/reports');
    await page.getByLabel('Search reports').fill('no-such-report');
    await expect(page.getByText('No reports match this search.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByRole('button', { name: /Payroll Export/ })).toBeVisible();

    await page.getByRole('button', { name: /Payroll Export/ }).click();
    await page.getByLabel('From').fill('2026-10-10');
    await page.getByLabel('To').fill('2026-10-01');
    await expect(page.getByRole('alert')).toHaveText('The end date must be on or after the start date.');
    await expect(page.getByRole('button', { name: 'Download Excel for Payroll Export' })).toBeDisabled();

    await page.getByLabel('From').fill('');
    await expect(page.getByRole('alert')).toHaveText('Choose both a start date and an end date.');

    await page.getByRole('button', { name: 'Last Week' }).click();
    const payroll = page.getByRole('button', { name: 'Download Excel for Payroll Export' });
    const [payrollRequest] = await Promise.all([
      page.waitForRequest((request) => request.url().includes('/api/reports/timesheets/payroll') && request.method() === 'GET'),
      payroll.click(),
    ]);
    expect(payrollRequest.url()).toContain('dateFrom=');
    expect(payrollRequest.url()).toContain('dateTo=');

    await page.getByRole('button', { name: /Job Labour/ }).click();
    const [preview] = await Promise.all([
      page.waitForRequest((request) => request.url().includes('/api/reports/timesheets/job-labour') && request.url().includes('format=json')),
      page.getByRole('button', { name: 'Generate report' }).click(),
    ]);
    expect(preview.url()).toContain('hoursPerDay=8');
    await expect(page.getByRole('table', { name: 'Job labour summary' })).toBeVisible();
  });

  test('selected download uses brand yellow with dark text', async ({ page }) => {
    await page.goto('/reports');
    const accent = page.locator('[data-accent]');
    await expect(accent).toHaveAttribute('data-accent', 'brand');
    await page.getByRole('button', { name: /Weekly Timesheet Summary/ }).click();
    const button = page.getByRole('button', { name: 'Download Excel for Weekly Timesheet Summary' });
    await expect(button).toHaveCSS('background-color', 'rgb(241, 214, 74)');
    await expect(button).toHaveCSS('color', 'rgb(2, 6, 23)');
  });

  test('mobile catalogue does not overflow the page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/reports');
    await expect(page.getByRole('button', { name: /Weekly Timesheet Summary/ })).toBeVisible();
    await page.getByRole('button', { name: /Weekly Timesheet Summary/ }).click();
    await expect(page.getByLabel('From')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
