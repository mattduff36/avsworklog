import { isDailyAllocationStaleOrConflictError } from '@/lib/client/daily-allocation';
import {
  projectDailyAllocationState,
  type DailyAllocationOptimisticKind,
  type DailyAllocationOptimisticOperation,
  type DailyAllocationProjection,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import type { DailyAllocationMutationClaim } from '@/components/daily-allocation/board/daily-allocation-mutation-claims';
import {
  DailyAllocationMutationCoordinator,
  type DailyAllocationPersistContext,
} from '@/components/daily-allocation/board/daily-allocation-mutation-coordinator';

export interface DailyAllocationBoardQueryAdapter {
  getBoard(): DailyAllocationProjection['board'];
  cancel(): Promise<void> | void;
  scheduleReconciliation(keys: readonly string[]): void;
}

export interface DailyAllocationOptimisticLedgerHandle {
  coordinator: DailyAllocationMutationCoordinator;
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
  claims: DailyAllocationMutationClaim[];
  duplicateKey?: string;
  coalesceGroup?: string;
  dependsOn?: string[];
  identityWaitKeys?: string[];
  apply: DailyAllocationOptimisticOperation['apply'];
  proofs?: DailyAllocationOptimisticOperation['proofs'];
  mutate: (context: DailyAllocationMutationContext) => Promise<T>;
  acknowledge?: (result: T) => {
    apply?: DailyAllocationOptimisticOperation['apply'];
    proofs?: DailyAllocationOptimisticOperation['proofs'];
    identityAliases?: Record<string, string>;
  };
  operationId?: string;
}

export interface DailyAllocationMutationContext extends DailyAllocationPersistContext {
  getPersistenceBoard(): DailyAllocationProjection['board'];
}

function getPersistenceBoard(
  ledger: DailyAllocationOptimisticLedgerHandle,
  adapter: DailyAllocationBoardQueryAdapter,
  boardKey: string,
  operationId: string
): DailyAllocationProjection['board'] {
  const current = ledger.getOperations();
  const operation = current.find((item) => item.id === operationId);
  const predecessors = operation
    ? current.filter((item) => item.sequence < operation.sequence)
    : current;
  return projectDailyAllocationState(
    { board: adapter.getBoard() },
    predecessors,
    boardKey
  ).board;
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
  const inferredDependencies = (input.identityWaitKeys || [])
    .map((identity) => input.ledger.coordinator.findIdentityProducer(identity)?.id)
    .filter((id): id is string => Boolean(id));
  const admission = input.ledger.coordinator.admit({
    id: input.operationId,
    kind: input.kind,
    claims: input.claims,
    duplicateKey: input.duplicateKey,
    coalesceGroup: input.coalesceGroup,
    dependsOn: Array.from(new Set([...(input.dependsOn || []), ...inferredDependencies])),
    identityWaitKeys: input.identityWaitKeys,
    queryKeys: [input.boardKey],
    proofs: input.proofs,
    apply: input.apply,
    persist: async (context) => {
      await input.adapter.cancel();
      const result = await input.mutate({
        ...context,
        getPersistenceBoard: () => getPersistenceBoard(
          input.ledger,
          input.adapter,
          input.boardKey,
          context.operationId
        ),
      });
      const acknowledgement = input.acknowledge?.(result);
      return {
        result,
        apply: acknowledgement?.apply,
        proofs: acknowledgement?.proofs,
        identityAliases: acknowledgement?.identityAliases,
      };
    },
  });

  try {
    const result = await admission.completion;
    input.adapter.scheduleReconciliation([input.boardKey]);
    return result;
  } catch (error) {
    input.adapter.scheduleReconciliation([input.boardKey]);
    if (isDailyAllocationStaleOrConflictError(error)) {
      input.adapter.scheduleReconciliation([input.boardKey]);
    }
    throw error;
  }
}
