/** @vitest-environment happy-dom */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import {
  dailyAllocationBoardQueryKey,
} from '@/lib/client/daily-allocation';
import type { DailyAllocationRangeBoardPayload } from '@/types/daily-allocation';
import { useDailyAllocationBoardController } from '@/components/daily-allocation/board/hooks/use-daily-allocation-board';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('@/lib/client/daily-allocation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/daily-allocation')>();
  return {
    ...actual,
    fetchDailyAllocationBoardRange: (startDate: string, endDate: string) => mocks.fetch(startDate, endDate),
  };
});

type IdleTask = { id: number; callback: IdleRequestCallback };

function board(startDate: string, endDate: string): DailyAllocationRangeBoardPayload {
  return {
    start_date: startDate,
    end_date: endDate,
    dates: [startDate],
    context: {
      user_id: 'manager-1',
      access_level: 5,
      is_manager: true,
      is_admin: true,
      team_id: 'team-1',
      team_name: 'Team One',
    },
    plan_days: [],
    visits: [],
    labour_assignments: [],
    plant_assignments: [],
    overrides: [],
    conflicts: [],
    legacy: { labour: [], plant: [] },
    jobs: [],
    resources: { employees: [], plant: [], teams: [] },
    publications: [],
  };
}

function adjacentRanges(startDate: string, endDate: string) {
  const span = differenceInCalendarDays(parseISO(endDate), parseISO(startDate));
  const nextStart = format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd');
  const nextEnd = format(addDays(parseISO(nextStart), span), 'yyyy-MM-dd');
  const previousEnd = format(addDays(parseISO(startDate), -1), 'yyyy-MM-dd');
  const previousStart = format(addDays(parseISO(previousEnd), -span), 'yyyy-MM-dd');
  return { nextStart, nextEnd, previousStart, previousEnd };
}

describe('daily allocation adjacent prefetch', () => {
  let idleTasks: IdleTask[];
  let nextIdleId: number;
  let queryClient: QueryClient;
  const resolvers: Array<(value: DailyAllocationRangeBoardPayload) => void> = [];

  function calls() {
    return mocks.fetch.mock.calls.map((call) => [call[0], call[1]] as [string, string]);
  }

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  async function settleCurrent(startDate: string, endDate: string) {
    await waitFor(() => {
      expect(calls().some(([start, end]) => start === startDate && end === endDate)).toBe(true);
    });
    const index = calls().findIndex(([start, end]) => start === startDate && end === endDate);
    await act(async () => {
      resolvers[index]?.(board(startDate, endDate));
    });
  }

  beforeEach(() => {
    idleTasks = [];
    nextIdleId = 1;
    resolvers.length = 0;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.fetch.mockReset();
    mocks.fetch.mockImplementation((startDate: string, endDate: string) => new Promise((resolve) => {
      resolvers.push(resolve);
      void startDate;
      void endDate;
    }));
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      const id = nextIdleId;
      nextIdleId += 1;
      idleTasks.push({ id, callback });
      return id;
    });
    vi.stubGlobal('cancelIdleCallback', (id: number) => {
      idleTasks = idleTasks.filter((task) => task.id !== id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  async function flushIdle() {
    const tasks = idleTasks.splice(0);
    await act(async () => {
      for (const task of tasks) {
        task.callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      }
    });
  }

  it('prefetches adjacent weeks only after the current board succeeds and the idle callback runs', async () => {
    const startDate = '2026-08-10';
    const endDate = '2026-08-16';
    const { result } = renderHook(
      () => useDailyAllocationBoardController({ startDate, endDate, selectedDate: startDate }),
      { wrapper },
    );

    await waitFor(() => expect(calls()).toEqual([[startDate, endDate]]));
    expect(idleTasks).toHaveLength(0);
    expect(result.current.queryKey).toEqual(dailyAllocationBoardQueryKey(startDate, endDate));

    await settleCurrent(startDate, endDate);
    await waitFor(() => expect(result.current.isBoardFetching).toBe(false));
    await waitFor(() => expect(idleTasks).toHaveLength(1));
    expect(calls()).toEqual([[startDate, endDate]]);

    await flushIdle();
    const neighbors = adjacentRanges(startDate, endDate);
    await waitFor(() => expect(calls()).toEqual([
      [startDate, endDate],
      [neighbors.nextStart, neighbors.nextEnd],
      [neighbors.previousStart, neighbors.previousEnd],
    ]));
  });

  it('cancels a scheduled prefetch when the week changes or the board unmounts', async () => {
    const first = { startDate: '2026-08-10', endDate: '2026-08-16' };
    const second = { startDate: '2026-08-17', endDate: '2026-08-23' };
    const { rerender, unmount } = renderHook(
      ({ startDate, endDate }: { startDate: string; endDate: string }) => useDailyAllocationBoardController({
        startDate,
        endDate,
        selectedDate: startDate,
      }),
      { wrapper, initialProps: first },
    );

    await settleCurrent(first.startDate, first.endDate);
    await waitFor(() => expect(idleTasks).toHaveLength(1));
    rerender(second);
    expect(idleTasks).toHaveLength(0);

    await settleCurrent(second.startDate, second.endDate);
    await waitFor(() => expect(idleTasks).toHaveLength(1));
    unmount();
    expect(idleTasks).toHaveLength(0);
    await flushIdle();

    const firstNeighbors = adjacentRanges(first.startDate, first.endDate);
    const secondNeighbors = adjacentRanges(second.startDate, second.endDate);
    expect(calls()).toEqual([
      [first.startDate, first.endDate],
      [second.startDate, second.endDate],
    ]);
    expect(calls()).not.toContainEqual([firstNeighbors.previousStart, firstNeighbors.previousEnd]);
    expect(calls()).not.toContainEqual([secondNeighbors.nextStart, secondNeighbors.nextEnd]);
  });

  it('ignores an idle callback after auth invalidation and schedules fresh scope data separately', async () => {
    const startDate = '2026-08-10', endDate = '2026-08-16';
    const view = renderHook(() => useDailyAllocationBoardController({ startDate, endDate }), { wrapper });
    await settleCurrent(startDate, endDate);
    await waitFor(() => expect(idleTasks.length).toBe(1));
    const obsolete = idleTasks[0];
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: dailyAllocationBoardQueryKey(startDate, endDate) });
      obsolete.callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    });
    expect(calls()).toEqual([[startDate, endDate], [startDate, endDate]]);
    const changed = board(startDate, endDate);
    changed.context.team_id = 'new-team';
    await act(async () => { resolvers[1](changed); });
    await waitFor(() => expect(idleTasks.length).toBe(1));
    await flushIdle();
    expect(calls()).toHaveLength(4);
    view.unmount();
  });

  it('waits through pointer interaction and schedules neighbours after it ends', async () => {
    const startDate = '2026-08-10', endDate = '2026-08-16';
    const view = renderHook(() => useDailyAllocationBoardController({ startDate, endDate }), { wrapper });
    await settleCurrent(startDate, endDate);
    await waitFor(() => expect(idleTasks.length).toBe(1));
    const obsolete = idleTasks[0];
    act(() => view.result.current.setPointerInteractionActive(true));
    await act(async () => { obsolete.callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline); });
    expect(calls()).toEqual([[startDate, endDate]]);
    expect(idleTasks).toHaveLength(0);
    act(() => view.result.current.setPointerInteractionActive(false));
    await waitFor(() => expect(idleTasks.length).toBe(1));
    await flushIdle();
    expect(calls()).toHaveLength(3);
    view.unmount();
  });

  it('uses a short timeout when requestIdleCallback is unavailable', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const startDate = '2026-08-10';
    const endDate = '2026-08-16';
    renderHook(
      () => useDailyAllocationBoardController({ startDate, endDate, selectedDate: startDate }),
      { wrapper },
    );
    await settleCurrent(startDate, endDate);
    const neighbors = adjacentRanges(startDate, endDate);
    await waitFor(() => expect(calls()).toEqual([
      [startDate, endDate],
      [neighbors.nextStart, neighbors.nextEnd],
      [neighbors.previousStart, neighbors.previousEnd],
    ]));
  });

  it('keeps the current optimistic projection when neighbor prefetch resolves', async () => {
    const startDate = '2026-08-10';
    const endDate = '2026-08-16';
    const { result } = renderHook(
      () => useDailyAllocationBoardController({ startDate, endDate, selectedDate: startDate }),
      { wrapper },
    );
    await settleCurrent(startDate, endDate);
    await waitFor(() => expect(result.current.authoritativeBoard?.dates).toEqual([startDate]));

    act(() => {
      const boardKey = result.current.boardKey;
      result.current.ledger.setOperations([{
        id: 'op-1',
        sequence: 1,
        kind: 'update-visit',
        status: 'pending',
        lockKeys: [],
        queryKeys: [boardKey],
        reconciledKeys: [],
        proofs: { [boardKey]: () => false },
        apply: (state) => ({
          board: state.board ? { ...state.board, dates: ['patched'] } : state.board,
        }),
      }]);
    });
    expect(result.current.board?.dates).toEqual(['patched']);

    await waitFor(() => expect(idleTasks).toHaveLength(1));
    await flushIdle();
    await waitFor(() => expect(calls()).toHaveLength(3));
    const neighbors = adjacentRanges(startDate, endDate);
    await act(async () => {
      resolvers[1]?.(board(neighbors.nextStart, neighbors.nextEnd));
      resolvers[2]?.(board(neighbors.previousStart, neighbors.previousEnd));
    });

    expect(result.current.board?.dates).toEqual(['patched']);
    expect(queryClient.getQueryData<DailyAllocationRangeBoardPayload>(
      dailyAllocationBoardQueryKey(startDate, endDate),
    )?.dates).toEqual([startDate]);
  });
});
