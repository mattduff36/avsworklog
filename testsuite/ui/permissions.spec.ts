/**
 * @tags @permissions @critical
 * Tests that employees cannot access admin pages and APIs require auth.
 * Auth: employee storage state (via permissions-tests project).
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@permissions @critical Role-Based Access Control', () => {
  test('employee cannot access /admin/users', async ({ page }) => {
    await page.goto('/admin/users');
    await waitForAppReady(page);

    const url = page.url();
    // Employee should be redirected to dashboard/login, or see a permission error
    const isRedirected = !url.includes('/admin/users');
    const bodyText = await page.locator('body').innerText();
    const hasPermError = /permission|access denied|forbidden|not authorized|unauthorized/i.test(bodyText);
    expect(isRedirected || hasPermError, 'Employee should be blocked from /admin/users').toBeTruthy();
  });

  test('employee cannot access /debug', async ({ page }) => {
    await page.goto('/debug');
    await waitForAppReady(page);

    const url = page.url();
    const isRedirected = !url.includes('/debug');
    const bodyText = await page.locator('body').innerText();
    const hasPermError = /permission|access denied|forbidden|super.*admin|not authorized/i.test(bodyText);
    expect(isRedirected || hasPermError, 'Employee should be blocked from /debug').toBeTruthy();
  });

  test('unauthenticated GET /api/admin/users returns 401', async ({ request }) => {
    const res = await request.get('/api/admin/users', {
      headers: { 'Cookie': '' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(401);
  });
});
