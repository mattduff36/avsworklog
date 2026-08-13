import type { DailyAllocationRangeBoardPayload } from '@/types/daily-allocation';
import { OPTIMISTIC_ENTITY_PREFIX } from '@/lib/client/daily-allocation';

export interface DailyAllocationProjection {
  board: DailyAllocationRangeBoardPayload | undefined;
}

export type DailyAllocationOptimisticStatus = 'pending' | 'acknowledged' | 'uncertain';

export type DailyAllocationOptimisticKind =
  | 'convert'
  | 'create-visit'
  | 'update-visit'
  | 'delete-visit'
  | 'assign-labour'
  | 'unassign-labour'
  | 'assign-plant'
  | 'unassign-plant'
  | 'create-override'
  | 'publish-v2';

export interface DailyAllocationOptimisticOperation {
  id: string;
  sequence: number;
  kind: DailyAllocationOptimisticKind | string;
  status: DailyAllocationOptimisticStatus;
  lockKeys: string[];
  queryKeys: string[];
  reconciledKeys: string[];
  proofs: Record<string, (base: DailyAllocationProjection) => boolean>;
  apply: (state: DailyAllocationProjection) => DailyAllocationProjection;
}

export function createOptimisticEntityId(operationId: string, entityKind: string): string {
  return `${OPTIMISTIC_ENTITY_PREFIX}${operationId}:${entityKind}`;
}

export function isOptimisticEntityId(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith(OPTIMISTIC_ENTITY_PREFIX));
}

export function projectDailyAllocationState(
  base: DailyAllocationProjection,
  operations: DailyAllocationOptimisticOperation[],
  activeBoardKey?: string
): DailyAllocationProjection {
  return [...operations]
    .sort((left, right) => left.sequence - right.sequence)
    .reduce((state, operation) => {
      const applied = operation.apply(state);
      const shouldApply = (key: string) => operation.proofs[key]?.(base) !== true;
      return {
        board:
          activeBoardKey
          && operation.queryKeys.includes(activeBoardKey)
          && shouldApply(activeBoardKey)
            ? applied.board
            : state.board,
      };
    }, base);
}

function splitLockKey(key: string): { kind: string; id: string } {
  const separator = key.indexOf(':');
  return separator === -1
    ? { kind: key, id: '' }
    : { kind: key.slice(0, separator), id: key.slice(separator + 1) };
}

function lockKeysConflict(left: string, right: string): boolean {
  if (left === right) return true;
  const a = splitLockKey(left);
  const b = splitLockKey(right);
  if (a.id !== b.id || !a.id) return false;
  const relatedKinds: Record<string, string[]> = {
    plan: ['plan-tree'],
    'plan-tree': ['plan'],
    visit: ['visit-tree'],
    'visit-tree': ['visit'],
  };
  return relatedKinds[a.kind]?.includes(b.kind) === true;
}

export function operationsOverlap(
  operation: Pick<DailyAllocationOptimisticOperation, 'lockKeys'>,
  operations: DailyAllocationOptimisticOperation[]
): boolean {
  const requested = operation.lockKeys;
  return operations.some((current) =>
    current.lockKeys.some((currentKey) =>
      requested.some((requestedKey) => lockKeysConflict(currentKey, requestedKey))
    )
  );
}

export function replaceOptimisticOperation(
  operations: DailyAllocationOptimisticOperation[],
  operationId: string,
  replacement:
    | DailyAllocationOptimisticOperation
    | ((current: DailyAllocationOptimisticOperation) => DailyAllocationOptimisticOperation)
): DailyAllocationOptimisticOperation[] {
  return operations.map((operation) => {
    if (operation.id !== operationId) return operation;
    return typeof replacement === 'function' ? replacement(operation) : replacement;
  });
}

export function removeOptimisticOperation(
  operations: DailyAllocationOptimisticOperation[],
  operationId: string
): DailyAllocationOptimisticOperation[] {
  return operations.filter((operation) => operation.id !== operationId);
}

export function reconcileOptimisticOperations(
  operations: DailyAllocationOptimisticOperation[],
  key: string,
  base: DailyAllocationProjection,
  eligibleOperationIds: ReadonlySet<string>
): DailyAllocationOptimisticOperation[] {
  return operations
    .map((operation) =>
      eligibleOperationIds.has(operation.id) && operation.proofs[key]?.(base) === true
        ? {
            ...operation,
            reconciledKeys: operation.reconciledKeys.includes(key)
              ? operation.reconciledKeys
              : [...operation.reconciledKeys, key],
          }
        : operation
    )
    .filter((operation) =>
      operation.status === 'pending'
      || operation.queryKeys.some((queryKey) => !operation.reconciledKeys.includes(queryKey))
    );
}
