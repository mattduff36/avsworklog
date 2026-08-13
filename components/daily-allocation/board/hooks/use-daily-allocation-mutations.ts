'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  assignDailyAllocationLabour,
  assignDailyAllocationPlant,
  convertDailyAllocationPlanDay,
  createDailyAllocationConflictOverride,
  createDailyAllocationVisit,
  dailyAllocationBoardOptimisticKey,
  dailyAllocationBoardQueryKey,
  deleteDailyAllocationVisit,
  moveDailyAllocationVisit,
  publishDailyAllocationPlanV2,
  unassignDailyAllocationLabour,
  unassignDailyAllocationPlant,
  updateDailyAllocationVisit,
} from '@/lib/client/daily-allocation';
import { createOptimisticEntityId } from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import {
  patchBoardPlanVersion,
  patchBoardRemoveLabourAssignment,
  patchBoardRemovePlantAssignment,
  patchBoardRemoveVisit,
  patchBoardWithLabourAssignment,
  patchBoardWithOverride,
  patchBoardWithPlanDay,
  patchBoardWithPlantAssignment,
  patchBoardWithPublication,
  patchBoardWithVisit,
} from '@/components/daily-allocation/board/daily-allocation-board-cache';
import {
  runDailyAllocationOptimisticMutation,
  type DailyAllocationBoardQueryAdapter,
  type RunDailyAllocationOptimisticMutationInput,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-runner';
import { useDailyAllocationBoard } from '@/components/daily-allocation/board/hooks/use-daily-allocation-board';
import type { DailyAllocationRangeBoardPayload } from '@/types/daily-allocation';
import type {
  DailyAllocationAssignmentDeleteInput,
  DailyAllocationConvertInput,
  DailyAllocationLabourAssignInput,
  DailyAllocationLabourAssignment,
  DailyAllocationOverrideInput,
  DailyAllocationPlanDay,
  DailyAllocationPlantAssignInput,
  DailyAllocationPlantAssignment,
  DailyAllocationPublicationMeta,
  DailyAllocationPublishV2Input,
  DailyAllocationVisit,
  DailyAllocationVisitDeleteInput,
  DailyAllocationVisitMoveInput,
  DailyAllocationVisitUpsertInput,
  DailyAllocationConflictOverride,
} from '@/types/daily-allocation';

function useBoardQueryAdapter(
  startDate: string,
  endDate: string
): DailyAllocationBoardQueryAdapter {
  const queryClient = useQueryClient();
  const queryKey = dailyAllocationBoardQueryKey(startDate, endDate);
  return {
    getBoard: () => queryClient.getQueryData(queryKey),
    cancel: () => queryClient.cancelQueries({ queryKey, exact: true }),
    refetch: async () => {
      await queryClient.refetchQueries({ queryKey, exact: true, type: 'all' });
      return queryClient.getQueryData(queryKey);
    },
  };
}

function applyIfBoard(
  board: DailyAllocationRangeBoardPayload | undefined,
  patch: (current: DailyAllocationRangeBoardPayload) => DailyAllocationRangeBoardPayload
) {
  return { board: board ? patch(board) : board };
}

function useOptimisticMutationRunner() {
  const boardState = useDailyAllocationBoard();
  const adapter = useBoardQueryAdapter(boardState.startDate, boardState.endDate);
  const boardKey = dailyAllocationBoardOptimisticKey(boardState.startDate, boardState.endDate);

  function runMutation<T>(
    input: Omit<
      RunDailyAllocationOptimisticMutationInput<T>,
      'ledger' | 'adapter' | 'boardKey'
    >
  ): Promise<T> {
    boardState.setMutationError(null);
    return runDailyAllocationOptimisticMutation({
      ledger: boardState.ledger,
      adapter,
      boardKey,
      ...input,
    }).catch((error: unknown) => {
      boardState.setMutationError(error);
      throw error;
    });
  }

  return { boardState, boardKey, runMutation };
}

export function useConvertDailyAllocationPlanDay() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: DailyAllocationConvertInput;
      optimisticPlanDay: DailyAllocationPlanDay;
    }) => runMutation({
      kind: 'convert',
      lockKeys: [`date:${input.request.work_date}`, `plan-tree:${input.optimisticPlanDay.id}`],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithPlanDay(board, input.optimisticPlanDay)
      ),
      mutate: () => convertDailyAllocationPlanDay(input.request),
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardWithPlanDay(
            board,
            {
              ...input.optimisticPlanDay,
              id: result.plan_day_id,
              plan_version: result.plan_version,
              team_id: result.team_id,
              work_date: result.work_date,
            },
            input.optimisticPlanDay.id
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.plan_days.some((planDay) => planDay.id === result.plan_day_id) === true,
        },
      }),
    }),
  });
}

export function useCreateDailyAllocationVisit() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: DailyAllocationVisitUpsertInput;
      optimisticVisit: DailyAllocationVisit;
    }) => runMutation({
      kind: 'create-visit',
      lockKeys: [
        `plan:${input.request.plan_day_id}`,
        `visit-tree:${input.optimisticVisit.id}`,
      ],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithVisit(board, input.optimisticVisit)
      ),
      mutate: () => createDailyAllocationVisit(input.request),
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardPlanVersion(
            patchBoardWithVisit(
              board,
              { ...result.visit },
              input.optimisticVisit.id
            ),
            result.plan_day_id,
            result.plan_version
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.visits.some((visit) => visit.id === result.visit.id && visit.row_version === result.visit.row_version) === true
            && base.board?.plan_days.some((planDay) => planDay.id === result.plan_day_id && planDay.plan_version === result.plan_version) === true,
        },
      }),
    }),
  });
}

export function useUpdateDailyAllocationVisit() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      visitId: string;
      request: DailyAllocationVisitUpsertInput;
      optimisticVisit: DailyAllocationVisit;
    }) => runMutation({
      kind: 'update-visit',
      lockKeys: [
        `plan:${input.request.plan_day_id}`,
        `visit:${input.visitId}`,
        `visit-tree:${input.visitId}`,
      ],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithVisit(board, input.optimisticVisit)
      ),
      mutate: () => updateDailyAllocationVisit(input.visitId, input.request),
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardPlanVersion(
            patchBoardWithVisit(board, result.visit, input.visitId),
            result.plan_day_id,
            result.plan_version
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.visits.some((visit) => visit.id === result.visit.id && visit.row_version === result.visit.row_version) === true
            && base.board?.plan_days.some((planDay) => planDay.id === result.plan_day_id && planDay.plan_version === result.plan_version) === true,
        },
      }),
    }),
  });
}

export function useMoveDailyAllocationVisit() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: DailyAllocationVisitMoveInput;
      optimisticVisit: DailyAllocationVisit;
      sourcePlanDayId: string;
    }) => runMutation({
      kind: 'move-visit',
      lockKeys: [
        `plan:${input.sourcePlanDayId}`,
        `plan:${input.request.target_plan_day_id}`,
        `visit:${input.request.visit_id}`,
        `visit-tree:${input.request.visit_id}`,
      ],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithVisit(board, input.optimisticVisit)
      ),
      mutate: () => moveDailyAllocationVisit(input.request),
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardPlanVersion(
            patchBoardPlanVersion(
              patchBoardWithVisit(board, result.visit, input.request.visit_id),
              result.source_plan_day_id,
              result.source_plan_version
            ),
            result.target_plan_day_id,
            result.target_plan_version
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.visits.some((visit) =>
              visit.id === result.visit.id
              && visit.plan_day_id === result.visit.plan_day_id
              && visit.row_version === result.visit.row_version
            ) === true
            && base.board?.plan_days.some((planDay) =>
              planDay.id === result.source_plan_day_id && planDay.plan_version === result.source_plan_version
            ) === true
            && base.board?.plan_days.some((planDay) =>
              planDay.id === result.target_plan_day_id && planDay.plan_version === result.target_plan_version
            ) === true,
        },
      }),
    }),
  });
}

export function useDeleteDailyAllocationVisit() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: DailyAllocationVisitDeleteInput) => runMutation({
      kind: 'delete-visit',
      lockKeys: [`visit:${input.visit_id}`, `visit-tree:${input.visit_id}`],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardRemoveVisit(board, input.visit_id)
      ),
      mutate: () => deleteDailyAllocationVisit(input),
      acknowledge: () => ({
        proofs: {
          [boardKey]: (base) =>
            base.board?.visits.every((visit) => visit.id !== input.visit_id) === true,
        },
      }),
    }),
  });
}

export function useAssignDailyAllocationLabour() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: DailyAllocationLabourAssignInput;
      optimisticAssignment: DailyAllocationLabourAssignment;
    }) => runMutation({
      kind: 'assign-labour',
      lockKeys: [
        `visit-tree:${input.request.visit_id}`,
        `profile:${input.request.profile_id}`,
        `labour:${input.optimisticAssignment.id}`,
      ],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithLabourAssignment(board, input.optimisticAssignment)
      ),
      mutate: () => assignDailyAllocationLabour(input.request),
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardWithLabourAssignment(
            board,
            { ...input.optimisticAssignment, id: result.assignment_id },
            input.optimisticAssignment.id
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.labour_assignments.some((row) => row.id === result.assignment_id) === true,
        },
      }),
    }),
  });
}

export function useUnassignDailyAllocationLabour() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: DailyAllocationAssignmentDeleteInput) => runMutation({
      kind: 'unassign-labour',
      lockKeys: [`labour:${input.assignment_id}`],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardRemoveLabourAssignment(board, input.assignment_id)
      ),
      mutate: () => unassignDailyAllocationLabour(input.assignment_id, input),
      acknowledge: () => ({
        proofs: {
          [boardKey]: (base) =>
            base.board?.labour_assignments.every((row) => row.id !== input.assignment_id) === true,
        },
      }),
    }),
  });
}

export function useAssignDailyAllocationPlant() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: DailyAllocationPlantAssignInput;
      optimisticAssignment: DailyAllocationPlantAssignment;
    }) => runMutation({
      kind: 'assign-plant',
      lockKeys: [
        `visit-tree:${input.request.visit_id}`,
        `plant:${input.optimisticAssignment.id}`,
      ],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithPlantAssignment(board, input.optimisticAssignment)
      ),
      mutate: () => assignDailyAllocationPlant(input.request),
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardWithPlantAssignment(
            board,
            { ...input.optimisticAssignment, id: result.assignment_id },
            input.optimisticAssignment.id
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.plant_assignments.some((row) => row.id === result.assignment_id) === true,
        },
      }),
    }),
  });
}

export function useUnassignDailyAllocationPlant() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: DailyAllocationAssignmentDeleteInput) => runMutation({
      kind: 'unassign-plant',
      lockKeys: [`plant:${input.assignment_id}`],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardRemovePlantAssignment(board, input.assignment_id)
      ),
      mutate: () => unassignDailyAllocationPlant(input.assignment_id, input),
      acknowledge: () => ({
        proofs: {
          [boardKey]: (base) =>
            base.board?.plant_assignments.every((row) => row.id !== input.assignment_id) === true,
        },
      }),
    }),
  });
}

export function useCreateDailyAllocationConflictOverride() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: DailyAllocationOverrideInput;
      optimisticOverride: DailyAllocationConflictOverride;
    }) => runMutation({
      kind: 'create-override',
      lockKeys: [
        `plan:${input.request.plan_day_id}`,
        `profile:${input.request.profile_id}`,
        `override:${input.optimisticOverride.id}`,
      ],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithOverride(board, input.optimisticOverride)
      ),
      mutate: () => createDailyAllocationConflictOverride(input.request),
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardWithOverride(
            board,
            { ...input.optimisticOverride, id: result.override_id },
            input.optimisticOverride.id
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.overrides.some((row) => row.id === result.override_id) === true,
        },
      }),
    }),
  });
}

export function usePublishDailyAllocationPlanV2() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: DailyAllocationPublishV2Input;
      optimisticPublication: DailyAllocationPublicationMeta;
    }) => runMutation({
      kind: 'publish-v2',
      lockKeys: [`plan:${input.request.plan_day_id}`, `plan-tree:${input.request.plan_day_id}`],
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithPublication(board, input.optimisticPublication)
      ),
      mutate: () => publishDailyAllocationPlanV2(input.request),
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardWithPublication(
            board,
            { ...input.optimisticPublication, id: result.publication_id },
            input.optimisticPublication.id
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.publications.some((row) => row.id === result.publication_id) === true,
        },
      }),
    }),
  });
}

export function useDailyAllocationBoardMutations() {
  const boardState = useDailyAllocationBoard();
  const convert = useConvertDailyAllocationPlanDay();
  const createVisit = useCreateDailyAllocationVisit();
  const updateVisit = useUpdateDailyAllocationVisit();
  const moveVisit = useMoveDailyAllocationVisit();
  const removeVisit = useDeleteDailyAllocationVisit();
  const assignLabour = useAssignDailyAllocationLabour();
  const unassignLabour = useUnassignDailyAllocationLabour();
  const assignPlant = useAssignDailyAllocationPlant();
  const unassignPlant = useUnassignDailyAllocationPlant();
  const createOverride = useCreateDailyAllocationConflictOverride();
  const publishV2 = usePublishDailyAllocationPlanV2();
  const mutations = [
    convert,
    createVisit,
    updateVisit,
    moveVisit,
    removeVisit,
    assignLabour,
    unassignLabour,
    assignPlant,
    unassignPlant,
    createOverride,
    publishV2,
  ];

  return {
    convert,
    createVisit,
    updateVisit,
    moveVisit,
    removeVisit,
    assignLabour,
    unassignLabour,
    assignPlant,
    unassignPlant,
    createOverride,
    publishV2,
    isPending: mutations.some((mutation) => mutation.isPending) || boardState.isMutationPending,
    error: boardState.mutationError ?? mutations.find((mutation) => mutation.error)?.error ?? null,
  };
}

export { createOptimisticEntityId };
