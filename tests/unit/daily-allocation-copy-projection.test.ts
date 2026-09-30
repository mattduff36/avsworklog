import { describe, expect, it } from 'vitest';
import {
  applyCopiedAllocationProjection,
  buildCopiedAllocationProjection,
  copiedAllocationProjectionProven,
} from '@/components/daily-allocation/board/daily-allocation-copy-projection';
import type { DailyAllocationRangeBoardPayload } from '@/types/daily-allocation';

function board(): DailyAllocationRangeBoardPayload {
  return {
    start_date: '2026-08-14',
    end_date: '2026-08-15',
    dates: ['2026-08-14', '2026-08-15'],
    context: {
      user_id: 'manager-1',
      access_level: 5,
      is_manager: true,
      is_admin: false,
      team_id: 'team-1',
      team_name: 'Team One',
    },
    plan_days: [],
    visits: [{
      id: 'visit-1',
      plan_day_id: 'plan-1',
      work_date: '2026-08-14',
      owner_team_id: 'team-1',
      job_source_type: 'live_quote',
      job_source_id: 'quote-1',
      job_code: 'JOB-100',
      site_address: '1 Test Street',
      starts_at: '2026-08-14T06:00:00.000Z',
      ends_at: '2026-08-14T15:30:00.000Z',
      meeting_point: null,
      meet_person: null,
      notes: null,
      row_version: 4,
      updated_at: '2026-08-14T08:00:00.000Z',
    }],
    labour_assignments: [{
      id: 'labour-1',
      visit_id: 'visit-1',
      plan_day_id: 'plan-1',
      work_date: '2026-08-14',
      profile_id: 'employee-1',
      starts_at: '2026-08-14T06:00:00.000Z',
      ends_at: '2026-08-14T15:30:00.000Z',
      meeting_point: null,
      meet_person: null,
      notes: null,
      row_version: 2,
      updated_at: '2026-08-14T08:00:00.000Z',
    }],
    plant_assignments: [],
    overrides: [],
    conflicts: [],
    legacy: { labour: [], plant: [] },
    jobs: [],
    resources: { employees: [], plant: [], teams: [] },
    publications: [],
  };
}

describe('copied allocation projection', () => {
  it('clones an accepted visit and its only employee onto the next day', () => {
    let sequence = 0;
    const projection = buildCopiedAllocationProjection({
      board: board(),
      result: {
        source_date: '2026-08-14',
        target_date: '2026-08-15',
        additions: [
          { label: 'JOB-100', detail: 'Visit' },
          { label: 'JOB-100', detail: 'Employee included with the copied visit' },
        ],
      },
      createId: () => `optimistic:copy-${sequence += 1}`,
      now: '2026-08-14T09:00:00.000Z',
    });

    expect(projection.visits).toHaveLength(1);
    expect(projection.visits[0]).toMatchObject({
      job_code: 'JOB-100',
      work_date: '2026-08-15',
      starts_at: '2026-08-15T06:00:00.000Z',
      ends_at: '2026-08-15T15:30:00.000Z',
      row_version: 1,
    });
    expect(projection.labour).toHaveLength(1);
    expect(projection.labour[0]?.profile_id).toBe('employee-1');
    const projected = applyCopiedAllocationProjection(board(), projection);
    expect(projected.visits.map((visit) => visit.work_date)).toEqual(['2026-08-14', '2026-08-15']);
    expect(copiedAllocationProjectionProven(board(), {
      source_date: '2026-08-14',
      target_date: '2026-08-15',
      additions: [],
    }, projection.sourceVisits)).toBe(false);
  });

  it('does not invent an employee when a labour row was skipped', () => {
    const projection = buildCopiedAllocationProjection({
      board: board(),
      result: {
        source_date: '2026-08-14',
        target_date: '2026-08-15',
        additions: [{ label: 'JOB-100', detail: 'Visit' }],
      },
      createId: () => 'optimistic:copy',
    });

    expect(projection.visits).toHaveLength(1);
    expect(projection.labour).toEqual([]);
  });
});