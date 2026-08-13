import { describe, expect, it } from 'vitest';
import {
  patchBoardPlanVersion,
  patchBoardRemoveLabourAssignment,
  patchBoardRemoveVisit,
  patchBoardWithLabourAssignment,
  patchBoardWithOverride,
  patchBoardWithPlantAssignment,
  patchBoardWithPublication,
  patchBoardWithVisit,
  snapshotDailyAllocationBoard,
} from '@/components/daily-allocation/board/daily-allocation-board-cache';
import { createOptimisticEntityId } from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import type {
  DailyAllocationConflictOverride,
  DailyAllocationLabourAssignment,
  DailyAllocationPlantAssignment,
  DailyAllocationPublicationMeta,
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisit,
} from '@/types/daily-allocation';

function boardFixture(): DailyAllocationRangeBoardPayload {
  return {
    start_date: '2026-08-13',
    end_date: '2026-08-13',
    dates: ['2026-08-13'],
    context: {
      user_id: 'user-1',
      access_level: 4,
      is_manager: true,
      is_admin: false,
      team_id: 'team-1',
      team_name: 'Civils',
    },
    plan_days: [{
      id: 'plan-1',
      work_date: '2026-08-13',
      team_id: 'team-1',
      plan_version: 2,
      converted_at: '2026-08-13T08:00:00.000Z',
      converted_by: 'user-1',
      updated_at: '2026-08-13T08:00:00.000Z',
    }],
    visits: [],
    labour_assignments: [],
    plant_assignments: [],
    overrides: [],
    conflicts: [],
    legacy: { labour: [], plant: [] },
    jobs: [],
    resources: { employees: [], plant: [], teams: [] },
    publications: [],
  };
}

const visit: DailyAllocationVisit = {
  id: 'visit-1',
  plan_day_id: 'plan-1',
  work_date: '2026-08-13',
  owner_team_id: 'team-1',
  job_source_type: 'project_number',
  job_source_id: 'job-1',
  job_code: 'J-1',
  site_address: 'Site',
  starts_at: '2026-08-13T08:00:00.000Z',
  ends_at: '2026-08-13T10:00:00.000Z',
  meeting_point: null,
  meet_person: null,
  notes: null,
  row_version: 1,
  updated_at: '2026-08-13T07:00:00.000Z',
};

describe('daily allocation board cache', () => {
  it('snapshots and patches without mutating source arrays or objects', () => {
    const board = boardFixture();
    const snap = snapshotDailyAllocationBoard(board);
    const next = patchBoardWithVisit(board, visit);
    board.visits.push(visit);
    expect(snap?.visits).toHaveLength(0);
    expect(next.visits).toHaveLength(1);
    expect(next.visits).not.toBe(board.visits);
    expect(next.plan_days).not.toBe(board.plan_days);
    expect(next.plan_days[0]).not.toBe(board.plan_days[0]);
    expect(next.plan_days[0].plan_version).toBe(3);
    expect(board.plan_days[0].plan_version).toBe(2);
  });

  it('replaces an explicit optimistic visit id without bumping plan version again', () => {
    const optimisticId = createOptimisticEntityId('op-1', 'visit');
    const withOptimistic = patchBoardWithVisit(boardFixture(), { ...visit, id: optimisticId });
    const authoritative = patchBoardWithVisit(
      withOptimistic,
      { ...visit, id: 'visit-real' },
      optimisticId
    );
    expect(authoritative.visits.map((item) => item.id)).toEqual(['visit-real']);
    expect(authoritative.plan_days[0].plan_version).toBe(3);
  });

  it('patches labour, plant, overrides, publications, and plan versions immutably', () => {
    const labour: DailyAllocationLabourAssignment = {
      id: 'labour-1',
      visit_id: 'visit-1',
      plan_day_id: 'plan-1',
      work_date: '2026-08-13',
      profile_id: 'profile-1',
      starts_at: visit.starts_at,
      ends_at: visit.ends_at,
      meeting_point: null,
      meet_person: null,
      notes: null,
      row_version: 1,
      updated_at: visit.updated_at,
    };
    const plant: DailyAllocationPlantAssignment = {
      id: 'plant-1',
      visit_id: 'visit-1',
      plan_day_id: 'plan-1',
      work_date: '2026-08-13',
      plant_kind: 'registered',
      plant_id: 'asset-1',
      hired_serial: null,
      hired_description: null,
      hired_company: null,
      owner_team_id: 'team-1',
      starts_at: visit.starts_at,
      ends_at: visit.ends_at,
      notes: null,
      row_version: 1,
      updated_at: visit.updated_at,
    };
    const override: DailyAllocationConflictOverride = {
      id: 'override-1',
      plan_day_id: 'plan-1',
      visit_id: 'visit-1',
      profile_id: 'profile-1',
      plant_id: null,
      conflict_kind: 'pending_absence',
      evidence: 'Confirmed with supervisor',
      confirmed_by: 'user-1',
      confirmed_at: visit.updated_at,
    };
    const publication: DailyAllocationPublicationMeta = {
      id: 'pub-1',
      work_date: '2026-08-13',
      revision_no: 1,
      published_at: visit.updated_at,
      published_by: 'user-1',
      published_by_name: 'Matt',
      scope_team_id: 'team-1',
      snapshot_version: 2,
      plan_day_id: 'plan-1',
      published_plan_version: 3,
      confirm_unallocated: false,
    };

    const withVisit = patchBoardWithVisit(boardFixture(), visit);
    const withLabour = patchBoardWithLabourAssignment(withVisit, labour);
    const withPlant = patchBoardWithPlantAssignment(withLabour, plant);
    const withOverride = patchBoardWithOverride(withPlant, override);
    const withPublication = patchBoardWithPublication(withOverride, publication);
    const versioned = patchBoardPlanVersion(withPublication, 'plan-1', 9);

    expect(withLabour.labour_assignments).not.toBe(withVisit.labour_assignments);
    expect(withPlant.plant_assignments).not.toBe(withLabour.plant_assignments);
    expect(withOverride.overrides).not.toBe(withPlant.overrides);
    expect(withPublication.publications).not.toBe(withOverride.publications);
    expect(versioned.plan_days[0].plan_version).toBe(9);
    expect(withPublication.plan_days[0].plan_version).not.toBe(9);

    const removedLabour = patchBoardRemoveLabourAssignment(versioned, labour.id);
    expect(removedLabour.labour_assignments).toHaveLength(0);
    const removedVisit = patchBoardRemoveVisit(removedLabour, visit.id);
    expect(removedVisit.visits).toHaveLength(0);
    expect(removedVisit.plant_assignments).toHaveLength(0);
    expect(removedVisit.overrides).toHaveLength(0);
  });

  it('increments plan version once per override mutation and once per following labour assignment', () => {
    const withVisit = patchBoardWithVisit(boardFixture(), visit);
    expect(withVisit.plan_days[0].plan_version).toBe(3);

    const override: DailyAllocationConflictOverride = {
      id: 'optimistic:override',
      plan_day_id: 'plan-1',
      visit_id: 'visit-1',
      profile_id: 'profile-1',
      plant_id: null,
      conflict_kind: 'pending_absence',
      evidence: 'Covered',
      confirmed_by: 'user-1',
      confirmed_at: visit.updated_at,
    };
    const afterOverrideApply = patchBoardWithOverride(withVisit, override);
    expect(afterOverrideApply.plan_days[0].plan_version).toBe(4);
    const afterOverrideAck = patchBoardWithOverride(
      afterOverrideApply,
      { ...override, id: 'override-1' },
      override.id
    );
    expect(afterOverrideAck.plan_days[0].plan_version).toBe(4);

    const labour: DailyAllocationLabourAssignment = {
      id: 'optimistic:labour',
      visit_id: 'visit-1',
      plan_day_id: 'plan-1',
      work_date: '2026-08-13',
      profile_id: 'profile-1',
      starts_at: visit.starts_at,
      ends_at: visit.ends_at,
      meeting_point: null,
      meet_person: null,
      notes: null,
      row_version: 1,
      updated_at: visit.updated_at,
    };
    const afterAssignApply = patchBoardWithLabourAssignment(afterOverrideAck, labour);
    expect(afterAssignApply.plan_days[0].plan_version).toBe(5);
    const afterAssignAck = patchBoardWithLabourAssignment(
      afterAssignApply,
      { ...labour, id: 'labour-1' },
      labour.id
    );
    expect(afterAssignAck.plan_days[0].plan_version).toBe(5);
  });
});
