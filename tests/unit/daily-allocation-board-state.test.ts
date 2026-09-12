import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyAllocationApiError } from '@/lib/client/daily-allocation';
import {
  DailyAllocationMutationCoordinator,
  type DailyAllocationPersistSuccess,
} from '@/components/daily-allocation/board/daily-allocation-mutation-coordinator';
import {
  claimsConflict,
  planDayClaim,
  visitClaim,
  visitTimesCoalesceGroup,
} from '@/components/daily-allocation/board/daily-allocation-mutation-claims';
import { DailyAllocationBoardReconciler } from '@/components/daily-allocation/board/daily-allocation-board-reconciliation';
import {
  retireExhaustedOptimisticOperations,
  type DailyAllocationProjection,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';

function deferred<T = DailyAllocationPersistSuccess<string>>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const apply = (state: DailyAllocationProjection): DailyAllocationProjection => state;

function coordinator() {
  const snapshots: string[][] = [];
  const value = new DailyAllocationMutationCoordinator((operations) => {
    snapshots.push(operations.map((operation) => `${operation.id}:${operation.executionStatus}`));
  });
  return { value, snapshots };
}

describe('daily allocation coordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies shared/exclusive claim conflicts only to the same scope and id', () => {
    const shared = visitClaim('visit-1', 'shared');
    const exclusive = visitClaim('visit-1');
    expect(claimsConflict([shared], [shared])).toBe(false);
    expect(claimsConflict([shared], [exclusive])).toBe(true);
    expect(claimsConflict([exclusive], [shared])).toBe(true);
    expect(claimsConflict([exclusive], [visitClaim('visit-2')])).toBe(false);
  });

  it('reactivates after a Strict Mode effect cleanup before accepting commands', async () => {
    const { value } = coordinator();
    value.dispose();
    value.activate();
    const command = value.admit({
      kind: 'update-visit',
      claims: [planDayClaim('plan-1')],
      queryKeys: ['board:range'],
      apply,
      persist: async () => ({ result: 'saved' }),
    });
    await expect(command.completion).resolves.toBe('saved');
    value.dispose();
  });

  it('retires an uncertain projection after bounded authoritative misses', () => {
    const operation = {
      id: 'uncertain',
      sequence: 1,
      kind: 'update-visit',
      status: 'uncertain' as const,
      lockKeys: ['plan:plan-1'],
      claims: [planDayClaim('plan-1')],
      queryKeys: ['board:range'],
      reconciledKeys: [],
      proofs: { 'board:range': () => false },
      apply,
    };
    expect(retireExhaustedOptimisticOperations(
      [operation],
      'board:range',
      new Set(['uncertain']),
      () => 2,
      3
    )).toEqual([operation]);
    expect(retireExhaustedOptimisticOperations(
      [operation],
      'board:range',
      new Set(['uncertain']),
      () => 3,
      3
    )).toEqual([]);
  });

  it('serializes persistence touching one plan day while disjoint plan days execute', async () => {
    const { value } = coordinator();
    const first = deferred();
    const samePlan = deferred();
    const disjoint = deferred();
    const started: string[] = [];
    const admit = (
      id: string,
      plan: string,
      gate: { promise: Promise<DailyAllocationPersistSuccess<string>> }
    ) =>
      value.admit({
        id,
        kind: 'update-visit',
        claims: [planDayClaim(plan), visitClaim(id)],
        queryKeys: ['board:range'],
        apply,
        persist: async () => {
          started.push(id);
          return gate.promise;
        },
      });
    const a = admit('a', 'plan-1', first);
    const b = admit('b', 'plan-1', samePlan);
    const c = admit('c', 'plan-2', disjoint);
    await flush();
    expect(started).toEqual(['a', 'c']);
    first.resolve({ result: 'a' });
    await flush();
    expect(started).toEqual(['a', 'c', 'b']);
    samePlan.resolve({ result: 'b' });
    disjoint.resolve({ result: 'c' });
    await expect(Promise.all([a.completion, b.completion, c.completion])).resolves.toEqual(['a', 'b', 'c']);
    value.dispose();
  });

  it('DAFP-STATE-001 suppresses duplicates and coalesces an unsent resize onto the latest command', async () => {
    const { value } = coordinator();
    const calls: string[] = [];
    const first = value.admit({
      kind: 'resize-visit',
      duplicateKey: 'resize:visit-1:08:00:10:00',
      coalesceGroup: visitTimesCoalesceGroup('visit-1'),
      claims: [planDayClaim('plan-1'), visitClaim('visit-1')],
      queryKeys: ['board:range'],
      apply,
      persist: async ({ requestId }) => {
        calls.push(`first:${requestId}`);
        return { result: 'first' };
      },
    });
    const duplicate = value.admit({
      kind: 'resize-visit',
      duplicateKey: 'resize:visit-1:08:00:10:00',
      claims: [planDayClaim('plan-1'), visitClaim('visit-1')],
      queryKeys: ['board:range'],
      apply,
      persist: async () => ({ result: 'duplicate' }),
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.operation.id).toBe(first.operation.id);

    const latest = value.admit({
      kind: 'resize-visit',
      coalesceGroup: visitTimesCoalesceGroup('visit-1'),
      claims: [planDayClaim('plan-1'), visitClaim('visit-1')],
      queryKeys: ['board:range'],
      apply,
      persist: async ({ requestId }) => {
        calls.push(`latest:${requestId}`);
        return { result: 'latest' };
      },
    });
    expect(latest.coalesced).toBe(true);
    expect(latest.operation.requestId).toBe(first.operation.requestId);
    await expect(latest.completion).resolves.toBe('latest');
    expect(calls).toEqual([`latest:${first.operation.requestId}`]);
    value.dispose();
  });

  it('reuses one request id for bounded ambiguous retries and never retries a 409', async () => {
    vi.useFakeTimers();
    const { value } = coordinator();
    const requestIds: string[] = [];
    let attempts = 0;
    const retried = value.admit({
      kind: 'update-visit',
      claims: [planDayClaim('plan-1')],
      queryKeys: ['board:range'],
      apply,
      persist: async ({ requestId }) => {
        requestIds.push(requestId);
        attempts += 1;
        if (attempts < 3) throw new TypeError('connection reset');
        return { result: 'saved' };
      },
    });
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    await expect(retried.completion).resolves.toBe('saved');
    expect(new Set(requestIds)).toEqual(new Set([retried.operation.requestId]));

    let conflictAttempts = 0;
    const conflict = value.admit({
      kind: 'update-visit',
      claims: [planDayClaim('plan-2')],
      queryKeys: ['board:range'],
      apply,
      persist: async () => {
        conflictAttempts += 1;
        throw new DailyAllocationApiError('stale', 409, { code: 'STALE_PLAN_VERSION' });
      },
    });
    await expect(conflict.completion).rejects.toMatchObject({ status: 409 });
    await vi.runAllTimersAsync();
    expect(conflictAttempts).toBe(1);
    value.dispose();
  });

  it('keeps retry exhaustion uncertain for authoritative reconciliation', async () => {
    vi.useFakeTimers();
    const { value } = coordinator();
    const command = value.admit({
      id: 'uncertain',
      kind: 'update-visit',
      claims: [planDayClaim('plan-1')],
      queryKeys: ['board:range'],
      apply,
      persist: async () => {
        throw new TypeError('connection reset');
      },
    });
    const completion = expect(command.completion).rejects.toMatchObject({
      code: 'UNCERTAIN_OUTCOME',
    });
    await flush();
    await vi.advanceTimersByTimeAsync(250 + 500 + 1000);
    await completion;
    expect(value.getOperations()[0]).toMatchObject({
      id: 'uncertain',
      status: 'uncertain',
      executionStatus: 'completed',
    });
    expect(value.getOutcome('uncertain')).toBe('uncertain');
    value.dispose();
  });

  it('rewrites provisional aliases before a dependent command can persist', async () => {
    const { value } = coordinator();
    const optimisticId = 'optimistic:create:visit';
    const createGate = deferred();
    let receivedId: string | undefined;
    const create = value.admit({
      id: 'create',
      kind: 'create-visit',
      claims: [planDayClaim('plan-1'), visitClaim(optimisticId)],
      queryKeys: ['board:range'],
      apply,
      persist: async () => createGate.promise,
    });
    const update = value.admit({
      id: 'update',
      kind: 'resize-visit',
      dependsOn: [create.operation.id],
      identityWaitKeys: [optimisticId],
      claims: [planDayClaim('plan-1'), visitClaim(optimisticId)],
      queryKeys: ['board:range'],
      apply,
      persist: async ({ resolveIdentity }) => {
        receivedId = resolveIdentity(optimisticId);
        expect(receivedId.startsWith('optimistic:')).toBe(false);
        return { result: 'updated' };
      },
    });
    await flush();
    expect(receivedId).toBeUndefined();
    createGate.resolve({
      result: 'created',
      identityAliases: { [optimisticId]: 'visit-real' },
    });
    await expect(create.completion).resolves.toBe('created');
    await expect(update.completion).resolves.toBe('updated');
    expect(receivedId).toBe('visit-real');
    value.dispose();
  });

  it('removes only a failed operation and records independent outcomes', async () => {
    const { value } = coordinator();
    const failed = value.admit({
      id: 'failed',
      kind: 'update-visit',
      claims: [planDayClaim('plan-1')],
      queryKeys: ['board:range'],
      apply,
      persist: async () => {
        throw new DailyAllocationApiError('invalid', 400);
      },
    });
    const succeeded = value.admit({
      id: 'succeeded',
      kind: 'update-visit',
      claims: [planDayClaim('plan-2')],
      queryKeys: ['board:range'],
      apply,
      persist: async () => ({ result: 'ok' }),
    });
    await expect(failed.completion).rejects.toMatchObject({ status: 400 });
    await expect(succeeded.completion).resolves.toBe('ok');
    expect(value.getOperations().map((operation) => operation.id)).toEqual(['succeeded']);
    expect(value.getOutcome('failed')).toBe('failed');
    expect(value.getOutcome('succeeded')).toBe('success');
    value.dispose();
  });
});

describe('board reconciliation', () => {
  it('coalesces range verification and defers it until pointer interaction ends', async () => {
    vi.useFakeTimers();
    const runs: string[][] = [];
    let cancels = 0;
    const reconciler = new DailyAllocationBoardReconciler({
      delayMs: 400,
      onInteractionStart: () => {
        cancels += 1;
      },
      run: async (keys) => {
        runs.push(keys);
      },
    });
    reconciler.setInteractionActive(true);
    reconciler.schedule(['board:2026-09-07:2026-09-13']);
    reconciler.schedule(['board:2026-09-07:2026-09-13']);
    await vi.advanceTimersByTimeAsync(800);
    expect(runs).toEqual([]);
    expect(cancels).toBe(1);
    reconciler.setInteractionActive(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(runs).toEqual([['board:2026-09-07:2026-09-13']]);
    reconciler.dispose();
  });
});
