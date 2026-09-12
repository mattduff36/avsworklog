/**
 * DAFP-UI-001
 * @tags @daily-allocation @critical
 * Deterministic manager-board acceptance using browser route mocks.
 * Auth: an existing local admin storage state only passes middleware; no product
 * or persistence API is contacted after the document loads.
 */
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';
import type {
  DailyAllocationConversionSource,
  DailyAllocationConvertInput,
  DailyAllocationLabourAssignInput,
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisitUpsertInput,
} from '../../types/daily-allocation';
import { getAppSessionSigningSecret } from '../../lib/server/app-auth/constants';
import { signJwtHS256 } from '../../lib/server/app-auth/jwt';
import { toDailyAllocationLondonIsoFromMinutes } from '../../lib/utils/daily-allocation-timeline';

config({ path: '.env.local', quiet: true });

const WORK_DATE = '2026-09-13';
const WEEK_DATES = [
  '2026-09-07',
  '2026-09-08',
  '2026-09-09',
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  WORK_DATE,
];
const TEAM_ID = 'team-civils';
const USER_ID = 'manager-acceptance';
const FIXED_NOW = new Date('2026-09-12T12:00:00.000Z');
const BASE_URL = process.env.TESTSUITE_BASE_URL || 'http://localhost:4000';

type MockMode = 'converted' | 'legacy';

test.use({ serviceWorkers: 'block' });

interface MockEvidence {
  conversionRequests: DailyAllocationConvertInput[];
  labourRequests: DailyAllocationLabourAssignInput[];
  publishConfirmations: boolean[];
  visitUpdates: DailyAllocationVisitUpsertInput[];
}

const jobOne = {
  source_type: 'live_quote' as const,
  source_id: 'quote-100',
  job_code: 'JOB-100',
  customer_name: 'Northshore Utilities',
  title: 'Drainage renewal',
  site_address: 'Alpha Site',
  source_href: '/quotes/quote-100',
};

const jobTwo = {
  source_type: 'live_quote' as const,
  source_id: 'quote-200',
  job_code: 'JOB-200',
  customer_name: 'Southbank Estates',
  title: 'Access road',
  site_address: 'Bravo Site',
  source_href: '/quotes/quote-200',
};

function londonIso(minutes: number): string {
  return toDailyAllocationLondonIsoFromMinutes(WORK_DATE, minutes);
}

function availableDay(workDate: string) {
  return {
    work_date: workDate,
    availability: 'available' as const,
    blocking_absence: null,
    pending_absence: null,
    am_working: true,
    pm_working: true,
  };
}

function createBoard(mode: MockMode): DailyAllocationRangeBoardPayload {
  const planDay = {
    id: 'plan-day-1',
    work_date: WORK_DATE,
    team_id: TEAM_ID,
    plan_version: 1,
    converted_at: '2026-09-12T10:00:00.000Z',
    converted_by: USER_ID,
    updated_at: '2026-09-12T10:00:00.000Z',
  };
  const visitOne = {
    id: 'visit-1',
    plan_day_id: planDay.id,
    work_date: WORK_DATE,
    owner_team_id: TEAM_ID,
    job_source_type: jobOne.source_type,
    job_source_id: jobOne.source_id,
    job_code: jobOne.job_code,
    site_address: jobOne.site_address,
    starts_at: londonIso(8 * 60),
    ends_at: londonIso(11 * 60),
    meeting_point: 'Site office',
    meet_person: 'Casey',
    notes: 'Bring permit pack',
    row_version: 1,
    updated_at: '2026-09-12T10:00:00.000Z',
  };
  const visitTwo = {
    id: 'visit-2',
    plan_day_id: planDay.id,
    work_date: WORK_DATE,
    owner_team_id: TEAM_ID,
    job_source_type: jobTwo.source_type,
    job_source_id: jobTwo.source_id,
    job_code: jobTwo.job_code,
    site_address: jobTwo.site_address,
    starts_at: londonIso(13 * 60),
    ends_at: londonIso(15 * 60),
    meeting_point: null,
    meet_person: null,
    notes: null,
    row_version: 1,
    updated_at: '2026-09-12T10:00:00.000Z',
  };
  const legacyLabour = {
    id: 'legacy-labour-1',
    work_date: WORK_DATE,
    profile_id: 'employee-alice',
    job_source_type: jobOne.source_type,
    job_source_id: jobOne.source_id,
    job_code: jobOne.job_code,
    site_address: jobOne.site_address,
    instructions: {
      start_time: 'legacy text must not be used',
      meeting_point: 'Old gate',
      meet_person: 'Old contact',
      notes: 'Legacy labour note',
    },
    row_version: 7,
    updated_at: '2026-09-12T09:00:00.000Z',
  };
  const legacyPlant = {
    id: 'legacy-plant-1',
    work_date: WORK_DATE,
    plant_kind: 'registered' as const,
    plant_id: 'plant-resource-1',
    hired_serial: null,
    hired_description: null,
    hired_company: null,
    owner_team_id: TEAM_ID,
    job_source_type: jobOne.source_type,
    job_source_id: jobOne.source_id,
    job_code: jobOne.job_code,
    site_address: jobOne.site_address,
    notes: 'Legacy plant note',
    row_version: 5,
    updated_at: '2026-09-12T09:00:00.000Z',
  };

  return {
    start_date: WEEK_DATES[0],
    end_date: WEEK_DATES.at(-1)!,
    dates: WEEK_DATES,
    context: {
      user_id: USER_ID,
      access_level: 5,
      is_manager: true,
      is_admin: true,
      team_id: TEAM_ID,
      team_name: 'Civils',
    },
    plan_days: mode === 'converted' ? [planDay] : [],
    visits: mode === 'converted' ? [visitOne, visitTwo] : [],
    labour_assignments: mode === 'converted'
      ? [{
          id: 'labour-1',
          visit_id: visitOne.id,
          plan_day_id: planDay.id,
          work_date: WORK_DATE,
          profile_id: 'employee-alice',
          starts_at: visitOne.starts_at,
          ends_at: visitOne.ends_at,
          meeting_point: 'East gate',
          meet_person: 'Jordan',
          notes: 'Employee-only briefing',
          row_version: 1,
          updated_at: '2026-09-12T10:00:00.000Z',
        }]
      : [],
    plant_assignments: mode === 'converted'
      ? [{
          id: 'plant-assignment-1',
          visit_id: visitOne.id,
          plan_day_id: planDay.id,
          work_date: WORK_DATE,
          plant_kind: 'registered',
          plant_id: 'plant-resource-1',
          hired_serial: null,
          hired_description: null,
          hired_company: null,
          owner_team_id: TEAM_ID,
          starts_at: visitOne.starts_at,
          ends_at: visitOne.ends_at,
          notes: null,
          row_version: 1,
          updated_at: '2026-09-12T10:00:00.000Z',
        }]
      : [],
    overrides: [],
    conflicts: [],
    legacy: {
      labour: mode === 'legacy' ? [legacyLabour] : [],
      plant: mode === 'legacy' ? [legacyPlant] : [],
    },
    jobs: [jobOne, jobTwo],
    resources: {
      employees: [
        {
          profile_id: 'employee-alice',
          full_name: 'Alice Adams',
          employee_id: 'E001',
          team_id: TEAM_ID,
          team_name: 'Civils',
          days: WEEK_DATES.map(availableDay),
        },
        {
          profile_id: 'employee-bob',
          full_name: 'Bob Brown',
          employee_id: 'E002',
          team_id: TEAM_ID,
          team_name: 'Civils',
          days: WEEK_DATES.map(availableDay),
        },
        {
          profile_id: 'employee-charlie',
          full_name: 'Charlie Clark',
          employee_id: 'E003',
          team_id: TEAM_ID,
          team_name: 'Civils',
          days: WEEK_DATES.map(availableDay),
        },
      ],
      plant: [{
        id: 'plant-resource-1',
        plant_id: 'EX-01',
        nickname: 'Blue Digger',
      }],
      teams: [{ id: TEAM_ID, name: 'Civils' }],
    },
    publications: [],
  };
}

function createConversionSource(): DailyAllocationConversionSource {
  return {
    work_date: WORK_DATE,
    team_id: TEAM_ID,
    source_fingerprint: 'acceptance-source-fingerprint',
    labour_drafts: [{
      id: 'legacy-labour-1',
      row_version: 7,
      profile_id: 'employee-alice',
      job_source_type: jobOne.source_type,
      job_source_id: jobOne.source_id,
      job_code: jobOne.job_code,
      site_address: jobOne.site_address,
      meeting_point: 'Old gate',
      meet_person: 'Old contact',
      notes: 'Legacy labour note',
    }],
    plant_drafts: [{
      id: 'legacy-plant-1',
      row_version: 5,
      plant_kind: 'registered',
      plant_id: 'plant-resource-1',
      hired_serial: null,
      hired_description: null,
      hired_company: null,
      owner_team_id: TEAM_ID,
      job_source_type: jobOne.source_type,
      job_source_id: jobOne.source_id,
      job_code: jobOne.job_code,
      site_address: jobOne.site_address,
      notes: 'Legacy plant note',
    }],
  };
}

async function installDailyAllocationMocks(
  page: Page,
  mode: MockMode = 'converted',
): Promise<MockEvidence> {
  let board = createBoard(mode);
  let publishAttempts = 0;
  const evidence: MockEvidence = {
    conversionRequests: [],
    labourRequests: [],
    publishConfirmations: [],
    visitUpdates: [],
  };

  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      json: {
        authenticated: true,
        user: { id: USER_ID, email: 'manager.acceptance@example.test' },
        profile: {
          id: USER_ID,
          email: 'manager.acceptance@example.test',
          first_name: 'Manager',
          last_name: 'Acceptance',
          super_admin: false,
          role: {
            name: 'admin',
            display_name: 'Administrator',
            role_class: 'admin',
            is_manager_admin: true,
            is_super_admin: false,
          },
        },
        data_token_available: false,
      },
    });
  });
  await page.route('**/api/me/permissions', async (route) => {
    await route.fulfill({
      json: {
        permissions: { 'daily-allocation': true },
        permission_levels: { 'daily-allocation': 5 },
        enabled_modules: ['daily-allocation'],
        sensitive_pin_modules: [],
        effective_team_id: TEAM_ID,
        effective_team_name: 'Civils',
      },
    });
  });
  await page.route('**/api/daily-allocation/runtime', async (route) => {
    await route.fulfill({ json: { board_enabled: true, writes_enabled: true } });
  });
  await page.route('**/api/daily-allocation/board?*', async (route) => {
    await route.fulfill({ json: board });
  });
  await page.route('**/api/daily-allocation/convert?*', async (route) => {
    await route.fulfill({ json: createConversionSource() });
  });
  await page.route('**/api/daily-allocation/convert', async (route) => {
    const request = route.request().postDataJSON() as DailyAllocationConvertInput;
    evidence.conversionRequests.push(request);
    const convertedVisit = {
      id: request.visits[0].visit_id,
      plan_day_id: 'converted-plan-day',
      work_date: request.work_date,
      owner_team_id: request.team_id,
      job_source_type: request.visits[0].job_source_type,
      job_source_id: request.visits[0].job_source_id,
      job_code: jobOne.job_code,
      site_address: jobOne.site_address,
      starts_at: request.visits[0].starts_at,
      ends_at: request.visits[0].ends_at,
      meeting_point: request.visits[0].meeting_point ?? null,
      meet_person: request.visits[0].meet_person ?? null,
      notes: request.visits[0].notes ?? null,
      row_version: 1,
      updated_at: '2026-09-12T12:00:00.000Z',
    };
    const labourAssignments = request.labour_drafts
      .filter((draft) => draft.disposition === 'visit' && draft.visit_id === convertedVisit.id)
      .map((draft) => ({
        id: `converted-${draft.draft_id}`,
        visit_id: convertedVisit.id,
        plan_day_id: 'converted-plan-day',
        work_date: request.work_date,
        profile_id: 'employee-alice',
        starts_at: convertedVisit.starts_at,
        ends_at: convertedVisit.ends_at,
        meeting_point: convertedVisit.meeting_point,
        meet_person: convertedVisit.meet_person,
        notes: convertedVisit.notes,
        row_version: 1,
        updated_at: '2026-09-12T12:00:00.000Z',
      }));
    board = {
      ...board,
      plan_days: [{
        id: 'converted-plan-day',
        work_date: request.work_date,
        team_id: request.team_id,
        plan_version: 1,
        converted_at: '2026-09-12T12:00:00.000Z',
        converted_by: USER_ID,
        updated_at: '2026-09-12T12:00:00.000Z',
      }],
      visits: [convertedVisit],
      labour_assignments: labourAssignments,
      plant_assignments: [],
      legacy: { labour: [], plant: [] },
    };
    await route.fulfill({
      json: {
        plan_day_id: 'converted-plan-day',
        plan_version: 1,
        team_id: request.team_id,
        work_date: request.work_date,
        source_fingerprint: request.expected_source_fingerprint,
        visits: [convertedVisit],
        labour_assignments: labourAssignments,
        plant_assignments: [],
      },
    });
  });
  await page.route('**/api/daily-allocation/visits/*', async (route) => {
    const request = route.request().postDataJSON() as DailyAllocationVisitUpsertInput;
    evidence.visitUpdates.push(request);
    const current = board.visits.find((visit) => visit.id === request.visit_id)!;
    const planDay = board.plan_days.find((plan) => plan.id === request.plan_day_id)!;
    const visit = {
      ...current,
      starts_at: request.starts_at,
      ends_at: request.ends_at,
      meeting_point: request.meeting_point ?? null,
      meet_person: request.meet_person ?? null,
      notes: request.notes ?? null,
      row_version: current.row_version + 1,
      updated_at: '2026-09-12T12:00:00.000Z',
    };
    const planVersion = planDay.plan_version + 1;
    board = {
      ...board,
      visits: board.visits.map((item) => item.id === visit.id ? visit : item),
      plan_days: board.plan_days.map((item) => (
        item.id === planDay.id ? { ...item, plan_version: planVersion } : item
      )),
    };
    await route.fulfill({
      json: {
        visit_id: visit.id,
        visit,
        plan_day_id: planDay.id,
        plan_version: planVersion,
      },
    });
  });
  await page.route('**/api/daily-allocation/assignments/labour', async (route) => {
    const request = route.request().postDataJSON() as DailyAllocationLabourAssignInput;
    evidence.labourRequests.push(request);
    const visit = board.visits.find((item) => item.id === request.visit_id)!;
    const planDay = board.plan_days.find((item) => item.id === visit.plan_day_id)!;
    const existing = board.labour_assignments.find((item) => (
      item.visit_id === request.visit_id && item.profile_id === request.profile_id
    ));
    const assignment = {
      id: existing?.id ?? `labour-${request.profile_id}`,
      visit_id: visit.id,
      plan_day_id: visit.plan_day_id,
      work_date: visit.work_date,
      profile_id: request.profile_id,
      starts_at: visit.starts_at,
      ends_at: visit.ends_at,
      meeting_point: request.meeting_point ?? null,
      meet_person: request.meet_person ?? null,
      notes: request.notes ?? null,
      row_version: (existing?.row_version ?? 0) + 1,
      updated_at: '2026-09-12T12:00:00.000Z',
    };
    const planVersion = planDay.plan_version + 1;
    board = {
      ...board,
      labour_assignments: existing
        ? board.labour_assignments.map((item) => item.id === existing.id ? assignment : item)
        : [...board.labour_assignments, assignment],
      plan_days: board.plan_days.map((item) => (
        item.id === planDay.id ? { ...item, plan_version: planVersion } : item
      )),
    };
    await route.fulfill({
      json: {
        assignment_id: assignment.id,
        assignment,
        plan_day_id: planDay.id,
        plan_version: planVersion,
      },
    });
  });
  await page.route('**/api/daily-allocation/publish', async (route) => {
    const request = route.request().postDataJSON() as {
      confirm_unallocated: boolean;
      plan_day_id: string;
      expected_plan_version: number;
    };
    evidence.publishConfirmations.push(request.confirm_unallocated);
    publishAttempts += 1;
    if (publishAttempts === 1) {
      await route.fulfill({
        status: 409,
        json: {
          code: 'CONFIRM_UNALLOCATED_REQUIRED',
          error: 'Some available employees are still unallocated.',
        },
      });
      return;
    }
    board = {
      ...board,
      publications: [{
        id: 'publication-1',
        work_date: WORK_DATE,
        revision_no: 1,
        published_at: '2026-09-12T12:00:00.000Z',
        published_by: USER_ID,
        published_by_name: 'Manager Acceptance',
        scope_team_id: TEAM_ID,
        snapshot_version: 2,
        plan_day_id: request.plan_day_id,
        published_plan_version: request.expected_plan_version,
        confirm_unallocated: request.confirm_unallocated,
      }],
    };
    await route.fulfill({
      json: { publication_id: 'publication-1', snapshot_version: 2 },
    });
  });

  return evidence;
}

async function installLocalMiddlewareSession(page: Page): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const value = await signJwtHS256(
    {
      sid: globalThis.crypto.randomUUID(),
      secret: globalThis.crypto.randomUUID(),
      exp: expires,
      v: 1,
    },
    getAppSessionSigningSecret(),
  );
  await page.context().addCookies([{
    name: 'avs_app_session',
    value,
    url: BASE_URL,
    httpOnly: true,
    sameSite: 'Lax',
    secure: false,
    expires,
  }]);
}

async function openManagerBoard(page: Page, mode: MockMode = 'converted') {
  await page.clock.setFixedTime(FIXED_NOW);
  await installLocalMiddlewareSession(page);
  const evidence = await installDailyAllocationMocks(page, mode);
  await page.goto('/daily-allocation', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  return evidence;
}

async function expectBoardChromeFill(page: Page) {
  const toolbar = page.getByTestId('daily-allocation-toolbar');
  const resources = page.getByTestId('daily-allocation-resources');
  const jobs = page.getByTestId('daily-allocation-jobs-panel');
  const fit = page.getByTestId('daily-allocation-viewport-fit');
  const board = page.getByTestId('daily-allocation-daily-board');

  await expect(toolbar).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily job board', exact: true })).toBeVisible();
  await expect(resources).toBeVisible();
  await expect(jobs).toBeVisible();
  await expect(board).toBeVisible();

  const toolbarBox = await toolbar.boundingBox();
  const resourcesBox = await resources.boundingBox();
  const jobsBox = await jobs.boundingBox();
  const fitBox = await fit.boundingBox();
  const boardBox = await board.boundingBox();
  expect(toolbarBox).toBeTruthy();
  expect(resourcesBox).toBeTruthy();
  expect(jobsBox).toBeTruthy();
  expect(fitBox).toBeTruthy();
  expect(boardBox).toBeTruthy();
  expect(toolbarBox!.height).toBeLessThan(72);
  expect(resourcesBox!.x + resourcesBox!.width).toBeLessThanOrEqual(jobsBox!.x + 8);
  expect(fitBox!.y + fitBox!.height - (boardBox!.y + boardBox!.height)).toBeLessThan(48);
}

test.describe('DAFP-UI-001 Daily Allocation manager board', () => {
  test('desktop keeps the same visits across daily, weekly, and all primary projections', async ({ page }) => {
    await openManagerBoard(page);

    await expect(page.getByRole('heading', { name: 'Daily job board', exact: true })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Allocation date range' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Board primary resource' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Resource type' })).toBeVisible();

    const visitOne = page.getByTestId('daily-allocation-visit-visit-1');
    const visitTwo = page.getByTestId('daily-allocation-visit-visit-2');
    await expect(visitOne).toBeVisible();
    await expect(visitTwo).toBeVisible();

    await page.getByRole('tab', { name: 'Primary Employees' }).click();
    await expect(page.getByRole('heading', { name: 'Daily employee board' })).toBeVisible();
    await expect(visitOne).toBeVisible();
    await expect(visitTwo).toBeVisible();
    await expect(page.getByTestId('daily-allocation-board-row-unassigned')).toContainText(
      'Visits with no employees yet',
    );

    await page.getByRole('tab', { name: 'Primary Plant' }).click();
    await expect(page.getByRole('heading', { name: 'Daily plant board' })).toBeVisible();
    await expect(visitOne).toBeVisible();
    await expect(visitTwo).toBeVisible();
    await expect(page.getByTestId('daily-allocation-board-row-unassigned')).toContainText(
      'Visits with no plant yet',
    );

    await page.getByRole('tab', { name: 'Primary Jobs' }).click();
    await page.getByRole('tab', { name: /^Weekly$/ }).click();
    await expect(page.getByRole('heading', { name: 'Weekly job board' })).toBeVisible();
    await expect(page.getByTestId('daily-allocation-weekly-board')).toBeVisible();
    await expect(visitOne).toBeVisible();
    await expect(visitTwo).toBeVisible();

    await page.getByRole('tab', { name: 'Primary Employees' }).click();
    await expect(page.getByRole('heading', { name: 'Weekly employee board' })).toBeVisible();
    await expect(visitOne).toBeVisible();
    await expect(visitTwo).toBeVisible();
    await expect(page.getByTestId('daily-allocation-board-row-unassigned')).toBeVisible();

    await page.getByRole('tab', { name: 'Primary Plant' }).click();
    await expect(page.getByRole('heading', { name: 'Weekly plant board' })).toBeVisible();
    await expect(visitOne).toBeVisible();
    await expect(visitTwo).toBeVisible();
    await expect(page.getByTestId('daily-allocation-board-row-unassigned')).toBeVisible();
  });

  test('offers fit/scroll controls and resizes a visit by one keyboard grid step', async ({ page }) => {
    const evidence = await openManagerBoard(page);

    const displayMode = page.getByRole('group', { name: 'Daily timeline display mode' });
    const fit = displayMode.getByRole('button', { name: 'Fit timeline to width' });
    const scroll = displayMode.getByRole('button', { name: 'Use scrollable timeline' });
    await expect(fit).toHaveAttribute('aria-pressed', 'true');
    await scroll.click();
    await expect(scroll).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('daily-allocation-daily-board')).toHaveAttribute(
      'data-timeline-layout',
      'scroll',
    );
    await fit.click();
    await expect(fit).toHaveAttribute('aria-pressed', 'true');

    const endHandle = page.getByRole('button', {
      name: /Adjust end of JOB-100, currently 11:00.*30 minute steps/,
    });
    await endHandle.focus();
    await endHandle.press('ArrowRight');
    await expect.poll(() => evidence.visitUpdates.length).toBe(1);
    expect(evidence.visitUpdates[0].starts_at).toBe(londonIso(8 * 60));
    expect(evidence.visitUpdates[0].ends_at).toBe(londonIso(11 * 60 + 30));
    await expect(page.getByTestId('daily-allocation-board-status')).toHaveText(
      'Visit resized to 08:00–11:30.',
    );
  });

  test('supports select-to-assign fallback, employee instruction overrides, and publication confirmation', async ({ page }) => {
    const evidence = await openManagerBoard(page);

    await page.getByRole('tab', { name: /Employees \(3\)/ }).click();
    await page.getByRole('button', { name: /Select Bob Brown\. Drag from the handle to assign\./ }).click();
    await page.getByRole('button', { name: 'Select JOB-200 13:00–15:00' }).click();
    await page.getByRole('button', { name: 'Assign selected resource' }).click();
    await expect.poll(() => evidence.labourRequests.length).toBe(1);
    expect(evidence.labourRequests[0]).toMatchObject({
      visit_id: 'visit-2',
      profile_id: 'employee-bob',
      meeting_point: null,
      meet_person: null,
      notes: null,
    });

    await page.getByRole('button', { name: 'Assign resources to JOB-100' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign resources' });
    await dialog.getByLabel('Employee').selectOption('employee-alice');
    await dialog.getByLabel('Meeting point').fill('Employee gate');
    await dialog.getByLabel('Meet person').fill('Taylor');
    await dialog.getByLabel('Notes').fill('Use the employee-only access route');
    await dialog.getByRole('button', { name: 'Save employee instructions' }).click();
    await expect.poll(() => evidence.labourRequests.length).toBe(2);
    expect(evidence.labourRequests[1]).toMatchObject({
      visit_id: 'visit-1',
      profile_id: 'employee-alice',
      meeting_point: 'Employee gate',
      meet_person: 'Taylor',
      notes: 'Use the employee-only access route',
    });

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const initialConfirmation = page.getByRole('alertdialog', {
      name: `Publish allocation for ${WORK_DATE}?`,
    });
    await initialConfirmation.getByRole('button', { name: 'Publish', exact: true }).click();
    const unallocatedConfirmation = page.getByRole('alertdialog', {
      name: `Publish with unallocated employees for ${WORK_DATE}?`,
    });
    await expect(unallocatedConfirmation).toBeVisible();
    await unallocatedConfirmation.getByRole('button', { name: 'Publish with unallocated' }).click();
    await expect(page.getByText('Allocation published. Employees have been notified.')).toBeVisible();
    expect(evidence.publishConfirmations).toEqual([false, true]);
  });

  test('reviews explicit legacy times and submits a disposition for every source draft', async ({ page }) => {
    const evidence = await openManagerBoard(page, 'legacy');

    await expect(page.getByText('Untimed legacy drafts need review')).toBeVisible();
    await page.getByRole('button', { name: 'Review and convert' }).click();
    const dialog = page.getByRole('dialog', {
      name: `Review legacy allocations for ${WORK_DATE}`,
    });
    await expect(dialog.getByText('Labour drafts (1)')).toBeVisible();
    await expect(dialog.getByText('Plant drafts (1)')).toBeVisible();
    await dialog.getByLabel('Start').fill('07:30');
    await dialog.getByLabel('End').fill('12:00');
    await dialog.getByRole('combobox', { name: 'Disposition for Alice Adams' })
      .selectOption('visit');
    await dialog.getByRole('combobox', { name: 'Disposition for plant-resource-1' })
      .selectOption('unallocated');
    await dialog.getByRole('button', { name: 'Convert reviewed drafts' }).click();

    await expect.poll(() => evidence.conversionRequests.length).toBe(1);
    const request = evidence.conversionRequests[0];
    expect(request.expected_source_fingerprint).toBe('acceptance-source-fingerprint');
    expect(request.request_id).toBeTruthy();
    expect(request.visits).toHaveLength(1);
    expect(request.visits[0]).toMatchObject({
      job_source_type: jobOne.source_type,
      job_source_id: jobOne.source_id,
      starts_at: londonIso(7 * 60 + 30),
      ends_at: londonIso(12 * 60),
    });
    expect(request.labour_drafts).toEqual([{
      draft_id: 'legacy-labour-1',
      row_version: 7,
      disposition: 'visit',
      visit_id: request.visits[0].visit_id,
    }]);
    expect(request.plant_drafts).toEqual([{
      draft_id: 'legacy-plant-1',
      row_version: 5,
      disposition: 'unallocated',
      visit_id: null,
    }]);
    await expect(page.getByText('Legacy drafts converted.')).toBeVisible();
  });
});

test.describe('DAFP-UI-001 touch tablet', () => {
  test.use({
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    isMobile: false,
  });

  test('keeps named controls tappable and supports the assignment fallback', async ({ page }) => {
    const evidence = await openManagerBoard(page);

    await expect(page.getByTestId('daily-allocation-viewport-fit')).toBeVisible();
    await page.getByRole('tab', { name: /Employees \(3\)/ }).tap();
    await page.getByRole('button', { name: /Select Bob Brown\. Drag from the handle to assign\./ }).tap();
    await page.getByRole('button', { name: 'Select JOB-200 13:00–15:00' }).tap();
    const assign = page.getByRole('button', { name: 'Assign selected resource' });
    await expect(assign).toBeVisible();
    await expect(assign).toBeEnabled();
    await assign.tap();
    await expect.poll(() => evidence.labourRequests.length).toBe(1);
    expect(evidence.labourRequests[0].profile_id).toBe('employee-bob');
  });
});

test.describe('DAFP-UI-001 board chrome 1100', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('keeps one title row, a side Resources column, and a viewport-filling board', async ({ page }) => {
    await openManagerBoard(page);
    await expectBoardChromeFill(page);
  });
});

test.describe('DAFP-UI-001 board chrome 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('keeps one title row, a side Resources column, and a viewport-filling board', async ({ page }) => {
    await openManagerBoard(page);
    await expectBoardChromeFill(page);
  });
});

test.describe('DAFP-UI-001 phone gate', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('shows the unsupported manager message instead of editing controls', async ({ page }) => {
    await openManagerBoard(page);

    const unsupported = page.getByTestId('daily-allocation-unsupported-width').filter({ visible: true });
    await expect(unsupported.getByRole('heading', {
      name: 'Use a wider screen to edit allocations',
    })).toBeVisible();
    await expect(unsupported).toContainText('at least 768px wide');
    await expect(unsupported.getByRole('link', { name: 'Open employee allocation view' })).toBeVisible();
    await expect(page.getByTestId('daily-allocation-toolbar')).toBeHidden();
  });
});
