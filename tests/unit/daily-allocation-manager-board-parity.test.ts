import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDailyAllocationBoardRows,
} from '@/components/daily-allocation/board/daily-allocation-board-primary';
import {
  buildDailyAllocationConversionRequest,
  createDailyAllocationConversionReview,
} from '@/components/daily-allocation/board/daily-allocation-conversion';
import {
  buildDailyAllocationEmployeeOccupancy,
} from '@/components/daily-allocation/board/daily-allocation-occupancy';
import {
  getDailyAllocationElementVisualScale,
  getDailyAllocationRemainingViewportHeight,
  getDailyAllocationViewportFit,
} from '@/components/daily-allocation/board/daily-allocation-viewport-fit';
import {
  getDailyAllocationPrimaryStorageKey,
  readDailyAllocationPrimaryPreference,
  writeDailyAllocationPrimaryPreference,
} from '@/lib/config/daily-allocation-primary-preference';
import type {
  DailyAllocationConversionSource,
  DailyAllocationRangeBoardPayload,
} from '@/types/daily-allocation';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function board(): DailyAllocationRangeBoardPayload {
  const visit = {
    id: 'visit-1',
    plan_day_id: 'plan-1',
    work_date: '2026-08-14',
    owner_team_id: 'team-1',
    job_source_type: 'live_quote' as const,
    job_source_id: 'job-1',
    job_code: 'JOB-100',
    site_address: 'Site',
    starts_at: '2026-08-14T07:00:00.000Z',
    ends_at: '2026-08-14T10:00:00.000Z',
    meeting_point: 'Yard',
    meet_person: 'Sam',
    notes: null,
    row_version: 1,
    updated_at: '2026-08-13T10:00:00.000Z',
  };
  const openVisit = { ...visit, id: 'visit-open', job_source_id: 'job-2', job_code: 'JOB-200' };
  return {
    start_date: '2026-08-14',
    end_date: '2026-08-14',
    dates: ['2026-08-14'],
    context: {
      user_id: 'manager-1',
      access_level: 5,
      is_manager: true,
      is_admin: true,
      team_id: 'team-1',
      team_name: 'Team One',
    },
    plan_days: [{
      id: 'plan-1',
      work_date: '2026-08-14',
      team_id: 'team-1',
      plan_version: 2,
      converted_at: '2026-08-13T10:00:00.000Z',
      converted_by: 'manager-1',
      updated_at: '2026-08-13T10:00:00.000Z',
    }],
    visits: [visit, openVisit],
    labour_assignments: [{
      id: 'labour-1',
      visit_id: visit.id,
      plan_day_id: 'plan-1',
      work_date: visit.work_date,
      profile_id: 'employee-1',
      starts_at: visit.starts_at,
      ends_at: visit.ends_at,
      meeting_point: 'Gate',
      meet_person: 'Lee',
      notes: 'Bring PPE',
      row_version: 3,
      updated_at: '2026-08-13T10:00:00.000Z',
    }],
    plant_assignments: [{
      id: 'plant-assignment-1',
      visit_id: visit.id,
      plan_day_id: 'plan-1',
      work_date: visit.work_date,
      plant_kind: 'registered',
      plant_id: 'plant-1',
      hired_serial: null,
      hired_description: null,
      hired_company: null,
      owner_team_id: 'team-1',
      starts_at: visit.starts_at,
      ends_at: visit.ends_at,
      notes: null,
      row_version: 1,
      updated_at: '2026-08-13T10:00:00.000Z',
    }],
    overrides: [],
    conflicts: [],
    legacy: { labour: [], plant: [] },
    jobs: [
      {
        source_type: 'live_quote',
        source_id: 'job-1',
        job_code: 'JOB-100',
        customer_name: 'Customer',
        title: 'First job',
        site_address: 'Site',
        source_href: '/quotes/job-1',
      },
      {
        source_type: 'live_quote',
        source_id: 'job-2',
        job_code: 'JOB-200',
        customer_name: 'Customer',
        title: 'Open job',
        site_address: 'Site',
        source_href: '/quotes/job-2',
      },
    ],
    resources: {
      employees: [
        {
          profile_id: 'employee-1',
          full_name: 'Alex Worker',
          employee_id: 'E001',
          team_id: 'team-1',
          team_name: 'Team One',
          days: [{
            work_date: '2026-08-14',
            availability: 'available',
            blocking_absence: null,
            pending_absence: null,
            am_working: true,
            pm_working: false,
          }],
        },
        {
          profile_id: 'employee-2',
          full_name: 'Beth Available',
          employee_id: 'E002',
          team_id: 'team-1',
          team_name: 'Team One',
          days: [],
        },
      ],
      plant: [
        { id: 'plant-1', plant_id: 'EX-01', nickname: 'Digger' },
        { id: 'plant-2', plant_id: 'RL-02', nickname: 'Roller' },
      ],
      teams: [{ id: 'team-1', name: 'Team One' }],
    },
    publications: [],
  };
}

describe('manager board parity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('DAFP-UI-001 projects the same visits over jobs, employees, plant and unassigned rows', () => {
    const input = board();
    const employeeRows = buildDailyAllocationBoardRows({
      primary: 'employee',
      board: input,
      dates: input.dates,
    });
    expect(employeeRows.map((row) => row.id)).toEqual([
      'employee:employee-1',
      'employee:employee-2',
      'unassigned',
    ]);
    expect(employeeRows[0].visits.map((visit) => visit.id)).toEqual(['visit-1']);
    expect(employeeRows[1].visits).toEqual([]);
    expect(employeeRows[2].visits.map((visit) => visit.id)).toEqual(['visit-open']);

    const plantRows = buildDailyAllocationBoardRows({
      primary: 'plant',
      board: input,
      dates: input.dates,
    });
    expect(plantRows.map((row) => row.id)).toEqual([
      'plant:registered:plant-1',
      'plant:registered:plant-2',
      'unassigned',
    ]);
    expect(plantRows[1].visits).toEqual([]);
    expect(buildDailyAllocationBoardRows({
      primary: 'job',
      board: input,
      dates: input.dates,
      jobSearch: 'JOB-200',
    }).flatMap((row) => row.visits.map((visit) => visit.id))).toEqual(['visit-open']);
  });

  it('persists an AVS-versioned primary preference and guards the phone floor', () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', storage);
    writeDailyAllocationPrimaryPreference('manager-1', 'employee');
    expect(storage.getItem(getDailyAllocationPrimaryStorageKey('manager-1'))).toBe('employee');
    expect(readDailyAllocationPrimaryPreference('manager-1')).toBe('employee');
    expect(getDailyAllocationViewportFit({
      availableWidth: 1200,
      minContentWidth: 1180,
      isMobile: false,
    })).toEqual({ mode: 'full', scale: 1 });
    expect(getDailyAllocationViewportFit({
      availableWidth: 767,
      minContentWidth: 1180,
      isMobile: true,
    })).toEqual({ mode: 'blocked', scale: 0 });
    expect(getDailyAllocationViewportFit({
      availableWidth: 656,
      minContentWidth: 1180,
      isMobile: false,
      isCoarsePointer: true,
    })).toEqual({ mode: 'full', scale: 1 });
    expect(getDailyAllocationElementVisualScale({
      offsetWidth: 1000,
      getBoundingClientRect: () => ({ width: 700 }),
    } as HTMLElement)).toBe(0.7);
    expect(getDailyAllocationRemainingViewportHeight({
      top: 96,
      viewportHeight: 900,
      bottomInset: 8,
    })).toBe(796);
  });

  it('paints booked time over off-shift occupancy', () => {
    const input = board();
    const segments = buildDailyAllocationEmployeeOccupancy({
      day: input.resources.employees[0].days[0],
      assignments: input.labour_assignments,
    });
    expect(segments).toContainEqual({ startMinutes: 8 * 60, endMinutes: 11 * 60, state: 'booked' });
    expect(segments.some((segment) => segment.state === 'unavailable' && segment.startMinutes === 12 * 60)).toBe(true);
  });
});

describe('guided legacy conversion and instruction inputs', () => {
  it('builds an exhaustive fingerprint-bound conversion without legacy time inference', () => {
    const source: DailyAllocationConversionSource = {
      work_date: '2026-08-14',
      team_id: 'team-1',
      source_fingerprint: 'a'.repeat(64),
      labour_drafts: [{
        id: 'labour-draft-1',
        row_version: 4,
        profile_id: 'employee-1',
        job_source_type: 'live_quote',
        job_source_id: 'job-1',
        job_code: 'JOB-100',
        site_address: 'Site',
        meeting_point: 'Yard',
        meet_person: 'Sam',
        notes: 'Legacy note',
      }],
      plant_drafts: [{
        id: 'plant-draft-1',
        row_version: 2,
        plant_kind: 'registered',
        plant_id: 'plant-1',
        hired_serial: null,
        hired_description: null,
        hired_company: null,
        owner_team_id: 'team-1',
        job_source_type: 'live_quote',
        job_source_id: 'job-1',
        job_code: 'JOB-100',
        site_address: 'Site',
        notes: null,
      }],
    };
    const review = createDailyAllocationConversionReview(
      source,
      () => '11111111-1111-4111-8111-111111111111'
    );
    expect(() => buildDailyAllocationConversionRequest({ source, review }))
      .toThrow('Choose a disposition');
    review.labour['labour-draft-1'] = {
      disposition: 'visit',
      visitKey: review.visits[0].key,
    };
    review.plant['plant-draft-1'] = {
      disposition: 'visit',
      visitKey: review.visits[0].key,
    };
    expect(() => buildDailyAllocationConversionRequest({ source, review }))
      .toThrow('Choose valid times');
    review.visits[0].startTime = '07:30';
    review.visits[0].endTime = '10:30';
    const request = buildDailyAllocationConversionRequest({ source, review });
    expect(request.expected_source_fingerprint).toBe(source.source_fingerprint);
    expect(request.labour_drafts).toEqual([{
      draft_id: 'labour-draft-1',
      row_version: 4,
      disposition: 'visit',
      visit_id: '11111111-1111-4111-8111-111111111111',
    }]);
    expect(request.plant_drafts).toHaveLength(1);
    expect(request.visits[0]).toMatchObject({
      visit_id: '11111111-1111-4111-8111-111111111111',
      job_source_id: 'job-1',
      meeting_point: 'Yard',
    });
    expect(JSON.stringify(request)).not.toContain('start_time');
  });
});
