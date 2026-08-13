import { describe, expect, it } from 'vitest';
import {
  createOptimisticEntityId,
  operationsOverlap,
  projectDailyAllocationState,
  reconcileOptimisticOperations,
  removeOptimisticOperation,
  type DailyAllocationOptimisticOperation,
  type DailyAllocationProjection,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import {
  patchBoardWithVisit,
} from '@/components/daily-allocation/board/daily-allocation-board-cache';
import type {
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisit,
} from '@/types/daily-allocation';

const emptyProjection: DailyAllocationProjection = { board: undefined };

function boardFixture(): DailyAllocationRangeBoardPayload {
  return {
    start_date: '2026-08-10',
    end_date: '2026-08-16',
    dates: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
    context: {
      user_id: 'user-1',
      access_level: 4,
      is_manager: true,
      is_admin: false,
      team_id: 'team-1',
      team_name: 'Civils',
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

function visit(id: string, startsAt: string): DailyAllocationVisit {
  return {
    id,
    plan_day_id: 'plan-1',
    work_date: '2026-08-13',
    owner_team_id: 'team-1',
    job_source_type: 'project_number',
    job_source_id: 'job-1',
    job_code: 'J-1',
    site_address: 'Site',
    starts_at: startsAt,
    ends_at: '2026-08-13T10:00:00.000Z',
    meeting_point: null,
    meet_person: null,
    notes: null,
    row_version: 1,
    updated_at: '2026-08-13T07:00:00.000Z',
  };
}

function operation(
  id: string,
  sequence: number,
  lockKeys: string[],
  apply: DailyAllocationOptimisticOperation['apply'],
  queryKeys = ['board:2026-08-10:2026-08-16']
): DailyAllocationOptimisticOperation {
  return {
    id,
    sequence,
    kind: 'create-visit',
    status: 'pending',
    lockKeys,
    queryKeys,
    reconciledKeys: [],
    proofs: {},
    apply,
  };
}

describe('DA2-OPT-001 daily allocation optimistic ledger', () => {
  it('projects independent operations over every refreshed server base', () => {
    const addFirst = operation('one', 2, ['visit:one'], (state) => ({
      board: state.board
        ? patchBoardWithVisit(state.board, visit('one', '2026-08-13T08:00:00.000Z'))
        : state.board,
    }));
    const addSecond = operation('two', 1, ['visit:two'], (state) => ({
      board: state.board
        ? patchBoardWithVisit(state.board, visit('two', '2026-08-13T09:00:00.000Z'))
        : state.board,
    }));

    const projected = projectDailyAllocationState(
      { board: boardFixture() },
      [addFirst, addSecond],
      'board:2026-08-10:2026-08-16'
    );
    expect(projected.board?.visits.map((item) => item.id)).toEqual(['one', 'two']);

    const refreshed = projectDailyAllocationState(
      {
        board: patchBoardWithVisit(boardFixture(), visit('server', '2026-08-13T07:00:00.000Z')),
      },
      [addFirst, addSecond],
      'board:2026-08-10:2026-08-16'
    );
    expect(refreshed.board?.visits.map((item) => item.id)).toEqual(['server', 'one', 'two']);
  });

  it('rolls back one operation without removing concurrent work', () => {
    const first = operation('one', 1, ['visit:one'], (state) => ({
      board: state.board
        ? patchBoardWithVisit(state.board, visit('one', '2026-08-13T08:00:00.000Z'))
        : state.board,
    }));
    const second = operation('two', 2, ['visit:two'], (state) => ({
      board: state.board
        ? patchBoardWithVisit(state.board, visit('two', '2026-08-13T09:00:00.000Z'))
        : state.board,
    }));

    const remaining = removeOptimisticOperation([first, second], first.id);
    expect(
      projectDailyAllocationState(
        { board: boardFixture() },
        remaining,
        'board:2026-08-10:2026-08-16'
      ).board?.visits.map((item) => item.id)
    ).toEqual(['two']);
  });

  it('never projects a pending range operation onto another board range', () => {
    const weekOperation = {
      ...operation('week-a', 1, ['visit:one'], (state) => ({
        board: state.board
          ? patchBoardWithVisit(state.board, visit('one', '2026-08-13T08:00:00.000Z'))
          : state.board,
      })),
      queryKeys: ['board:2026-08-03:2026-08-09'],
    };

    const projected = projectDailyAllocationState(
      { board: boardFixture() },
      [weekOperation],
      'board:2026-08-10:2026-08-16'
    );
    expect(projected.board?.visits).toEqual([]);
  });

  it('uses explicit optimistic ids and related lock aliases', () => {
    expect(createOptimisticEntityId('operation', 'visit')).toBe('optimistic:operation:visit');
    const current = operation('one', 1, ['visit-tree:visit-1'], (state) => state);
    expect(operationsOverlap({ lockKeys: ['visit:visit-1'] }, [current])).toBe(true);
    expect(operationsOverlap({ lockKeys: ['visit:visit-2'] }, [current])).toBe(false);
    expect(operationsOverlap({ lockKeys: ['plan:plan-1'] }, [
      operation('plan', 1, ['plan-tree:plan-1'], (state) => state),
    ])).toBe(true);
  });

  it('reconciles only the eligible acknowledged operation once server proof exists', () => {
    const acknowledged: DailyAllocationOptimisticOperation = {
      ...operation('one', 1, ['visit:one'], (state) => ({
        board: state.board
          ? patchBoardWithVisit(state.board, visit('one', '2026-08-13T08:00:00.000Z'))
          : state.board,
      })),
      status: 'acknowledged',
      proofs: {
        'board:2026-08-10:2026-08-16': (base: DailyAllocationProjection) =>
          base.board?.visits.some((item) => item.id === 'one') === true,
      },
    };
    const concurrent = operation('two', 2, ['visit:two'], (state) => ({
      board: state.board
        ? patchBoardWithVisit(state.board, visit('two', '2026-08-13T09:00:00.000Z'))
        : state.board,
    }));

    const withoutProof = reconcileOptimisticOperations(
      [acknowledged, concurrent],
      'board:2026-08-10:2026-08-16',
      { board: boardFixture() },
      new Set([acknowledged.id])
    );
    expect(withoutProof.map((item) => item.id)).toEqual(['one', 'two']);

    const provedBase = {
      board: patchBoardWithVisit(boardFixture(), visit('one', '2026-08-13T08:00:00.000Z')),
    };
    const retired = reconcileOptimisticOperations(
      withoutProof,
      'board:2026-08-10:2026-08-16',
      provedBase,
      new Set([acknowledged.id])
    );
    expect(retired.map((item) => item.id)).toEqual(['two']);
  });
});

describe('optimistic projection empty base', () => {
  it('leaves an undefined board untouched', () => {
    const projected = projectDailyAllocationState(emptyProjection, [
      operation('one', 1, ['visit:one'], (state) => state),
    ]);
    expect(projected.board).toBeUndefined();
  });
});
