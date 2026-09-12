'use client';

import { useEffect, useState } from 'react';
import type { DailyAllocationOptimisticOperation } from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import type { DailyAllocationOptimisticLedgerHandle } from '@/components/daily-allocation/board/daily-allocation-optimistic-runner';
import { DailyAllocationMutationCoordinator } from '@/components/daily-allocation/board/daily-allocation-mutation-coordinator';

class DailyAllocationLedgerBridge {
  private operations: DailyAllocationOptimisticOperation[] = [];
  private sequence = 0;

  getOperations(): DailyAllocationOptimisticOperation[] {
    return this.operations;
  }

  setOperations(operations: DailyAllocationOptimisticOperation[]): void {
    this.operations = operations;
  }

  nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }
}

export function useDailyAllocationOptimisticLedger(): DailyAllocationOptimisticLedgerHandle & {
  operations: DailyAllocationOptimisticOperation[];
} {
  const [operations, setOperationsState] = useState<DailyAllocationOptimisticOperation[]>([]);
  const [bridge] = useState(() => new DailyAllocationLedgerBridge());
  const [coordinator] = useState(() =>
    new DailyAllocationMutationCoordinator(
      (next) => {
        bridge.setOperations(next);
        setOperationsState(next);
      },
      () => bridge.nextSequence()
    )
  );

  useEffect(() => {
    coordinator.activate();
    return () => {
      coordinator.dispose();
    };
  }, [coordinator]);

  function setOperations(
    next:
      | DailyAllocationOptimisticOperation[]
      | ((current: DailyAllocationOptimisticOperation[]) => DailyAllocationOptimisticOperation[])
  ) {
    const resolved = typeof next === 'function' ? next(bridge.getOperations()) : next;
    bridge.setOperations(resolved);
    coordinator.replaceOperations(resolved);
    setOperationsState(resolved);
  }

  return {
    coordinator,
    operations,
    getOperations: () => bridge.getOperations(),
    setOperations,
    nextSequence: () => bridge.nextSequence(),
  };
}
