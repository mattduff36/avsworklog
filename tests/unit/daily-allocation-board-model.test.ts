import { describe, expect, it } from 'vitest';
import {
  evaluateEmployeeAssignmentBlock,
  filterDailyAllocationBoardForTeam,
  planDayForDate,
  resolveDailyAllocationActiveTeamId,
  visitOverlapsHalfDaySession,
} from '@/components/daily-allocation/board/board-model';
import { toDailyAllocationLondonIsoFromMinutes } from '@/lib/utils/daily-allocation-timeline';
import type {
  DailyAllocationAbsenceSnapshot,
  DailyAllocationEmployeeResource,
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisit,
} from '@/types/daily-allocation';

function absence(session: 'AM' | 'PM' | null): DailyAllocationAbsenceSnapshot {
  return {
    absence_id: 'absence-1',
    reason_id: 'reason-1',
    reason_name: 'Medical',
    colour: null,
    is_paid: true,
    is_half_day: session != null,
    half_day_session: session,
    status: 'approved',
    allocation_behaviour: 'block',
  };
}

function boardFixture(): DailyAllocationRangeBoardPayload {
  return {
    start_date: '2026-08-14',
    end_date: '2026-08-14',
    dates: ['2026-08-14'],
    context: {
      user_id: 'user-1',
      access_level: 5,
      is_manager: true,
      is_admin: true,
      team_id: 'team-1',
      team_name: 'Team One',
    },
    plan_days: [
      {
        id: 'plan-team-1',
        work_date: '2026-08-14',
        team_id: 'team-1',
        plan_version: 3,
        converted_at: '2026-08-13T08:00:00.000Z',
        converted_by: 'user-1',
        updated_at: '2026-08-13T08:00:00.000Z',
      },
      {
        id: 'plan-team-2',
        work_date: '2026-08-14',
        team_id: 'team-2',
        plan_version: 7,
        converted_at: '2026-08-13T08:00:00.000Z',
        converted_by: 'user-1',
        updated_at: '2026-08-13T08:00:00.000Z',
      },
    ],
    visits: [
      visit('visit-1', 'plan-team-1', 'team-1', 'JOB-100', 8 * 60, 11 * 60),
      visit('visit-2', 'plan-team-2', 'team-2', 'JOB-200', 8 * 60, 11 * 60),
    ],
    labour_assignments: [{
      id: 'labour-2',
      visit_id: 'visit-2',
      plan_day_id: 'plan-team-2',
      work_date: '2026-08-14',
      profile_id: 'employee-2',
      starts_at: toDailyAllocationLondonIsoFromMinutes('2026-08-14', 8 * 60),
      ends_at: toDailyAllocationLondonIsoFromMinutes('2026-08-14', 11 * 60),
      meeting_point: null,
      meet_person: null,
      notes: null,
      row_version: 1,
      updated_at: '2026-08-13T08:00:00.000Z',
    }],
    plant_assignments: [],
    overrides: [],
    conflicts: [{
      code: 'employee_overlap',
      severity: 'hard',
      work_date: '2026-08-14',
      visit_id: 'visit-2',
      profile_id: 'employee-2',
      plant_assignment_id: null,
      override_id: null,
      message: 'Team two overlap',
    }],
    legacy: {
      labour: [{
        id: 'draft-2',
        work_date: '2026-08-14',
        profile_id: 'employee-2',
        job_source_type: 'live_quote',
        job_source_id: 'quote-2',
        job_code: 'JOB-200',
        site_address: '2 Test Street',
        instructions: {
          start_time: '08:00',
          meeting_point: null,
          meet_person: null,
          notes: null,
        },
        row_version: 1,
        updated_at: '2026-08-13T08:00:00.000Z',
      }],
      plant: [{
        id: 'plant-draft-2',
        work_date: '2026-08-14',
        plant_kind: 'registered',
        plant_id: 'plant-2',
        hired_serial: null,
        hired_description: null,
        hired_company: null,
        owner_team_id: 'team-2',
        job_source_type: 'live_quote',
        job_source_id: 'quote-2',
        job_code: 'JOB-200',
        site_address: '2 Test Street',
        notes: null,
        row_version: 1,
        updated_at: '2026-08-13T08:00:00.000Z',
      }],
    },
    jobs: [],
    resources: {
      employees: [employee('employee-1', 'team-1', 'Team One'), employee('employee-2', 'team-2', 'Team Two')],
      plant: [],
      teams: [
        { id: 'team-1', name: 'Team One' },
        { id: 'team-2', name: 'Team Two' },
      ],
    },
    publications: [{
      id: 'publication-2',
      work_date: '2026-08-14',
      revision_no: 1,
      published_at: '2026-08-13T08:00:00.000Z',
      published_by: 'user-1',
      published_by_name: 'Manager',
      scope_team_id: 'team-2',
      snapshot_version: 2,
      plan_day_id: 'plan-team-2',
      published_plan_version: 6,
      confirm_unallocated: false,
    }],
  };
}

function visit(
  id: string,
  planDayId: string,
  teamId: string,
  jobCode: string,
  startMinutes: number,
  endMinutes: number
): DailyAllocationVisit {
  return {
    id,
    plan_day_id: planDayId,
    work_date: '2026-08-14',
    owner_team_id: teamId,
    job_source_type: 'live_quote',
    job_source_id: jobCode,
    job_code: jobCode,
    site_address: 'Site',
    starts_at: toDailyAllocationLondonIsoFromMinutes('2026-08-14', startMinutes),
    ends_at: toDailyAllocationLondonIsoFromMinutes('2026-08-14', endMinutes),
    meeting_point: null,
    meet_person: null,
    notes: null,
    row_version: 1,
    updated_at: '2026-08-13T08:00:00.000Z',
  };
}

function employee(
  profileId: string,
  teamId: string,
  teamName: string,
  day?: Partial<DailyAllocationEmployeeResource['days'][number]>
): DailyAllocationEmployeeResource {
  return {
    profile_id: profileId,
    full_name: profileId,
    employee_id: profileId,
    team_id: teamId,
    team_name: teamName,
    days: [{
      work_date: '2026-08-14',
      availability: 'available',
      blocking_absence: null,
      pending_absence: null,
      am_working: true,
      pm_working: true,
      ...day,
    }],
  };
}

describe('filterDailyAllocationBoardForTeam', () => {
  it('does not mix same-date plans from two teams', () => {
    const board = boardFixture();
    const teamOne = filterDailyAllocationBoardForTeam(board, 'team-1');
    const teamTwo = filterDailyAllocationBoardForTeam(board, 'team-2');

    expect(planDayForDate(board, '2026-08-14')?.id).toBe('plan-team-1');
    expect(planDayForDate(teamOne, '2026-08-14')).toMatchObject({ id: 'plan-team-1', team_id: 'team-1', plan_version: 3 });
    expect(planDayForDate(teamTwo, '2026-08-14')).toMatchObject({ id: 'plan-team-2', team_id: 'team-2', plan_version: 7 });
    expect(teamOne.visits.map((item) => item.id)).toEqual(['visit-1']);
    expect(teamTwo.visits.map((item) => item.id)).toEqual(['visit-2']);
    expect(teamOne.labour_assignments).toHaveLength(0);
    expect(teamTwo.labour_assignments.map((item) => item.id)).toEqual(['labour-2']);
    expect(teamOne.resources.employees.map((item) => item.profile_id)).toEqual(['employee-1']);
    expect(teamTwo.legacy.labour.map((item) => item.id)).toEqual(['draft-2']);
    expect(teamOne.legacy.plant).toHaveLength(0);
    expect(teamTwo.publications.map((item) => item.id)).toEqual(['publication-2']);
    expect(teamOne.conflicts).toHaveLength(0);
    expect(teamTwo.conflicts).toHaveLength(1);
  });

  it('derives active team as selected override then context then first team', () => {
    const board = boardFixture();
    expect(resolveDailyAllocationActiveTeamId(board, 'team-2')).toBe('team-2');
    expect(resolveDailyAllocationActiveTeamId(board, null)).toBe('team-1');
    expect(resolveDailyAllocationActiveTeamId({
      ...board,
      context: { ...board.context, team_id: null },
    }, null)).toBe('team-1');
  });
});

describe('half-day absence overlap', () => {
  it('hard-blocks AM before 12:00 and PM from 12:00, independent of work-shift flags', () => {
    expect(visitOverlapsHalfDaySession(11 * 60 + 30, 12 * 60, 'AM')).toBe(true);
    expect(visitOverlapsHalfDaySession(12 * 60, 12 * 60 + 30, 'AM')).toBe(false);
    expect(visitOverlapsHalfDaySession(11 * 60 + 30, 12 * 60, 'PM')).toBe(false);
    expect(visitOverlapsHalfDaySession(12 * 60, 12 * 60 + 30, 'PM')).toBe(true);
    expect(visitOverlapsHalfDaySession(11 * 60 + 30, 12 * 60 + 30, 'AM')).toBe(true);
    expect(visitOverlapsHalfDaySession(11 * 60 + 30, 12 * 60 + 30, 'PM')).toBe(true);

    const morning = visit('visit-am', 'plan-team-1', 'team-1', 'JOB-100', 8 * 60, 11 * 60);
    const afternoon = visit('visit-pm', 'plan-team-1', 'team-1', 'JOB-100', 12 * 60, 15 * 60);
    const board = boardFixture();
    const amAbsent = {
      ...board,
      resources: {
        ...board.resources,
        employees: [employee('employee-1', 'team-1', 'Team One', {
          availability: 'half_day_absence',
          blocking_absence: absence('AM'),
          am_working: true,
          pm_working: true,
        })],
      },
    };
    expect(evaluateEmployeeAssignmentBlock(amAbsent, morning, 'employee-1')).toEqual({
      hard: 'This visit overlaps an approved morning absence.',
    });
    expect(evaluateEmployeeAssignmentBlock(amAbsent, afternoon, 'employee-1')).toBeNull();

    const pmAbsentOffShiftAm = {
      ...board,
      resources: {
        ...board.resources,
        employees: [employee('employee-1', 'team-1', 'Team One', {
          availability: 'half_day_absence',
          blocking_absence: absence('PM'),
          am_working: false,
          pm_working: true,
        })],
      },
    };
    expect(evaluateEmployeeAssignmentBlock(pmAbsentOffShiftAm, afternoon, 'employee-1')).toEqual({
      hard: 'This visit overlaps an approved afternoon absence.',
    });
    expect(evaluateEmployeeAssignmentBlock(pmAbsentOffShiftAm, morning, 'employee-1')).toEqual({
      warning: 'off_shift',
    });
  });
});
