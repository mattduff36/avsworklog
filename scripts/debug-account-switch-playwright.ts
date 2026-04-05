import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

interface TestUser {
  email: string;
  password: string;
}

interface TestUserMap {
  admin: TestUser;
  employee: TestUser;
}

const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';
const PIN = '1234';

function readTestUsers(): TestUserMap {
  const statePath = path.resolve(process.cwd(), 'testsuite/.state/test-users.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`Missing testsuite user state file at ${statePath}. Run npm run testsuite:setup first.`);
  }

  const raw = fs.readFileSync(statePath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<TestUserMap>;
  if (!parsed.admin?.email || !parsed.admin?.password || !parsed.employee?.email || !parsed.employee?.password) {
    throw new Error('testsuite/.state/test-users.json is missing admin/employee credentials.');
  }

  return {
    admin: parsed.admin,
    employee: parsed.employee,
  };
}

async function login(page: Page, user: TestUser, label: string): Promise<void> {
  console.log(`[step] Login as ${label}`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email Address').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForTimeout(2_000);
  console.log(`[trace] URL after ${label} login submit: ${page.url()}`);
}

async function openPinPopupIfVisible(page: Page): Promise<void> {
  const openPopupButton = page.getByRole('button', { name: /Open PIN popup/i });
  if (await openPopupButton.isVisible().catch(() => false)) {
    await openPopupButton.click();
    await page.waitForTimeout(300);
  }
}

async function enterPin(page: Page, pin: string): Promise<void> {
  for (const digit of pin.split('')) {
    await page.getByRole('button', { name: digit, exact: true }).click();
    await page.waitForTimeout(150);
  }
}

async function configurePinIfPrompted(page: Page): Promise<void> {
  const createPinTitle = page.getByText(/Create your 4-digit PIN/i);
  const confirmPinTitle = page.getByText(/Confirm your 4-digit PIN/i);

  await openPinPopupIfVisible(page);

  if (await createPinTitle.isVisible().catch(() => false)) {
    console.log('[step] Creating PIN on lock page');
    await enterPin(page, PIN);
    await page.waitForTimeout(700);
  }

  if (await confirmPinTitle.isVisible().catch(() => false)) {
    console.log('[step] Confirming PIN on lock page');
    await enterPin(page, PIN);
    await page.waitForTimeout(900);
  }
}

async function goToLockFlow(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/lock?returnTo=%2Fdashboard&setupPin=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_000);
  console.log(`[trace] URL at lock page: ${page.url()}`);
}

async function run(): Promise<void> {
  const users = readTestUsers();
  const browser = await chromium.launch({ headless: false, slowMo: 250 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, users.admin, 'admin');
    await goToLockFlow(page);
    await configurePinIfPrompted(page);

    const signInAnotherUserButton = page.getByRole('button', { name: /Sign in as another user/i });
    await signInAnotherUserButton.click();
    await page.waitForTimeout(1_000);
    console.log(`[trace] URL after "Sign in as another user": ${page.url()}`);

    await login(page, users.employee, 'employee');
    await goToLockFlow(page);
    await configurePinIfPrompted(page);

    const adminTile = page.locator('button').filter({ hasText: users.admin.email }).first();
    if (!(await adminTile.isVisible().catch(() => false))) {
      throw new Error(`Admin tile not visible for ${users.admin.email}`);
    }

    console.log('[step] Selecting admin profile tile and entering PIN');
    await adminTile.click();
    await openPinPopupIfVisible(page);
    await enterPin(page, PIN);

    await page.waitForTimeout(3_000);
    console.log(`[result] Final URL after switch-back attempt: ${page.url()}`);

    await page.screenshot({
      path: path.resolve(process.cwd(), 'playwright-debug-final.png'),
      fullPage: true,
    });

    if (page.url().includes('/login')) {
      throw new Error(`Switch-back flow ended on login page unexpectedly (${page.url()})`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('[fail]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
