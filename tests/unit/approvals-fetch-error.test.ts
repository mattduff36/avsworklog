import { describe, expect, it } from 'vitest';
import {
  APPROVALS_FETCH_ERROR_CONTEXT_ID,
  APPROVALS_FETCH_FAILURE_MESSAGE,
  approvalsFetchFailureContext,
  markApprovalsFetchFailure,
} from '@/lib/utils/approvals-fetch-error';

describe('approvals fetch failure context', () => {
  it('keeps the request stage and database code, details, and hint', () => {
    const error = {
      message: 'Bad Request',
      code: 'PGRST100',
      details: 'unexpected filter on absences',
      hint: 'check the or filter',
    };

    const marked = markApprovalsFetchFailure('absences', error);
    const context = approvalsFetchFailureContext(marked);

    expect(marked).toBe(error);
    expect(error.message).toBe('Bad Request');
    expect(context).toEqual({
      errorContextId: APPROVALS_FETCH_ERROR_CONTEXT_ID,
      stage: 'absences',
      code: 'PGRST100',
      details: 'unexpected filter on absences',
      hint: 'check the or filter',
    });
    expect(context).not.toHaveProperty('message');
    expect(context).not.toHaveProperty('name');
    expect(context).not.toHaveProperty('stack');
  });

  it.each(['timesheet-headers', 'timesheet-entries', 'absences'] as const)(
    'names the %s request without changing its message',
    (stage) => {
      const error = new Error('Bad Request');
      markApprovalsFetchFailure(stage, error);

      expect(error.message).toBe('Bad Request');
      expect(approvalsFetchFailureContext(error).stage).toBe(stage);
    }
  );

  it('keeps the visible approvals failure message', () => {
    expect(APPROVALS_FETCH_FAILURE_MESSAGE).toBe('Failed to load approvals');
    expect(APPROVALS_FETCH_ERROR_CONTEXT_ID).toBe('approvals-fetch-list-error');
  });

  it('returns empty database fields when the failure has no stage or PostgREST details', () => {
    expect(approvalsFetchFailureContext(new Error('Bad Request'))).toEqual({
      errorContextId: APPROVALS_FETCH_ERROR_CONTEXT_ID,
      stage: null,
      code: null,
      details: null,
      hint: null,
    });
  });
});
