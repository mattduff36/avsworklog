import {
  DailyAllocationApiError,
  isDailyAllocationStaleOrConflictError,
} from '@/lib/client/daily-allocation';
import {
  operationsOverlap,
  projectDailyAllocationState,
  reconcileOptimisticOperations,
  removeOptimisticOperation,
  type DailyAllocationOptimisticKind,
  type DailyAllocationOptimisticOperation,
  type DailyAllocationProjection,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';

export interface DailyAllocationBoardQueryAdapter {
  getBoard(): DailyAllocationProjection['board'];
  cancel(): Promise<void> | void;
  refetch(): Promise<DailyAllocationProjection['board']>;
}

export interface DailyAllocationOptimisticLedgerHandle {
  getOperations(): DailyAllocationOptimisticOperation[];
  setOperations(
    next:
      | DailyAllocationOptimisticOperation[]
      | ((current: DailyAllocationOptimisticOperation[]) => DailyAllocationOptimisticOperation[])
  ): void;
  nextSequence(): number;
}

export interface RunDailyAllocationOptimisticMutationInput<T> {
  ledger: DailyAllocationOptimisticLedgerHandle;
  adapter: DailyAllocationBoardQueryAdapter;
  boardKey: string;
  kind: DailyAllocationOptimisticKind | string;
  lockKeys: string[];
  apply: DailyAllocationOptimisticOperation['apply'];
  proofs?: DailyAllocationOptimisticOperation['proofs'];
  mutate: () => Promise<T>;
  acknowledge?: (result: T) => {
    apply?: DailyAllocationOptimisticOperation['apply'];
    proofs?: DailyAllocationOptimisticOperation['proofs'];
  };
  operationId?: string;
}

function syncOperations(
  ledger: DailyAllocationOptimisticLedgerHandle,
  next: DailyAllocationOptimisticOperation[]
): void {
  ledger.setOperations(next);
}

function registerOperation(
  ledger: DailyAllocationOptimisticLedgerHandle,
  input: {
    id?: string;
    kind: DailyAllocationOptimisticKind | string;
    lockKeys: string[];
    queryKeys: string[];
    proofs?: DailyAllocationOptimisticOperation['proofs'];
    apply: DailyAllocationOptimisticOperation['apply'];
  }
): DailyAllocationOptimisticOperation | null {
  const current = ledger.getOperations();
  if (operationsOverlap(input, current)) return null;
  const operation: DailyAllocationOptimisticOperation = {
    id: input.id || crypto.randomUUID(),
    sequence: ledger.nextSequence(),
    kind: input.kind,
    status: 'pending',
    lockKeys: input.lockKeys,
    queryKeys: input.queryKeys,
    reconciledKeys: [],
    proofs: input.proofs || {},
    apply: input.apply,
  };
  syncOperations(ledger, [...current, operation]);
  return operation;
}

function settleOperation(
  ledger: DailyAllocationOptimisticLedgerHandle,
  adapter: DailyAllocationBoardQueryAdapter,
  boardKey: string,
  operationId: string,
  outcome: 'success' | 'failure',
  error?: unknown,
  acknowledgement?: {
    proofs?: DailyAllocationOptimisticOperation['proofs'];
    apply?: DailyAllocationOptimisticOperation['apply'];
  }
): void {
  const operations = ledger.getOperations();
  const operation = operations.find((current) => current.id === operationId);
  if (!operation) return;

  const isAmbiguous =
    outcome === 'failure'
    && (
      error instanceof TypeError
      || (error instanceof DailyAllocationApiError && error.status >= 500)
    );

  if (outcome === 'failure' && !isAmbiguous) {
    syncOperations(ledger, removeOptimisticOperation(operations, operationId));
    return;
  }

  syncOperations(
    ledger,
    operations.map((current) =>
      current.id === operationId
        ? {
            ...current,
            status: isAmbiguous ? 'uncertain' : 'acknowledged',
            proofs: acknowledgement?.proofs || current.proofs,
            apply: acknowledgement?.apply || current.apply,
          }
        : current
    )
  );

  const eligible = new Set([operationId]);
  const base: DailyAllocationProjection = { board: adapter.getBoard() };
  syncOperations(
    ledger,
    reconcileOptimisticOperations(ledger.getOperations(), boardKey, base, eligible)
  );
}

export function getProjectedDailyAllocationBoard(
  ledger: DailyAllocationOptimisticLedgerHandle,
  adapter: DailyAllocationBoardQueryAdapter,
  boardKey: string
): DailyAllocationProjection {
  return projectDailyAllocationState(
    { board: adapter.getBoard() },
    ledger.getOperations(),
    boardKey
  );
}

export async function runDailyAllocationOptimisticMutation<T>(
  input: RunDailyAllocationOptimisticMutationInput<T>
): Promise<T> {
  const operation = registerOperation(input.ledger, {
    id: input.operationId,
    kind: input.kind,
    lockKeys: input.lockKeys,
    queryKeys: [input.boardKey],
    proofs: input.proofs,
    apply: input.apply,
  });

  if (!operation) {
    throw new DailyAllocationApiError(
      'Wait for the current daily allocation change to finish saving.',
      409,
      { code: 'OPTIMISTIC_LOCK' },
      'OPTIMISTIC_LOCK'
    );
  }

  await input.adapter.cancel();

  try {
    const result = await input.mutate();
    const acknowledgement = input.acknowledge?.(result);
    settleOperation(
      input.ledger,
      input.adapter,
      input.boardKey,
      operation.id,
      'success',
      undefined,
      acknowledgement
    );
    await input.adapter.refetch();
    const refreshed: DailyAllocationProjection = { board: input.adapter.getBoard() };
    syncOperations(
      input.ledger,
      reconcileOptimisticOperations(
        input.ledger.getOperations(),
        input.boardKey,
        refreshed,
        new Set([operation.id])
      )
    );
    return result;
  } catch (error) {
    const isAmbiguous =
      error instanceof TypeError
      || (error instanceof DailyAllocationApiError && error.status >= 500);

    if (isAmbiguous) {
      try {
        await input.adapter.refetch();
        syncOperations(
          input.ledger,
          removeOptimisticOperation(input.ledger.getOperations(), operation.id)
        );
      } catch {
        settleOperation(
          input.ledger,
          input.adapter,
          input.boardKey,
          operation.id,
          'failure',
          error
        );
      }
      throw error;
    }

    settleOperation(
      input.ledger,
      input.adapter,
      input.boardKey,
      operation.id,
      'failure',
      error
    );
    if (isDailyAllocationStaleOrConflictError(error)) {
      await input.adapter.refetch();
    }
    throw error;
  }
}
