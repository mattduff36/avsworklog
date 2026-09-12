'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  assignDailyAllocationLabour,
  assignDailyAllocationPlant,
  convertDailyAllocationPlanDay,
  createDailyAllocationConflictOverride,
  createDailyAllocationVisit,
  DailyAllocationApiError,
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
  patchBoardWithConversionResult,
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
import {
  assignmentClaim,
  assignmentDuplicateKey,
  authorityClaim,
  planDayClaim,
  resourceDayClaim,
  visitClaim,
  visitTimesCoalesceGroup,
} from '@/components/daily-allocation/board/daily-allocation-mutation-claims';
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

type CoordinatedRequest<T extends { request_id: string }> = Omit<T, 'request_id'>;

function useBoardQueryAdapter(
  startDate: string,
  endDate: string,
  scheduleReconciliation: (keys?: readonly string[]) => void
): DailyAllocationBoardQueryAdapter {
  const queryClient = useQueryClient();
  const queryKey = dailyAllocationBoardQueryKey(startDate, endDate);
  return {
    getBoard: () => queryClient.getQueryData(queryKey),
    cancel: () => queryClient.cancelQueries({ queryKey, exact: true }),
    scheduleReconciliation,
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
  const adapter = useBoardQueryAdapter(
    boardState.startDate,
    boardState.endDate,
    boardState.scheduleReconciliation
  );
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

function requirePlanDayId(
  board: DailyAllocationRangeBoardPayload | undefined,
  entityId: string,
  collection: 'visit' | 'labour' | 'plant'
): string {
  const planDayId = collection === 'visit'
    ? board?.visits.find((item) => item.id === entityId)?.plan_day_id
    : collection === 'labour'
      ? board?.labour_assignments.find((item) => item.id === entityId)?.plan_day_id
      : board?.plant_assignments.find((item) => item.id === entityId)?.plan_day_id;
  if (planDayId) return planDayId;
  throw new DailyAllocationApiError(
    'Refresh the board before saving this change.',
    409,
    { code: 'MISSING_PLAN_CONTEXT' },
    'MISSING_PLAN_CONTEXT'
  );
}

function currentPlanVersion(
  board: DailyAllocationRangeBoardPayload | undefined,
  planDayId: string,
  fallback: number
): number {
  return board?.plan_days.find((planDay) => planDay.id === planDayId)?.plan_version ?? fallback;
}

function currentVisitRowVersion(
  board: DailyAllocationRangeBoardPayload | undefined,
  visitId: string,
  fallback: number | null | undefined
): number | null | undefined {
  return board?.visits.find((visit) => visit.id === visitId)?.row_version ?? fallback;
}

function currentLabourAssignmentRowVersion(
  board: DailyAllocationRangeBoardPayload | undefined,
  visitId: string,
  profileId: string,
  fallback: number | null | undefined
): number | null | undefined {
  return board?.labour_assignments.find(
    (assignment) => assignment.visit_id === visitId && assignment.profile_id === profileId
  )?.row_version ?? fallback;
}

function currentPlantAssignmentRowVersion(
  board: DailyAllocationRangeBoardPayload | undefined,
  visitId: string,
  plantId: string | null | undefined,
  hiredSerial: string | null | undefined,
  hiredCompany: string | null | undefined,
  fallback: number | null | undefined
): number | null | undefined {
  return board?.plant_assignments.find((assignment) => {
    if (assignment.visit_id !== visitId) return false;
    if (plantId) return assignment.plant_id === plantId;
    return assignment.hired_serial === hiredSerial && assignment.hired_company === hiredCompany;
  })?.row_version ?? fallback;
}

export function useConvertDailyAllocationPlanDay() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: CoordinatedRequest<DailyAllocationConvertInput>;
      optimisticPlanDay: DailyAllocationPlanDay;
    }) => runMutation({
      kind: 'convert',
      claims: [
        authorityClaim(input.request.team_id, input.request.work_date),
        planDayClaim(input.optimisticPlanDay.id),
      ],
      duplicateKey: `convert:${input.request.team_id}:${input.request.work_date}`,
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithPlanDay(board, input.optimisticPlanDay)
      ),
      mutate: ({ requestId }) => convertDailyAllocationPlanDay({
        ...input.request,
        request_id: requestId,
      }),
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardWithConversionResult(board, result, input.optimisticPlanDay)
        ),
        identityAliases: { [input.optimisticPlanDay.id]: result.plan_day_id },
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
      request: CoordinatedRequest<DailyAllocationVisitUpsertInput>;
      optimisticVisit: DailyAllocationVisit;
    }) => runMutation({
      kind: 'create-visit',
      claims: [
        planDayClaim(input.request.plan_day_id),
        visitClaim(input.optimisticVisit.id),
      ],
      duplicateKey: [
        'create-visit',
        input.request.plan_day_id,
        input.request.job_source_type,
        input.request.job_source_id,
        input.request.starts_at,
        input.request.ends_at,
      ].join(':'),
      identityWaitKeys: [input.request.plan_day_id].filter((id) => id.startsWith('optimistic:')),
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithVisit(board, input.optimisticVisit)
      ),
      mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
        const planDayId = resolveIdentity(input.request.plan_day_id);
        return createDailyAllocationVisit({
          ...input.request,
          request_id: requestId,
          plan_day_id: planDayId,
          expected_plan_version: currentPlanVersion(
            getPersistenceBoard(),
            planDayId,
            input.request.expected_plan_version
          ),
        });
      },
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
            base.board?.visits.some((visit) => visit.id === result.visit.id && visit.row_version >= result.visit.row_version) === true
            && base.board?.plan_days.some((planDay) => planDay.id === result.plan_day_id && planDay.plan_version >= result.plan_version) === true,
        },
        identityAliases: { [input.optimisticVisit.id]: result.visit.id },
      }),
    }),
  });
}

export function useUpdateDailyAllocationVisit() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      visitId: string;
      request: CoordinatedRequest<DailyAllocationVisitUpsertInput>;
      optimisticVisit: DailyAllocationVisit;
    }) => runMutation({
      kind: 'update-visit',
      claims: [
        planDayClaim(input.request.plan_day_id),
        visitClaim(input.visitId),
      ],
      duplicateKey: [
        'update-visit',
        input.visitId,
        input.request.starts_at,
        input.request.ends_at,
        input.request.expected_row_version ?? 'none',
      ].join(':'),
      coalesceGroup: visitTimesCoalesceGroup(input.visitId),
      identityWaitKeys: [input.request.plan_day_id, input.visitId]
        .filter((id) => id.startsWith('optimistic:')),
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithVisit(board, input.optimisticVisit)
      ),
      mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
        const visitId = resolveIdentity(input.visitId);
        const planDayId = resolveIdentity(input.request.plan_day_id);
        const board = getPersistenceBoard();
        return updateDailyAllocationVisit(visitId, {
          ...input.request,
          request_id: requestId,
          visit_id: visitId,
          plan_day_id: planDayId,
          expected_plan_version: currentPlanVersion(
            board,
            planDayId,
            input.request.expected_plan_version
          ),
          expected_row_version: currentVisitRowVersion(
            board,
            visitId,
            input.request.expected_row_version
          ),
        });
      },
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
            base.board?.visits.some((visit) => visit.id === result.visit.id && visit.row_version >= result.visit.row_version) === true
            && base.board?.plan_days.some((planDay) => planDay.id === result.plan_day_id && planDay.plan_version >= result.plan_version) === true,
        },
      }),
    }),
  });
}

export function useMoveDailyAllocationVisit() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: CoordinatedRequest<DailyAllocationVisitMoveInput>;
      optimisticVisit: DailyAllocationVisit;
      sourcePlanDayId: string;
    }) => runMutation({
      kind: 'move-visit',
      claims: [
        planDayClaim(input.sourcePlanDayId),
        planDayClaim(input.request.target_plan_day_id),
        visitClaim(input.request.visit_id),
      ],
      duplicateKey: [
        'move-visit',
        input.request.visit_id,
        input.request.target_plan_day_id,
        input.request.starts_at,
        input.request.ends_at,
        input.request.expected_row_version,
      ].join(':'),
      coalesceGroup: visitTimesCoalesceGroup(input.request.visit_id),
      identityWaitKeys: [
        input.sourcePlanDayId,
        input.request.target_plan_day_id,
        input.request.visit_id,
      ].filter((id) => id.startsWith('optimistic:')),
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithVisit(board, input.optimisticVisit)
      ),
      mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
        const visitId = resolveIdentity(input.request.visit_id);
        const sourcePlanDayId = resolveIdentity(input.sourcePlanDayId);
        const targetPlanDayId = resolveIdentity(input.request.target_plan_day_id);
        const board = getPersistenceBoard();
        return moveDailyAllocationVisit({
          ...input.request,
          request_id: requestId,
          visit_id: visitId,
          target_plan_day_id: targetPlanDayId,
          expected_source_plan_version: currentPlanVersion(
            board,
            sourcePlanDayId,
            input.request.expected_source_plan_version
          ),
          expected_target_plan_version: currentPlanVersion(
            board,
            targetPlanDayId,
            input.request.expected_target_plan_version
          ),
          expected_row_version: currentVisitRowVersion(
            board,
            visitId,
            input.request.expected_row_version
          ) ?? input.request.expected_row_version,
        });
      },
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
              && visit.row_version >= result.visit.row_version
            ) === true
            && base.board?.plan_days.some((planDay) =>
              planDay.id === result.source_plan_day_id && planDay.plan_version >= result.source_plan_version
            ) === true
            && base.board?.plan_days.some((planDay) =>
              planDay.id === result.target_plan_day_id && planDay.plan_version >= result.target_plan_version
            ) === true,
        },
      }),
    }),
  });
}

export function useDeleteDailyAllocationVisit() {
  const { boardState, boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: CoordinatedRequest<DailyAllocationVisitDeleteInput>) => {
      const planDayId = requirePlanDayId(boardState.board, input.visit_id, 'visit');
      return runMutation({
        kind: 'delete-visit',
        claims: [planDayClaim(planDayId), visitClaim(input.visit_id)],
        duplicateKey: `delete-visit:${input.visit_id}`,
        identityWaitKeys: [input.visit_id].filter((id) => id.startsWith('optimistic:')),
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardRemoveVisit(board, input.visit_id)
        ),
        mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
          const visitId = resolveIdentity(input.visit_id);
          const resolvedPlanDayId = resolveIdentity(planDayId);
          const board = getPersistenceBoard();
          return deleteDailyAllocationVisit({
            ...input,
            request_id: requestId,
            visit_id: visitId,
            expected_plan_version: currentPlanVersion(
              board,
              resolvedPlanDayId,
              input.expected_plan_version
            ),
            expected_row_version: currentVisitRowVersion(
              board,
              visitId,
              input.expected_row_version
            ) ?? input.expected_row_version,
          });
        },
        acknowledge: (result) => ({
          apply: (state) => applyIfBoard(state.board, (board) =>
            patchBoardPlanVersion(
              patchBoardRemoveVisit(board, input.visit_id),
              result.plan_day_id,
              result.plan_version
            )
          ),
          proofs: {
            [boardKey]: (base) =>
              base.board?.visits.every((visit) => visit.id !== result.visit_id) === true
              && base.board?.plan_days.some((planDay) =>
                planDay.id === result.plan_day_id
                && planDay.plan_version >= result.plan_version
              ) === true,
          },
        }),
      });
    },
  });
}

export function useAssignDailyAllocationLabour() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: CoordinatedRequest<DailyAllocationLabourAssignInput>;
      optimisticAssignment: DailyAllocationLabourAssignment;
    }) => runMutation({
      kind: 'assign-labour',
      claims: [
        planDayClaim(input.optimisticAssignment.plan_day_id),
        visitClaim(input.request.visit_id, 'shared'),
        resourceDayClaim('labour', input.request.profile_id, input.optimisticAssignment.work_date),
        assignmentClaim(input.optimisticAssignment.id),
      ],
      duplicateKey: [
        assignmentDuplicateKey('labour', input.request.profile_id, input.request.visit_id),
        input.request.expected_row_version ?? 'new',
        input.request.meeting_point ?? '',
        input.request.meet_person ?? '',
        input.request.notes ?? '',
        input.request.override_id ?? '',
      ].join(':'),
      identityWaitKeys: [input.request.visit_id, input.optimisticAssignment.plan_day_id]
        .filter((id) => id.startsWith('optimistic:')),
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithLabourAssignment(board, input.optimisticAssignment)
      ),
      mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
        const visitId = resolveIdentity(input.request.visit_id);
        const planDayId = resolveIdentity(input.optimisticAssignment.plan_day_id);
        const board = getPersistenceBoard();
        return assignDailyAllocationLabour({
          ...input.request,
          request_id: requestId,
          visit_id: visitId,
          override_id: input.request.override_id
            ? resolveIdentity(input.request.override_id)
            : input.request.override_id,
          expected_plan_version: currentPlanVersion(
            board,
            planDayId,
            input.request.expected_plan_version
          ),
          expected_row_version: currentLabourAssignmentRowVersion(
            board,
            visitId,
            input.request.profile_id,
            input.request.expected_row_version
          ),
        });
      },
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardPlanVersion(
            patchBoardWithLabourAssignment(
              board,
              result.assignment,
              input.optimisticAssignment.id
            ),
            result.plan_day_id,
            result.plan_version
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.labour_assignments.some((row) =>
              row.id === result.assignment_id
              && row.row_version >= result.assignment.row_version
            ) === true
            && base.board?.plan_days.some((planDay) =>
              planDay.id === result.plan_day_id
              && planDay.plan_version >= result.plan_version
            ) === true,
        },
        identityAliases: { [input.optimisticAssignment.id]: result.assignment_id },
      }),
    }),
  });
}

export function useUnassignDailyAllocationLabour() {
  const { boardState, boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: CoordinatedRequest<DailyAllocationAssignmentDeleteInput>) => {
      const planDayId = requirePlanDayId(boardState.board, input.assignment_id, 'labour');
      return runMutation({
        kind: 'unassign-labour',
        claims: [planDayClaim(planDayId), assignmentClaim(input.assignment_id)],
        duplicateKey: `unassign-labour:${input.assignment_id}`,
        identityWaitKeys: [input.assignment_id].filter((id) => id.startsWith('optimistic:')),
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardRemoveLabourAssignment(board, input.assignment_id)
        ),
        mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
          const assignmentId = resolveIdentity(input.assignment_id);
          const resolvedPlanDayId = resolveIdentity(planDayId);
          const assignment = getPersistenceBoard()?.labour_assignments.find(
            (item) => item.id === assignmentId
          );
          const request = {
            ...input,
            request_id: requestId,
            assignment_id: assignmentId,
            expected_plan_version: currentPlanVersion(
              getPersistenceBoard(),
              resolvedPlanDayId,
              input.expected_plan_version
            ),
            expected_row_version: assignment?.row_version ?? input.expected_row_version,
          };
          return unassignDailyAllocationLabour(assignmentId, request);
        },
        acknowledge: (result) => ({
          apply: (state) => applyIfBoard(state.board, (board) =>
            patchBoardPlanVersion(
              patchBoardRemoveLabourAssignment(board, input.assignment_id),
              result.plan_day_id,
              result.plan_version
            )
          ),
          proofs: {
            [boardKey]: (base) =>
              base.board?.labour_assignments.every((row) => row.id !== result.assignment_id) === true
              && base.board?.plan_days.some((planDay) =>
                planDay.id === result.plan_day_id
                && planDay.plan_version >= result.plan_version
              ) === true,
          },
        }),
      });
    },
  });
}

export function useAssignDailyAllocationPlant() {
  const { boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: CoordinatedRequest<DailyAllocationPlantAssignInput>;
      optimisticAssignment: DailyAllocationPlantAssignment;
    }) => runMutation({
      kind: 'assign-plant',
      claims: [
        planDayClaim(input.optimisticAssignment.plan_day_id),
        visitClaim(input.request.visit_id, 'shared'),
        resourceDayClaim(
          'plant',
          input.request.plant_id || input.request.hired_serial || input.optimisticAssignment.id,
          input.optimisticAssignment.work_date
        ),
        assignmentClaim(input.optimisticAssignment.id),
      ],
      duplicateKey: assignmentDuplicateKey(
        'plant',
        input.request.plant_id || input.request.hired_serial || input.optimisticAssignment.id,
        input.request.visit_id
      ),
      identityWaitKeys: [input.request.visit_id, input.optimisticAssignment.plan_day_id]
        .filter((id) => id.startsWith('optimistic:')),
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithPlantAssignment(board, input.optimisticAssignment)
      ),
      mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
        const visitId = resolveIdentity(input.request.visit_id);
        const planDayId = resolveIdentity(input.optimisticAssignment.plan_day_id);
        return assignDailyAllocationPlant({
          ...input.request,
          request_id: requestId,
          visit_id: visitId,
          expected_plan_version: currentPlanVersion(
            getPersistenceBoard(),
            planDayId,
            input.request.expected_plan_version
          ),
          expected_row_version: currentPlantAssignmentRowVersion(
            getPersistenceBoard(),
            visitId,
            input.request.plant_id,
            input.request.hired_serial,
            input.request.hired_company,
            input.request.expected_row_version
          ),
        });
      },
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardPlanVersion(
            patchBoardWithPlantAssignment(
              board,
              result.assignment,
              input.optimisticAssignment.id
            ),
            result.plan_day_id,
            result.plan_version
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.plant_assignments.some((row) =>
              row.id === result.assignment_id
              && row.row_version >= result.assignment.row_version
            ) === true
            && base.board?.plan_days.some((planDay) =>
              planDay.id === result.plan_day_id
              && planDay.plan_version >= result.plan_version
            ) === true,
        },
        identityAliases: { [input.optimisticAssignment.id]: result.assignment_id },
      }),
    }),
  });
}

export function useUnassignDailyAllocationPlant() {
  const { boardState, boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: CoordinatedRequest<DailyAllocationAssignmentDeleteInput>) => {
      const planDayId = requirePlanDayId(boardState.board, input.assignment_id, 'plant');
      return runMutation({
        kind: 'unassign-plant',
        claims: [planDayClaim(planDayId), assignmentClaim(input.assignment_id)],
        duplicateKey: `unassign-plant:${input.assignment_id}`,
        identityWaitKeys: [input.assignment_id].filter((id) => id.startsWith('optimistic:')),
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardRemovePlantAssignment(board, input.assignment_id)
        ),
        mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
          const assignmentId = resolveIdentity(input.assignment_id);
          const resolvedPlanDayId = resolveIdentity(planDayId);
          const board = getPersistenceBoard();
          const assignment = board?.plant_assignments.find((item) => item.id === assignmentId);
          return unassignDailyAllocationPlant(assignmentId, {
            ...input,
            request_id: requestId,
            assignment_id: assignmentId,
            expected_plan_version: currentPlanVersion(
              board,
              resolvedPlanDayId,
              input.expected_plan_version
            ),
            expected_row_version: assignment?.row_version ?? input.expected_row_version,
          });
        },
        acknowledge: (result) => ({
          apply: (state) => applyIfBoard(state.board, (board) =>
            patchBoardPlanVersion(
              patchBoardRemovePlantAssignment(board, input.assignment_id),
              result.plan_day_id,
              result.plan_version
            )
          ),
          proofs: {
            [boardKey]: (base) =>
              base.board?.plant_assignments.every((row) => row.id !== result.assignment_id) === true
              && base.board?.plan_days.some((planDay) =>
                planDay.id === result.plan_day_id
                && planDay.plan_version >= result.plan_version
              ) === true,
          },
        }),
      });
    },
  });
}

export function useCreateDailyAllocationConflictOverride() {
  const { boardState, boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: CoordinatedRequest<DailyAllocationOverrideInput>;
      optimisticOverride: DailyAllocationConflictOverride;
    }) => runMutation({
      kind: 'create-override',
      claims: [
        planDayClaim(input.request.plan_day_id),
        ...(input.request.visit_id ? [visitClaim(input.request.visit_id, 'shared')] : []),
        resourceDayClaim(
          'labour',
          input.request.profile_id,
          boardState.board?.plan_days.find((plan) => plan.id === input.request.plan_day_id)?.work_date
            || 'unknown'
        ),
        assignmentClaim(input.optimisticOverride.id),
      ],
      duplicateKey: `override:${input.request.plan_day_id}:${input.request.profile_id}:${input.request.conflict_kind}`,
      identityWaitKeys: [input.request.plan_day_id, input.request.visit_id]
        .filter((id): id is string => Boolean(id?.startsWith('optimistic:'))),
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithOverride(board, input.optimisticOverride)
      ),
      mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
        const planDayId = resolveIdentity(input.request.plan_day_id);
        return createDailyAllocationConflictOverride({
          ...input.request,
          request_id: requestId,
          plan_day_id: planDayId,
          visit_id: input.request.visit_id
            ? resolveIdentity(input.request.visit_id)
            : input.request.visit_id,
          expected_plan_version: currentPlanVersion(
            getPersistenceBoard(),
            planDayId,
            input.request.expected_plan_version
          ),
        });
      },
      acknowledge: (result) => ({
        apply: (state) => applyIfBoard(state.board, (board) =>
          patchBoardPlanVersion(
            patchBoardWithOverride(
              board,
              result.override,
              input.optimisticOverride.id
            ),
            result.plan_day_id,
            result.plan_version
          )
        ),
        proofs: {
          [boardKey]: (base) =>
            base.board?.overrides.some((row) => row.id === result.override_id) === true
            && base.board?.plan_days.some((planDay) =>
              planDay.id === result.plan_day_id
              && planDay.plan_version >= result.plan_version
            ) === true,
        },
        identityAliases: { [input.optimisticOverride.id]: result.override_id },
      }),
    }),
  });
}

export function usePublishDailyAllocationPlanV2() {
  const { boardState, boardKey, runMutation } = useOptimisticMutationRunner();
  return useMutation({
    mutationFn: async (input: {
      request: CoordinatedRequest<DailyAllocationPublishV2Input>;
      optimisticPublication: DailyAllocationPublicationMeta;
    }) => runMutation({
      kind: 'publish-v2',
      claims: [
        planDayClaim(input.request.plan_day_id),
        authorityClaim(
          boardState.board?.plan_days.find((plan) => plan.id === input.request.plan_day_id)?.team_id
            || 'unknown',
          input.optimisticPublication.work_date
        ),
      ],
      duplicateKey: `publish:${input.request.idempotency_key}`,
      identityWaitKeys: [input.request.plan_day_id].filter((id) => id.startsWith('optimistic:')),
      apply: (state) => applyIfBoard(state.board, (board) =>
        patchBoardWithPublication(board, input.optimisticPublication)
      ),
      mutate: ({ requestId, resolveIdentity, getPersistenceBoard }) => {
        const planDayId = resolveIdentity(input.request.plan_day_id);
        return publishDailyAllocationPlanV2({
          ...input.request,
          request_id: requestId,
          plan_day_id: planDayId,
          expected_plan_version: currentPlanVersion(
            getPersistenceBoard(),
            planDayId,
            input.request.expected_plan_version
          ),
        });
      },
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
        identityAliases: { [input.optimisticPublication.id]: result.publication_id },
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
