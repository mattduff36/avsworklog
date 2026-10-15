export const APPROVALS_FETCH_FAILURE_MESSAGE = 'Failed to load approvals';
export const APPROVALS_FETCH_ERROR_CONTEXT_ID = 'approvals-fetch-list-error';

const APPROVALS_FETCH_STAGES = ['timesheet-headers', 'timesheet-entries', 'absences'] as const;
const APPROVALS_FETCH_STAGE_KEY = 'approvalsFetchStage';

export type ApprovalsFetchStage = (typeof APPROVALS_FETCH_STAGES)[number];

export interface ApprovalsFetchFailureContext {
  errorContextId: typeof APPROVALS_FETCH_ERROR_CONTEXT_ID;
  stage: ApprovalsFetchStage | null;
  code: string | null;
  details: string | null;
  hint: string | null;
}

function isApprovalsFetchStage(value: unknown): value is ApprovalsFetchStage {
  return APPROVALS_FETCH_STAGES.some((stage) => stage === value);
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function markApprovalsFetchFailure(stage: ApprovalsFetchStage, error: unknown): unknown {
  if (error && typeof error === 'object') {
    Object.assign(error, { [APPROVALS_FETCH_STAGE_KEY]: stage });
  }
  return error;
}

export function approvalsFetchFailureContext(error: unknown): ApprovalsFetchFailureContext {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const stage = record[APPROVALS_FETCH_STAGE_KEY];

  return {
    errorContextId: APPROVALS_FETCH_ERROR_CONTEXT_ID,
    stage: isApprovalsFetchStage(stage) ? stage : null,
    code: readText(record.code),
    details: readText(record.details),
    hint: readText(record.hint),
  };
}
