/**
 * Client helpers for timesheet quick-approve races on /approvals.
 */

const ALREADY_APPROVED_CONFLICT =
  /^Timesheet cannot be approved from status ["']approved["']\.?$/i;

export function isAlreadyApprovedConflict(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim();
  return ALREADY_APPROVED_CONFLICT.test(message);
}

export interface ApprovalInFlightGuard {
  tryBegin: (id: string) => boolean;
  end: (id: string) => void;
  has: (id: string) => boolean;
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workerCount = Math.max(1, Math.min(limit, queue.length || 1));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) return;
        await worker(item);
      }
    })
  );
}

export function createApprovalInFlightGuard(
  store: Set<string> = new Set()
): ApprovalInFlightGuard {
  return {
    tryBegin(id: string): boolean {
      if (store.has(id)) return false;
      store.add(id);
      return true;
    },
    end(id: string): void {
      store.delete(id);
    },
    has(id: string): boolean {
      return store.has(id);
    },
  };
}
