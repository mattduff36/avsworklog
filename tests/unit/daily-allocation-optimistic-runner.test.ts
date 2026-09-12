import { describe, expect, it, vi } from 'vitest';
import { DailyAllocationApiError } from '@/lib/client/daily-allocation';
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
    expect(adapter.cancel).toHaveBeenCalledTimes(1);
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
});
