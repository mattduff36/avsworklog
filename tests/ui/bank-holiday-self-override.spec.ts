import { expect, test, type Page } from '@playwright/test';

function harnessUrl(scenario: string): string {
  const token = process.env.AVS_BANK_HOLIDAY_E2E_TOKEN;
  if (!token) throw new Error('AVS_BANK_HOLIDAY_E2E_TOKEN is required');
  return `/pwa-debug/bank-holiday-e2e?scenario=${encodeURIComponent(scenario)}&token=${encodeURIComponent(token)}`;
}

async function openHarness(page: Page, scenario: string): Promise<void> {
  await page.goto(harnessUrl(scenario));
  await expect(page.getByTestId('scenario')).toHaveText(scenario);
}

test('BH-E2E-01: eligible approved bank holiday exposes self-confirm flow', async ({ page }) => {
  await openHarness(page, 'eligible');
  await expect(page.getByLabel('Monday hours')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save Draft' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByRole('dialog')).toContainText('Confirm bank holiday hours');
});

test('BH-E2E-02: wrong confirmation phrase is rejected', async ({ page }) => {
  await openHarness(page, 'eligible');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await page.getByLabel('Type BANK HOLIDAY').fill('not correct');
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await expect(page.getByTestId('result')).toHaveText('checking');
});

test('BH-E2E-03: BANK HOLIDAY succeeds case-insensitively', async ({ page }) => {
  await openHarness(page, 'eligible');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await page.getByLabel('Type BANK HOLIDAY').fill('bank holiday');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByTestId('result')).toHaveText('draft-complete');
});

test('BH-E2E-04: ordinary annual leave remains locked', async ({ page }) => {
  await openHarness(page, 'ordinary');
  await expect(page.getByLabel('Monday hours')).toBeDisabled();
});

test('BH-E2E-05: trial OFF restores the legacy manager override path', async ({ page }) => {
  await openHarness(page, 'legacy-off');
  await expect(page.getByLabel('Monday hours')).toBeEnabled();
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByTestId('result')).toHaveText('draft-complete');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('BH-E2E-06: unresolved or failed trial, leave, and confirmation reads block actions', async ({
  page,
}) => {
  for (const scenario of ['trial-loading', 'leave-loading', 'confirmation-loading']) {
    await openHarness(page, scenario);
    await expect(page.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
  }

  for (const scenario of ['trial-fail', 'leave-fail', 'confirmation-fail']) {
    await openHarness(page, scenario);
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
  }
});
