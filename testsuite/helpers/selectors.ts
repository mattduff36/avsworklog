/**
 * Shared selectors / locator helpers for the testsuite.
 * Prefer getByRole / getByLabel; fall back to data-testid only when needed.
 */
import { Page } from '@playwright/test';

// ----- Auth / Login -----
export const loginSelectors = {
  emailInput: (page: Page) => page.getByLabel('Email Address'),
  passwordInput: (page: Page) => page.getByLabel('Password'),
  signInButton: (page: Page) => page.getByRole('button', { name: 'Sign In' }),
};

// ----- Navigation -----
export const navSelectors = {
  dashboardLink: (page: Page) => page.getByRole('link', { name: /dashboard/i }),
  workshopTasksLink: (page: Page) => page.getByRole('link', { name: /workshop/i }),
  fleetLink: (page: Page) => page.getByRole('link', { name: /fleet/i }),
  timesheetsLink: (page: Page) => page.getByRole('link', { name: /timesheets/i }),
  inspectionsLink: (page: Page) => page.getByRole('link', { name: /inspections/i }),
  ramsLink: (page: Page) => page.getByRole('link', { name: /rams/i }),
  messagesLink: (page: Page) => page.getByRole('link', { name: /messages/i }),
  adminUsersLink: (page: Page) => page.getByRole('link', { name: /users/i }),
};

// ----- Workshop tasks -----
export const workshopSelectors = {
  newTaskButton: (page: Page) => page.getByRole('button', { name: /new task/i }),
  commentsButton: (page: Page) => page.getByRole('button', { name: /comments/i }).first(),
  categorySelect: (page: Page) => page.getByLabel(/category/i).first(),
  subcategorySelect: (page: Page) => page.getByLabel(/subcategory/i).first(),
};

// ----- Fleet -----
export const fleetSelectors = {
  maintenanceTab: (page: Page) => page.getByRole('tab', { name: /maintenance/i }),
  vehiclesTab: (page: Page) => page.getByRole('tab', { name: /vehicles/i }),
  categoriesTab: (page: Page) => page.getByRole('tab', { name: /categories/i }),
  settingsTab: (page: Page) => page.getByRole('tab', { name: /settings/i }),
};

// ----- Timesheets -----
export const timesheetSelectors = {
  newTimesheetButton: (page: Page) => page.getByRole('link', { name: /new timesheet/i }),
  submitButton: (page: Page) => page.getByRole('button', { name: /submit/i }),
};
