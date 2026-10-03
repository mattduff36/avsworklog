import { describe, expect, it, vi } from 'vitest';
import { patchBoardWithAssignedVisit } from '@/components/daily-allocation/board/daily-allocation-board-cache';
import { buildDailyAllocationBoardRows } from '@/components/daily-allocation/board/daily-allocation-board-primary';
import { DailyAllocationApiError } from '@/lib/client/daily-allocation';
import type {
  DailyAllocationLabourAssignment,
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisit,
} from '@/types/daily-allocation';
import { planDayClaim } from '@/components/daily-allocation/board/daily-allocation-mutation-claims';
import { DailyAllocationMutationCoordinator } from '@/components/daily-allocation/board/daily-allocation-mutation-coordinator';
import {
  runDailyAllocationOptimisticMutation,
  type DailyAllocationBoardQueryAdapter,
  type DailyAllocationOptimisticLedgerHandle,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-runner';
import type { DailyAllocationOptimisticOperation } from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';

function createLedger(): DailyAllocationOptimisticLedgerHandle {
  let operations: DailyAllocationOptimisticOperation[] = [];
  let sequence = 0;
  const coordinator = new DailyAllocationMutationCoordinator(
    (next) => {
      operations = next;
    },
    () => ++sequence
  );
  return {
    coordinator,
    getOperations: () => operations,
    setOperations: (next) => {
      operations = typeof next === 'function' ? next(operations) : next;
      coordinator.replaceOperations(operations);
    },
    nextSequence: () => ++sequence,
  };
}

function createAdapter(): DailyAllocationBoardQueryAdapter & {
  cancel: ReturnType<typeof vi.fn>;
  scheduleReconciliation: ReturnType<typeof vi.fn>;
} {
  return {
    getBoard: () => undefined,
    cancel: vi.fn(),
    scheduleReconciliation: vi.fn(),
  };
}

describe('daily allocation optimistic runner', () => {
  it('projects immediately, injects the coordinator request id, and schedules proof reconciliation', async () => {
    const ledger = createLedger();
    const adapter = createAdapter();
    let persistedRequestId = '';
    const promise = runDailyAllocationOptimisticMutation({
      ledger,
      adapter,
      boardKey: 'board:2026-08-13:2026-08-13',
      kind: 'create-visit',
      claims: [planDayClaim('plan-1')],
      apply: (state) => state,
      mutate: async ({ requestId }) => {
        persistedRequestId = requestId;
        return { visit_id: 'visit-real' };
      },
      acknowledge: () => ({
        proofs: {
          'board:2026-08-13:2026-08-13': () => false,
        },
      }),
    });

    expect(ledger.getOperations()).toHaveLength(1);
    const operation = ledger.getOperations()[0]!;
    await expect(promise).resolves.toEqual({ visit_id: 'visit-real' });
    expect(persistedRequestId).toBe(operation.requestId);
    expect(operation.status).toBe('acknowledged');
    expect(adapter.cancel).toHaveBeenCalledTimes(2);
    expect(adapter.scheduleReconciliation).toHaveBeenCalledWith([
      'board:2026-08-13:2026-08-13',
    ]);
    ledger.coordinator.dispose();
  });

  it('removes only a genuine conflict failure and leaves another operation projected', async () => {
    const ledger = createLedger();
    const adapter = createAdapter();
    const kept = runDailyAllocationOptimisticMutation({
      ledger,
      adapter,
      boardKey: 'board:range',
      kind: 'create-visit',
      claims: [planDayClaim('plan-kept')],
      apply: (state) => state,
      mutate: async () => new Promise<{ id: string }>(() => undefined),
    });
    void kept;

    await expect(runDailyAllocationOptimisticMutation({
      ledger,
      adapter,
      boardKey: 'board:range',
      kind: 'update-visit',
      claims: [planDayClaim('plan-failed')],
      apply: (state) => state,
      mutate: async () => {
        throw new DailyAllocationApiError('Plan is stale', 409, {
          code: 'STALE_PLAN_VERSION',
        });
      },
    })).rejects.toMatchObject({ code: 'STALE_PLAN_VERSION' });

    expect(ledger.getOperations()).toHaveLength(1);
    expect(ledger.getOperations()[0]?.claims?.[0]?.id).toBe('plan-kept');
    ledger.coordinator.dispose();
  });

  it('keeps an assigned job drop through an ambiguous failure and removes it on a hard conflict', async () => {
    const visit: DailyAllocationVisit = {
      id: 'optimistic:visit',
      plan_day_id: 'plan-1',
      work_date: '2026-08-13',
      owner_team_id: 'team-1',
      job_source_type: 'project_number',
      job_source_id: 'job-1',
      job_code: 'J-1',
      site_address: 'Site',
      starts_at: '2026-08-13T07:00:00.000Z',
      ends_at: '2026-08-13T16:30:00.000Z',
      meeting_point: null,
      meet_person: null,
      notes: null,
      row_version: 1,
      updated_at: '2026-08-13T07:00:00.000Z',
    };
    const assignment: DailyAllocationLabourAssignment = {
      id: 'optimistic:labour',
      visit_id: visit.id,
      plan_day_id: 'plan-1',
      work_date: visit.work_date,
      profile_id: 'profile-1',
      starts_at: visit.starts_at,
      ends_at: visit.ends_at,
      meeting_point: null,
      meet_person: null,
      notes: null,
      row_version: 1,
      updated_at: visit.updated_at,
    };
    const board: DailyAllocationRangeBoardPayload = {
      start_date: visit.work_date,
      end_date: visit.work_date,
      dates: [visit.work_date],
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
        work_date: visit.work_date,
        team_id: 'team-1',
        plan_version: 2,
        converted_at: visit.updated_at,
        converted_by: 'user-1',
        updated_at: visit.updated_at,
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
    const ambiguous = createLedger();
    let attempts = 0;
    const ambiguousPromise = runDailyAllocationOptimisticMutation({
      ledger: ambiguous,
      adapter: createAdapter(),
      boardKey: 'board:range',
      kind: 'create-assigned-visit',
      claims: [planDayClaim('plan-1')],
      apply: (state) => ({
        board: state.board
          ? patchBoardWithAssignedVisit(state.board, visit, assignment)
          : state.board,
      }),
      mutate: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('network down');
        return { ok: true };
      },
    });
    const admitted = ambiguous.getOperations()[0]?.apply({ board }).board;
    const admittedRows = buildDailyAllocationBoardRows({
      primary: 'employee',
      board: admitted!,
      dates: [visit.work_date],
    });
    expect(admittedRows.some((row) => row.kind === 'unassigned')).toBe(false);
    expect(admittedRows.find((row) => row.id === 'employee:profile-1')?.visits).toEqual([
      expect.objectContaining({ id: visit.id }),
    ]);
    await vi.waitFor(() => {
      expect(ambiguous.getOperations()[0]?.executionStatus).toBe('awaiting-retry');
    });
    const retrying = ambiguous.getOperations()[0]?.apply({ board }).board;
    expect(buildDailyAllocationBoardRows({
      primary: 'employee',
      board: retrying!,
      dates: [visit.work_date],
    }).find((row) => row.id === 'employee:profile-1')?.visits).toHaveLength(1);
    await ambiguousPromise;
    ambiguous.coordinator.dispose();

    const rejected = createLedger();
    const rejectedPromise = runDailyAllocationOptimisticMutation({
      ledger: rejected,
      adapter: createAdapter(),
      boardKey: 'board:range',
      kind: 'create-assigned-visit',
      claims: [planDayClaim('plan-1')],
      apply: (state) => ({
        board: state.board
          ? patchBoardWithAssignedVisit(state.board, visit, assignment)
          : state.board,
      }),
      mutate: async () => {
        throw new DailyAllocationApiError('Hard conflict', 409, { code: 'HARD_CONFLICT' });
      },
    });
    await expect(rejectedPromise).rejects.toMatchObject({ code: 'HARD_CONFLICT' });
    expect(rejected.getOperations()).toEqual([]);
  });
});
