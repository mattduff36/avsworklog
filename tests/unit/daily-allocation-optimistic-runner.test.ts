import { describe, expect, it, vi } from 'vitest';
import {
  DailyAllocationApiError,
} from '@/lib/client/daily-allocation';
import {
  patchBoardWithVisit,
} from '@/components/daily-allocation/board/daily-allocation-board-cache';
import {
  type DailyAllocationOptimisticOperation,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import {
  runDailyAllocationOptimisticMutation,
  type DailyAllocationBoardQueryAdapter,
  type DailyAllocationOptimisticLedgerHandle,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-runner';
import type { DailyAllocationRangeBoardPayload, DailyAllocationVisit } from '@/types/daily-allocation';

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
      plan_version: 1,
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

function visit(id: string): DailyAllocationVisit {
  return {
    id,
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
}

function createLedger(
  seed: DailyAllocationOptimisticOperation[] = []
): DailyAllocationOptimisticLedgerHandle {
  let operations = [...seed];
  let sequence = seed.length;
  return {
    getOperations: () => operations,
    setOperations: (next) => {
      operations = typeof next === 'function' ? next(operations) : next;
    },
    nextSequence: () => {
      sequence += 1;
      return sequence;
    },
  };
}

describe('daily allocation optimistic runner', () => {
  it('registers an overlay, reconciles only that operation on success, and refetches', async () => {
    let board = boardFixture();
    const ledger = createLedger();
    const adapter: DailyAllocationBoardQueryAdapter = {
      getBoard: () => board,
      cancel: vi.fn(),
      refetch: vi.fn(async () => {
        board = patchBoardWithVisit(boardFixture(), visit('visit-real'));
        return board;
      }),
    };

    const result = await runDailyAllocationOptimisticMutation({
      ledger,
      adapter,
      boardKey: 'board:2026-08-13:2026-08-13',
      kind: 'create-visit',
      lockKeys: ['visit:optimistic:op:visit'],
      apply: (state) => ({
        board: state.board
          ? patchBoardWithVisit(state.board, visit('optimistic:op:visit'))
          : state.board,
      }),
      mutate: async () => ({ visit_id: 'visit-real' }),
      acknowledge: (payload) => ({
        apply: (state) => ({
          board: state.board
            ? patchBoardWithVisit(state.board, visit(payload.visit_id), 'optimistic:op:visit')
            : state.board,
        }),
        proofs: {
          'board:2026-08-13:2026-08-13': (base) =>
            base.board?.visits.some((item) => item.id === 'visit-real') === true,
        },
      }),
    });

    expect(result).toEqual({ visit_id: 'visit-real' });
    expect(adapter.refetch).toHaveBeenCalledTimes(1);
    expect(ledger.getOperations()).toEqual([]);
  });

  it('rolls back only the failed operation and refetches on stale conflict', async () => {
    const kept: DailyAllocationOptimisticOperation = {
      id: 'kept',
      sequence: 1,
      kind: 'create-visit',
      status: 'pending',
      lockKeys: ['visit:kept'],
      queryKeys: ['board:2026-08-13:2026-08-13'],
      reconciledKeys: [],
      proofs: {},
      apply: (state) => ({
        board: state.board ? patchBoardWithVisit(state.board, visit('kept')) : state.board,
      }),
    };
    const ledger = createLedger([kept]);
    const refetch = vi.fn(async () => boardFixture());
    const adapter: DailyAllocationBoardQueryAdapter = {
      getBoard: () => boardFixture(),
      cancel: vi.fn(),
      refetch,
    };

    await expect(
      runDailyAllocationOptimisticMutation({
        ledger,
        adapter,
        boardKey: 'board:2026-08-13:2026-08-13',
        kind: 'update-visit',
        lockKeys: ['visit:failing'],
        apply: (state) => state,
        mutate: async () => {
          throw new DailyAllocationApiError('Plan is stale', 409, { code: 'STALE_PLAN_VERSION' });
        },
      })
    ).rejects.toMatchObject({ code: 'STALE_PLAN_VERSION' });

    expect(ledger.getOperations().map((operation) => operation.id)).toEqual(['kept']);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('removes the uncertain overlay when a 5xx mutation is followed by a successful refetch', async () => {
    const ledger = createLedger();
    const refetch = vi.fn(async () => boardFixture());
    const adapter: DailyAllocationBoardQueryAdapter = {
      getBoard: () => boardFixture(),
      cancel: vi.fn(),
      refetch,
    };

    await expect(
      runDailyAllocationOptimisticMutation({
        ledger,
        adapter,
        boardKey: 'board:2026-08-13:2026-08-13',
        kind: 'update-visit',
        lockKeys: ['visit:server-error'],
        apply: (state) => ({
          board: state.board ? patchBoardWithVisit(state.board, visit('optimistic:op:visit')) : state.board,
        }),
        mutate: async () => {
          throw new DailyAllocationApiError('Internal error', 500);
        },
      })
    ).rejects.toMatchObject({ status: 500 });

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(ledger.getOperations()).toEqual([]);
  });

  it('keeps the overlay uncertain when a 5xx mutation and the refetch both fail', async () => {
    const ledger = createLedger();
    const refetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const adapter: DailyAllocationBoardQueryAdapter = {
      getBoard: () => boardFixture(),
      cancel: vi.fn(),
      refetch,
    };

    await expect(
      runDailyAllocationOptimisticMutation({
        ledger,
        adapter,
        boardKey: 'board:2026-08-13:2026-08-13',
        kind: 'update-visit',
        lockKeys: ['visit:network'],
        apply: (state) => ({
          board: state.board ? patchBoardWithVisit(state.board, visit('optimistic:op:visit')) : state.board,
        }),
        mutate: async () => {
          throw new DailyAllocationApiError('Internal error', 500);
        },
      })
    ).rejects.toMatchObject({ status: 500 });

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(ledger.getOperations()).toHaveLength(1);
    expect(ledger.getOperations()[0]?.status).toBe('uncertain');
  });
});
