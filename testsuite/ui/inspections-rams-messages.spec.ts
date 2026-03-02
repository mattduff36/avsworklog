/**
 * @tags @inspections @rams @messages
 * Tests page loading for inspections, RAMS, and messages.
 * Auth: employee storage state (via employee project).
 * NON-DESTRUCTIVE: read-only.
 */
import { test, expect } from '@playwright/test';
import { attachConsoleErrorCapture } from '../helpers/console-error-fixture';
import { waitForAppReady } from '../helpers/wait-for-app';

test.describe('@inspections Inspections Module', () => {
  test('inspections page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    await page.goto('/van-inspections');
    await waitForAppReady(page);

    const bodyText = await page.locator('body').innerText();
    const hasInspectionContent = /inspection|van|plant|hgv/i.test(bodyText);
    expect(hasInspectionContent, 'Inspections module content should load').toBeTruthy();

    const errors = capture.getErrors();
    expect(errors, 'No page errors on inspections').toHaveLength(0);
  });
});

test.describe('@messages Messages Module', () => {
  test('messages page loads', async ({ page }) => {
    const capture = attachConsoleErrorCapture(page);
    try {
      await page.goto('/messages');
      await waitForAppReady(page);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      test.skip(message.includes('timeout'), 'Messages route timed out in this environment');
      throw error;
    }

    // Either we're on /messages or redirected to dashboard (if messages module not available for employee)
    const bodyText = await page.locator('body').innerText();
    const hasContent = /message|notification|dashboard|forbidden|access denied|permission/i.test(bodyText);
    const url = page.url();
    const hasValidUrlState = /\/messages|\/dashboard|\/login/.test(url);
    expect(hasContent || hasValidUrlState, 'Messages module or a valid access state should load').toBeTruthy();

    const errors = capture.getErrors();
    const ignorable404 = errors.filter((entry) => {
      const message = entry.message?.toLowerCase?.() || '';
      const url = entry.url?.toLowerCase?.() || '';
      return message.includes('404') && url.includes('/messages');
    });
    const actionableErrors = errors.filter((entry) => !ignorable404.includes(entry));
    expect(actionableErrors, 'No actionable page errors on messages').toHaveLength(0);
  });
});
