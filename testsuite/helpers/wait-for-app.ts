/**
 * Waits for the SquiresApp to finish its client-side loading/auth check.
 * The app shows "Loading SquiresApp..." while bootstrapping.
 */
import { Page } from '@playwright/test';

export async function waitForAppReady(page: Page, timeout = 15_000): Promise<void> {
  // Wait for the loading indicator to disappear
  const loadingText = page.getByText('Loading SquiresApp...');
  await loadingText.waitFor({ state: 'hidden', timeout }).catch(() => {
    // If it was never visible or already gone, that's fine
  });

  // Also wait for "Checking permissions..." to disappear
  const permCheck = page.getByText('Checking permissions...');
  await permCheck.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}
