import { DailyAllocationApiError } from '@/lib/client/daily-allocation';
import {
  isOptimisticEntityId,
  splitDailyAllocationLockKey,
  type DailyAllocationOptimisticOperation,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import {
  claimsConflict,
  claimsToLockKeys,
  type DailyAllocationMutationClaim,
} from '@/components/daily-allocation/board/daily-allocation-mutation-claims';

export type DailyAllocationCommandOutcome = 'success' | 'failed' | 'uncertain';

export interface DailyAllocationPersistSuccess<T> {
  result: T;
  proofs?: DailyAllocationOptimisticOperation['proofs'];
  apply?: DailyAllocationOptimisticOperation['apply'];
  identityAliases?: Record<string, string>;
}

export interface DailyAllocationCoordinatorOperation extends DailyAllocationOptimisticOperation {
  claims: DailyAllocationMutationClaim[];
  requestId: string;
  executionStatus: 'queued' | 'executing' | 'awaiting-retry' | 'completed';
  retryCount: number;
}

export interface DailyAllocationPersistContext {
  operationId: string;
  requestId: string;
  resolveIdentity: (id: string) => string;
}

export interface AdmitDailyAllocationCommandInput<T> {
  id?: string;
  kind: string;
  claims: DailyAllocationMutationClaim[];
  duplicateKey?: string;
  coalesceGroup?: string;
  dependsOn?: string[];
  identityWaitKeys?: string[];
  retryAmbiguous?: boolean;
  queryKeys: string[];
  proofs?: DailyAllocationOptimisticOperation['proofs'];
  apply: DailyAllocationOptimisticOperation['apply'];
  persist: (
    context: DailyAllocationPersistContext
  ) => Promise<DailyAllocationPersistSuccess<T>>;
}

export interface AdmitDailyAllocationCommandResult<T> {
  operation: DailyAllocationCoordinatorOperation;
  completion: Promise<T>;
  duplicate: boolean;
  coalesced: boolean;
}

interface DeferredResult {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

type PersistCommand = (
  context: DailyAllocationPersistContext
) => Promise<DailyAllocationPersistSuccess<unknown>>;

const RETRY_DELAYS_MS = [250, 500, 1000];
const MAX_AMBIGUOUS_RETRIES = RETRY_DELAYS_MS.length;

export function isAmbiguousDailyAllocationFailure(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof DailyAllocationApiError && error.status >= 500);
}

export function rewriteDailyAllocationIdentity(
  value: string,
  aliases: ReadonlyMap<string, string>
): string {
  let current = value;
  const seen = new Set<string>();
  while (aliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = aliases.get(current)!;
  }
  return current;
}

export function rewriteDailyAllocationKey(
  key: string,
  aliases: ReadonlyMap<string, string>
): string {
  const { kind, id } = splitDailyAllocationLockKey(key);
  if (!id) return rewriteDailyAllocationIdentity(key, aliases);
  const resolved = rewriteDailyAllocationIdentity(id, aliases);
  return resolved === id ? key : `${kind}:${resolved}`;
}

function createDeferred(): DeferredResult {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function isActive(operation: DailyAllocationCoordinatorOperation): boolean {
  return operation.executionStatus !== 'completed';
}

export class DailyAllocationMutationCoordinator {
  private operations: DailyAllocationCoordinatorOperation[] = [];
  private persistById = new Map<string, PersistCommand>();
  private completionById = new Map<string, DeferredResult>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private aliases = new Map<string, string>();
  private outcomes = new Map<string, DailyAllocationCommandOutcome>();
  private sequence = 0;
  private disposed = false;

  constructor(
    private readonly onChange: (operations: DailyAllocationCoordinatorOperation[]) => void,
    private readonly nextSequence: () => number = () => ++this.sequence
  ) {}

  getOperations(): DailyAllocationCoordinatorOperation[] {
    return this.operations.slice();
  }

  getOutcome(operationId: string): DailyAllocationCommandOutcome | undefined {
    return this.outcomes.get(operationId);
  }

  resolveIdentity(id: string): string {
    return rewriteDailyAllocationIdentity(id, this.aliases);
  }

  findIdentityProducer(identity: string): DailyAllocationCoordinatorOperation | undefined {
    const resolved = this.resolveIdentity(identity);
    return this.operations.find((operation) =>
      isActive(operation)
      && operation.claims.some((claim) =>
        claim.id === identity || this.resolveIdentity(claim.id) === resolved
      )
    );
  }

  activate(): void {
    this.disposed = false;
  }

  replaceOperations(operations: DailyAllocationOptimisticOperation[]): void {
    const retainedIds = new Set(operations.map((operation) => operation.id));
    for (const [operationId, timer] of this.retryTimers) {
      if (!retainedIds.has(operationId)) {
        clearTimeout(timer);
        this.retryTimers.delete(operationId);
      }
    }
    this.operations = operations.map((operation) => {
      const current = this.operations.find((item) => item.id === operation.id);
      return {
        ...operation,
        claims: operation.claims || current?.claims || [],
        requestId: operation.requestId || current?.requestId || crypto.randomUUID(),
        executionStatus: operation.executionStatus || current?.executionStatus || 'queued',
        retryCount: operation.retryCount ?? current?.retryCount ?? 0,
      };
    });
    for (const operationId of this.persistById.keys()) {
      if (!retainedIds.has(operationId)) this.persistById.delete(operationId);
    }
  }

  admit<T>(
    input: AdmitDailyAllocationCommandInput<T>
  ): AdmitDailyAllocationCommandResult<T> {
    if (this.disposed) throw new Error('Daily allocation coordinator is disposed.');
    const claims = input.claims.map((claim) => ({
      ...claim,
      id: this.resolveIdentity(claim.id),
    }));
    const duplicateKey = input.duplicateKey
      ? rewriteDailyAllocationKey(input.duplicateKey, this.aliases)
      : undefined;
    const coalesceGroup = input.coalesceGroup
      ? rewriteDailyAllocationKey(input.coalesceGroup, this.aliases)
      : undefined;
    const identityWaitKeys = input.identityWaitKeys?.map((id) => this.resolveIdentity(id));

    if (duplicateKey) {
      const duplicate = this.operations.find(
        (operation) => isActive(operation) && operation.duplicateKey === duplicateKey
      );
      if (duplicate) {
        return {
          operation: duplicate,
          completion: this.completionById.get(duplicate.id)!.promise as Promise<T>,
          duplicate: true,
          coalesced: false,
        };
      }
    }

    if (coalesceGroup) {
      const existing = this.operations.find(
        (operation) =>
          isActive(operation)
          && operation.executionStatus === 'queued'
          && operation.coalesceGroup === coalesceGroup
      );
      if (existing) {
        existing.kind = input.kind;
        existing.claims = claims;
        existing.lockKeys = claimsToLockKeys(claims);
        existing.queryKeys = input.queryKeys;
        existing.proofs = input.proofs || {};
        existing.apply = input.apply;
        existing.dependsOn = input.dependsOn;
        existing.identityWaitKeys = identityWaitKeys;
        this.persistById.set(existing.id, input.persist as PersistCommand);
        this.emit();
        this.kickSoon();
        return {
          operation: existing,
          completion: this.completionById.get(existing.id)!.promise as Promise<T>,
          duplicate: false,
          coalesced: true,
        };
      }
    }

    const operation: DailyAllocationCoordinatorOperation = {
      id: input.id || crypto.randomUUID(),
      sequence: this.nextSequence(),
      kind: input.kind,
      status: 'pending',
      lockKeys: claimsToLockKeys(claims),
      claims,
      requestId: crypto.randomUUID(),
      duplicateKey,
      coalesceGroup,
      dependsOn: input.dependsOn,
      identityWaitKeys,
      executionStatus: 'queued',
      retryCount: 0,
      queryKeys: input.queryKeys,
      reconciledKeys: [],
      proofs: input.proofs || {},
      apply: input.apply,
    };
    const completion = createDeferred();
    this.operations = [...this.operations, operation];
    this.persistById.set(operation.id, input.persist as PersistCommand);
    this.completionById.set(operation.id, completion);
    this.emit();
    this.kickSoon();
    return {
      operation,
      completion: completion.promise as Promise<T>,
      duplicate: false,
      coalesced: false,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.persistById.clear();
    this.operations = [];
  }

  private holders(candidate: DailyAllocationCoordinatorOperation): DailyAllocationCoordinatorOperation[] {
    return this.operations.filter((operation) =>
      operation.id !== candidate.id
      && (
        operation.status === 'uncertain'
        || operation.executionStatus === 'executing'
        || operation.executionStatus === 'awaiting-retry'
        || (operation.executionStatus === 'queued' && operation.sequence < candidate.sequence)
      )
    );
  }

  private dependencyOutcome(operationId: string): DailyAllocationCommandOutcome | 'pending' {
    const outcome = this.outcomes.get(operationId);
    if (outcome) return outcome;
    return this.operations.some((operation) => operation.id === operationId)
      ? 'pending'
      : 'failed';
  }

  private kickSoon(): void {
    queueMicrotask(() => this.kick());
  }

  private kick(): void {
    if (this.disposed) return;
    for (const operation of [...this.operations].sort((a, b) => a.sequence - b.sequence)) {
      if (operation.executionStatus !== 'queued') continue;
      const dependencies = (operation.dependsOn || []).map((id) => this.dependencyOutcome(id));
      if (dependencies.includes('failed') || dependencies.includes('uncertain')) {
        this.fail(operation, new DailyAllocationApiError(
          'A required earlier daily allocation change did not complete.',
          409,
          { code: 'DEPENDENCY_FAILED' },
          'DEPENDENCY_FAILED'
        ));
        continue;
      }
      if (dependencies.some((outcome) => outcome !== 'success')) continue;
      if ((operation.identityWaitKeys || []).some((id) =>
        isOptimisticEntityId(this.resolveIdentity(id))
      )) continue;
      if (this.holders(operation).some((holder) =>
        claimsConflict(operation.claims, holder.claims)
      )) continue;
      void this.execute(operation);
    }
  }

  private async execute(operation: DailyAllocationCoordinatorOperation): Promise<void> {
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live || live.executionStatus !== 'queued' || this.disposed) return;
    live.executionStatus = 'executing';
    this.emit();
    try {
      const persist = this.persistById.get(live.id);
      if (!persist) throw new Error('Daily allocation persistence command is unavailable.');
      const success = await persist({
        operationId: live.id,
        requestId: live.requestId,
        resolveIdentity: (id) => this.resolveIdentity(id),
      });
      if (!this.disposed) this.succeed(live, success);
    } catch (error) {
      if (this.disposed) return;
      if (isAmbiguousDailyAllocationFailure(error) && live.retryCount < MAX_AMBIGUOUS_RETRIES) {
        this.retry(live);
      } else if (isAmbiguousDailyAllocationFailure(error)) {
        this.markUncertain(live, error);
      } else {
        this.fail(live, error);
      }
    } finally {
      this.kick();
    }
  }

  private succeed(
    operation: DailyAllocationCoordinatorOperation,
    success: DailyAllocationPersistSuccess<unknown>
  ): void {
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live) return;
    live.status = 'acknowledged';
    live.executionStatus = 'completed';
    if (success.proofs) live.proofs = success.proofs;
    if (success.apply) live.apply = success.apply;
    this.outcomes.set(live.id, 'success');
    this.applyAliases(success.identityAliases || {});
    this.persistById.delete(live.id);
    this.emit();
    this.completionById.get(live.id)?.resolve(success.result);
    this.completionById.delete(live.id);
  }

  private retry(operation: DailyAllocationCoordinatorOperation): void {
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live) return;
    live.status = 'uncertain';
    live.executionStatus = 'awaiting-retry';
    live.retryCount += 1;
    const delay = RETRY_DELAYS_MS[live.retryCount - 1]!;
    const timer = setTimeout(() => {
      this.retryTimers.delete(live.id);
      const current = this.operations.find((item) => item.id === live.id);
      if (!current || this.disposed) return;
      current.status = 'pending';
      current.executionStatus = 'queued';
      this.emit();
      this.kick();
    }, delay);
    this.retryTimers.set(live.id, timer);
    this.emit();
  }

  private markUncertain(
    operation: DailyAllocationCoordinatorOperation,
    cause: unknown
  ): void {
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live) return;
    live.status = 'uncertain';
    live.executionStatus = 'completed';
    this.outcomes.set(live.id, 'uncertain');
    this.persistById.delete(live.id);
    this.emit();
    this.completionById.get(live.id)?.reject(new DailyAllocationApiError(
      'The save result is uncertain. The board is reconciling with the server.',
      503,
      { code: 'UNCERTAIN_OUTCOME', cause: cause instanceof Error ? cause.message : String(cause) },
      'UNCERTAIN_OUTCOME'
    ));
    this.completionById.delete(live.id);
  }

  private fail(operation: DailyAllocationCoordinatorOperation, error: unknown): void {
    const live = this.operations.find((item) => item.id === operation.id);
    if (!live) return;
    const timer = this.retryTimers.get(live.id);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(live.id);
    this.persistById.delete(live.id);
    this.outcomes.set(live.id, 'failed');
    this.operations = this.operations.filter((item) => item.id !== live.id);
    this.emit();
    this.completionById.get(live.id)?.reject(error);
    this.completionById.delete(live.id);
  }

  private applyAliases(aliases: Record<string, string>): void {
    for (const [from, to] of Object.entries(aliases)) {
      if (from && to && from !== to) this.aliases.set(from, to);
    }
    for (const operation of this.operations) {
      if (operation.executionStatus === 'executing') continue;
      operation.claims = operation.claims.map((claim) => ({
        ...claim,
        id: rewriteDailyAllocationIdentity(claim.id, this.aliases),
      }));
      operation.lockKeys = operation.lockKeys.map((key) =>
        rewriteDailyAllocationKey(key, this.aliases)
      );
      if (operation.coalesceGroup) {
        operation.coalesceGroup = rewriteDailyAllocationKey(operation.coalesceGroup, this.aliases);
      }
      if (operation.duplicateKey) {
        operation.duplicateKey = rewriteDailyAllocationKey(operation.duplicateKey, this.aliases);
      }
      if (operation.identityWaitKeys) {
        operation.identityWaitKeys = operation.identityWaitKeys.map((id) =>
          rewriteDailyAllocationIdentity(id, this.aliases)
        );
      }
    }
  }

  private emit(): void {
    this.onChange(this.getOperations());
  }
}
