'use client';

import {
  createContext,
  createElement,
  useEffect,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dailyAllocationBoardOptimisticKey,
  dailyAllocationBoardQueryKey,
  fetchDailyAllocationBoardRange,
  isDailyAllocationApiError,
} from '@/lib/client/daily-allocation';
import { projectDailyAllocationBoardView } from '@/components/daily-allocation/board/daily-allocation-board-cache';
import {
  projectDailyAllocationState,
  reconcileOptimisticOperations,
  retireExhaustedOptimisticOperations,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import { DailyAllocationBoardReconciler } from '@/components/daily-allocation/board/daily-allocation-board-reconciliation';
import { useDailyAllocationOptimisticLedger } from '@/components/daily-allocation/board/hooks/use-daily-allocation-optimistic-ledger';
import { useDailyAllocationViewPreference } from '@/components/daily-allocation/board/hooks/use-daily-allocation-view-preference';
import type { DailyAllocationBoardView } from '@/lib/config/daily-allocation-view-preference';
import type { DailyAllocationRangeBoardPayload } from '@/types/daily-allocation';
import type { DailyAllocationOptimisticLedgerHandle } from '@/components/daily-allocation/board/daily-allocation-optimistic-runner';
import type { DailyAllocationOptimisticOperation } from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import type { DailyAllocationCommandOutcome } from '@/components/daily-allocation/board/daily-allocation-mutation-coordinator';

export interface DailyAllocationBoardController {
  startDate: string;
  endDate: string;
  boardKey: string;
  queryKey: readonly [string, string, string];
  board: DailyAllocationRangeBoardPayload | undefined;
  authoritativeBoard: DailyAllocationRangeBoardPayload | undefined;
  viewBoard: DailyAllocationRangeBoardPayload | undefined;
  view: DailyAllocationBoardView;
  setView: (view: DailyAllocationBoardView) => void;
  isBoardLoading: boolean;
  isBoardFetching: boolean;
  isMutationPending: boolean;
  pendingOperations: DailyAllocationOptimisticOperation[];
  boardError: unknown;
  mutationError: unknown;
  setMutationError: (error: unknown) => void;
  error: unknown;
  ledger: DailyAllocationOptimisticLedgerHandle;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  setPointerInteractionActive: (active: boolean) => void;
  scheduleReconciliation: (keys?: readonly string[]) => void;
  getOperationOutcome: (operationId: string) => DailyAllocationCommandOutcome | undefined;
  refetch: () => Promise<unknown>;
}

const DailyAllocationBoardContext = createContext<DailyAllocationBoardController | null>(null);

class DailyAllocationReconciliationBridge {
  private runCurrent: (keys: string[]) => Promise<void> = async () => undefined;
  private cancelCurrent: () => Promise<void> = async () => undefined;
  private interactionActive = false;
  private attempts = new Map<string, number>();

  configure(input: {
    run: (keys: string[]) => Promise<void>;
    cancel: () => Promise<void>;
  }): void {
    this.runCurrent = input.run;
    this.cancelCurrent = input.cancel;
  }

  run(keys: string[]): Promise<void> {
    return this.runCurrent(keys);
  }

  cancel(): Promise<void> {
    return this.cancelCurrent();
  }

  setInteractionActive(active: boolean): void {
    this.interactionActive = active;
  }

  isInteractionActive(): boolean {
    return this.interactionActive;
  }

  getAttempt(operationId: string): number {
    return this.attempts.get(operationId) || 0;
  }

  incrementAttempt(operationId: string): void {
    this.attempts.set(operationId, this.getAttempt(operationId) + 1);
  }

  clearAttempt(operationId: string): void {
    this.attempts.delete(operationId);
  }

  resetAttempts(): void {
    this.attempts.clear();
  }
}

export function useDailyAllocationBoardQuery(startDate: string, endDate: string) {
  return useQuery({
    queryKey: dailyAllocationBoardQueryKey(startDate, endDate),
    queryFn: () => fetchDailyAllocationBoardRange(startDate, endDate),
    enabled: Boolean(startDate) && Boolean(endDate),
  });
}

export function useDailyAllocationBoardController(options: {
  startDate: string;
  endDate: string;
  userId?: string;
  selectedDate?: string;
}): DailyAllocationBoardController {
  const queryClient = useQueryClient();
  const query = useDailyAllocationBoardQuery(options.startDate, options.endDate);
  const ledger = useDailyAllocationOptimisticLedger();
  const resolvedUserId = options.userId || query.data?.context.user_id || '';
  const viewPreference = useDailyAllocationViewPreference(resolvedUserId);
  const [internalSelectedDate, setInternalSelectedDate] = useState(
    () => options.selectedDate || options.startDate
  );
  const selectedDate = options.selectedDate ?? internalSelectedDate;
  const setSelectedDate = setInternalSelectedDate;
  const [mutationError, setMutationError] = useState<unknown>(null);
  const boardKey = dailyAllocationBoardOptimisticKey(options.startDate, options.endDate);
  const queryKey = dailyAllocationBoardQueryKey(options.startDate, options.endDate);
  const [reconciliationBridge] = useState(() => new DailyAllocationReconciliationBridge());
  const [reconciler] = useState(() =>
    new DailyAllocationBoardReconciler({
      delayMs: 400,
      run: (keys) => reconciliationBridge.run(keys),
      onInteractionStart: () => reconciliationBridge.cancel(),
    })
  );

  useEffect(() => {
    reconciliationBridge.configure({
      cancel: () => queryClient.cancelQueries({ queryKey, exact: true }),
      run: async (keys) => {
      if (!keys.includes(boardKey)) return;
      const eligible = new Set(
        ledger.getOperations()
          .filter((operation) =>
            operation.queryKeys.includes(boardKey)
            && operation.status !== 'pending'
            && reconciliationBridge.getAttempt(operation.id) < 3
          )
          .map((operation) => operation.id)
      );
      for (const operationId of eligible) {
        reconciliationBridge.incrementAttempt(operationId);
      }
      try {
        await queryClient.refetchQueries(
          { queryKey, exact: true, type: 'all' },
          { throwOnError: true, cancelRefetch: true }
        );
        const refreshed = queryClient.getQueryData<DailyAllocationRangeBoardPayload>(queryKey);
        const reconciled = reconcileOptimisticOperations(
          ledger.getOperations(),
          boardKey,
          { board: refreshed },
          eligible
        );
        const next = retireExhaustedOptimisticOperations(
          reconciled,
          boardKey,
          eligible,
          (operationId) => reconciliationBridge.getAttempt(operationId),
          3
        );
        const remainingIds = new Set(next.map((operation) => operation.id));
        for (const operationId of eligible) {
          if (!remainingIds.has(operationId)) reconciliationBridge.clearAttempt(operationId);
        }
        ledger.setOperations(next);
        if (next.some((operation) =>
          eligible.has(operation.id)
          && reconciliationBridge.getAttempt(operation.id) < 3
        )) {
          reconciler.schedule([boardKey]);
        }
      } catch {
        if ([...eligible].some((operationId) =>
          reconciliationBridge.getAttempt(operationId) < 3
        )) {
          reconciler.schedule([boardKey]);
        }
      }
      },
    });
  }, [
    boardKey,
    ledger,
    options.endDate,
    options.startDate,
    queryClient,
    queryKey,
    reconciliationBridge,
    reconciler,
  ]);

  useEffect(() => () => {
    reconciler.dispose();
  }, [reconciler]);
  const projected = projectDailyAllocationState(
    { board: query.data },
    ledger.operations,
    boardKey
  );
  const pendingOperations = ledger.operations.filter((operation) => operation.status === 'pending');
  const viewBoard = projected.board
    ? projectDailyAllocationBoardView(projected.board, viewPreference.view, selectedDate)
    : undefined;

  return {
    startDate: options.startDate,
    endDate: options.endDate,
    boardKey,
    queryKey,
    board: projected.board,
    authoritativeBoard: query.data,
    viewBoard,
    view: viewPreference.view,
    setView: viewPreference.setView,
    isBoardLoading: query.isPending,
    isBoardFetching: query.isFetching,
    isMutationPending: pendingOperations.length > 0,
    pendingOperations,
    boardError: query.error,
    mutationError,
    setMutationError,
    error: mutationError ?? query.error,
    ledger,
    selectedDate,
    setSelectedDate,
    setPointerInteractionActive: (active) => {
      reconciliationBridge.setInteractionActive(active);
      reconciler.setInteractionActive(active);
    },
    scheduleReconciliation: (keys = [boardKey]) => {
      reconciler.schedule(keys.filter((key) => key === boardKey));
    },
    getOperationOutcome: (operationId) => ledger.coordinator.getOutcome(operationId),
    refetch: async () => {
      if (reconciliationBridge.isInteractionActive()) {
        reconciler.schedule([boardKey]);
        return queryClient.getQueryData(queryKey);
      }
      reconciliationBridge.resetAttempts();
      const result = await query.refetch();
      reconciler.schedule([boardKey]);
      return result;
    },
  };
}

export function DailyAllocationBoardStateProvider({
  startDate,
  endDate,
  userId,
  selectedDate,
  children,
}: {
  startDate: string;
  endDate: string;
  userId?: string;
  selectedDate?: string;
  children: ReactNode;
}) {
  const controller = useDailyAllocationBoardController({
    startDate,
    endDate,
    userId,
    selectedDate,
  });

  return createElement(DailyAllocationBoardContext.Provider, { value: controller }, children);
}

export function useDailyAllocationBoard(): DailyAllocationBoardController {
  const controller = useContext(DailyAllocationBoardContext);
  if (!controller) {
    throw new Error('useDailyAllocationBoard must be used within DailyAllocationBoardStateProvider.');
  }
  return controller;
}

export function isDailyAllocationBoardError(error: unknown): boolean {
  return isDailyAllocationApiError(error);
}
