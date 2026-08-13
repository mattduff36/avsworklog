import { describe, expect, it } from 'vitest';
import {
  collectDailyAllocationEntityIds,
  filterDailyAllocationBoardToDates,
  patchBoardWithVisit,
  projectDailyAllocationBoardView,
  snapshotDailyAllocationBoard,
} from '@/components/daily-allocation/board/daily-allocation-board-cache';
import {
  createOptimisticEntityId,
  projectDailyAllocationState,
  type DailyAllocationOptimisticOperation,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import type {
  DailyAllocationLabourAssignment,
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisit,
} from '@/types/daily-allocation';

function visit(id: string, workDate: string, startsAt: string): DailyAllocationVisit {
  return {
    id,
    plan_day_id: `plan-${workDate}`,
    work_date: workDate,
    owner_team_id: 'team-1',
    job_source_type: 'project_number',
    job_source_id: 'job-1',
    job_code: 'J-1',
    site_address: 'Site',
    starts_at: startsAt,
    ends_at: startsAt.replace('08:00', '10:00').replace('12:00', '14:00'),
    meeting_point: null,
    meet_person: null,
    notes: null,
    row_version: 1,
    updated_at: '2026-08-13T07:00:00.000Z',
  };
}

function labour(
  id: string,
  visitId: string,
  workDate: string,
  startsAt: string
): DailyAllocationLabourAssignment {
  return {
    id,
    visit_id: visitId,
    plan_day_id: `plan-${workDate}`,
    work_date: workDate,
    profile_id: 'profile-1',
    starts_at: startsAt,
    ends_at: startsAt.replace('08:00', '10:00').replace('12:00', '14:00'),
    meeting_point: null,
    meet_person: null,
    notes: null,
    row_version: 1,
    updated_at: '2026-08-13T07:00:00.000Z',
  };
}

function weeklyBoard(): DailyAllocationRangeBoardPayload {
  const wednesday = visit('visit-wed', '2026-08-12', '2026-08-12T08:00:00.000Z');
  const thursday = visit('visit-thu', '2026-08-13', '2026-08-13T12:00:00.000Z');
  return {
    start_date: '2026-08-10',
    end_date: '2026-08-16',
    dates: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
    context: {
      user_id: 'user-1',
      access_level: 4,
      is_manager: true,
      is_admin: false,
      team_id: 'team-1',
      team_name: 'Civils',
    },
    plan_days: [
      {
        id: 'plan-2026-08-12',
        work_date: '2026-08-12',
        team_id: 'team-1',
        plan_version: 3,
        converted_at: '2026-08-12T08:00:00.000Z',
        converted_by: 'user-1',
        updated_at: '2026-08-12T08:00:00.000Z',
      },
      {
        id: 'plan-2026-08-13',
        work_date: '2026-08-13',
        team_id: 'team-1',
        plan_version: 4,
        converted_at: '2026-08-13T08:00:00.000Z',
        converted_by: 'user-1',
        updated_at: '2026-08-13T08:00:00.000Z',
      },
    ],
    visits: [wednesday, thursday],
    labour_assignments: [
      labour('labour-wed', wednesday.id, '2026-08-12', wednesday.starts_at),
      labour('labour-thu', thursday.id, '2026-08-13', thursday.starts_at),
    ],
    plant_assignments: [],
    overrides: [],
    conflicts: [],
    legacy: { labour: [], plant: [] },
    jobs: [{
      source_type: 'project_number',
      source_id: 'job-1',
      job_code: 'J-1',
      customer_name: 'Acme',
      title: 'Job',
      site_address: 'Site',
      source_href: null,
    }],
    resources: { employees: [], plant: [], teams: [{ id: 'team-1', name: 'Civils' }] },
    publications: [],
  };
}

describe('DA2-VIEW-001 daily and weekly projections', () => {
  it('projects the same authoritative entities for a day from Daily and Weekly ranges', () => {
    const weekly = weeklyBoard();
    const dailyView = projectDailyAllocationBoardView(weekly, 'daily', '2026-08-13');
    const weeklyView = projectDailyAllocationBoardView(weekly, 'weekly', '2026-08-13');
    const weeklyDay = filterDailyAllocationBoardToDates(weeklyView, ['2026-08-13']);

    expect(collectDailyAllocationEntityIds(dailyView)).toEqual(
      collectDailyAllocationEntityIds(weeklyDay)
    );
    expect(dailyView.visits.map((item) => item.id)).toEqual(['visit-thu']);
    expect(weeklyView.visits.map((item) => item.id)).toEqual(['visit-wed', 'visit-thu']);
    expect(dailyView.jobs).toEqual(weekly.jobs);
    expect(weeklyView.jobs).toEqual(weekly.jobs);
    expect(dailyView.resources.teams).toEqual(weekly.resources.teams);
  });

  it('keeps an optimistic overlay visible in both Daily and Weekly slices of the same payload', () => {
    const optimisticId = createOptimisticEntityId('op-1', 'visit');
    const operation: DailyAllocationOptimisticOperation = {
      id: 'op-1',
      sequence: 1,
      kind: 'create-visit',
      status: 'pending',
      lockKeys: [`visit:${optimisticId}`],
      queryKeys: ['board:2026-08-10:2026-08-16'],
      reconciledKeys: [],
      proofs: {},
      apply: (state) => ({
        board: state.board
          ? patchBoardWithVisit(
              state.board,
              visit(optimisticId, '2026-08-13', '2026-08-13T08:00:00.000Z')
            )
          : state.board,
      }),
    };

    const projected = projectDailyAllocationState(
      { board: weeklyBoard() },
      [operation],
      'board:2026-08-10:2026-08-16'
    );
    const daily = projectDailyAllocationBoardView(projected.board!, 'daily', '2026-08-13');
    const weekly = projectDailyAllocationBoardView(projected.board!, 'weekly', '2026-08-13');

    expect(daily.visits.some((item) => item.id === optimisticId)).toBe(true);
    expect(weekly.visits.some((item) => item.id === optimisticId)).toBe(true);
    expect(daily.visits.some((item) => item.id === 'visit-thu')).toBe(true);
    expect(weekly.visits.some((item) => item.id === 'visit-wed')).toBe(true);
  });

  it('does not mutate the source payload when slicing a view', () => {
    const weekly = weeklyBoard();
    const snapshot = snapshotDailyAllocationBoard(weekly);
    projectDailyAllocationBoardView(weekly, 'daily', '2026-08-13');
    expect(weekly.visits).toHaveLength(2);
    expect(weekly.visits).toEqual(snapshot?.visits);
  });
});
