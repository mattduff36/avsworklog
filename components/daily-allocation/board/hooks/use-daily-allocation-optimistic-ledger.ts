'use client';

import { useRef, useState } from 'react';
import type { DailyAllocationOptimisticOperation } from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import type { DailyAllocationOptimisticLedgerHandle } from '@/components/daily-allocation/board/daily-allocation-optimistic-runner';

export function useDailyAllocationOptimisticLedger(): DailyAllocationOptimisticLedgerHandle & {
  operations: DailyAllocationOptimisticOperation[];
} {
  const [operations, setOperationsState] = useState<DailyAllocationOptimisticOperation[]>([]);
  const operationsRef = useRef(operations);
  const sequenceRef = useRef(0);

  function setOperations(
    next:
      | DailyAllocationOptimisticOperation[]
      | ((current: DailyAllocationOptimisticOperation[]) => DailyAllocationOptimisticOperation[])
  ) {
    const resolved = typeof next === 'function' ? next(operationsRef.current) : next;
    operationsRef.current = resolved;
    setOperationsState(resolved);
  }

  return {
    operations,
    getOperations: () => operationsRef.current,
    setOperations,
    nextSequence: () => {
      sequenceRef.current += 1;
      return sequenceRef.current;
    },
  };
}
