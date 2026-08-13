'use client';

import {
  createContext,
  createElement,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  dailyAllocationBoardOptimisticKey,
  dailyAllocationBoardQueryKey,
  fetchDailyAllocationBoardRange,
  isDailyAllocationApiError,
} from '@/lib/client/daily-allocation';
import { projectDailyAllocationBoardView } from '@/components/daily-allocation/board/daily-allocation-board-cache';
import { projectDailyAllocationState } from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import { useDailyAllocationOptimisticLedger } from '@/components/daily-allocation/board/hooks/use-daily-allocation-optimistic-ledger';
import { useDailyAllocationViewPreference } from '@/components/daily-allocation/board/hooks/use-daily-allocation-view-preference';
import type { DailyAllocationBoardView } from '@/lib/config/daily-allocation-view-preference';
import type { DailyAllocationRangeBoardPayload } from '@/types/daily-allocation';
import type { DailyAllocationOptimisticLedgerHandle } from '@/components/daily-allocation/board/daily-allocation-optimistic-runner';
import type { DailyAllocationOptimisticOperation } from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';

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
  refetch: () => Promise<unknown>;
}

const DailyAllocationBoardContext = createContext<DailyAllocationBoardController | null>(null);

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
    refetch: () => query.refetch(),
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
