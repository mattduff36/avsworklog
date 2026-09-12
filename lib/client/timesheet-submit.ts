import {
  TimesheetSubmitBodySchema,
  getTimesheetSubmitValidationIssues,
  type TimesheetSubmitBodyInput,
  type TimesheetSubmitValidationIssue,
} from '@/lib/validation/timesheet-submit';

export type TimesheetSubmitEntryInput = TimesheetSubmitBodyInput['entries'][number];
export type TimesheetSubmitRequest = TimesheetSubmitBodyInput;

export type TimesheetSubmitFailureReason =
  | 'CLIENT_SCHEMA_VALIDATION'
  | 'MALFORMED_JSON'
  | 'SCHEMA_VALIDATION'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_LOOKUP_FAILED'
  | 'REQUEST_FAILED';

export interface TimesheetSubmitResponse {
  id: string;
  status: 'submitted';
}

export class TimesheetSubmitRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason: TimesheetSubmitFailureReason;
  readonly issues: TimesheetSubmitValidationIssue[];

  constructor(
    message: string,
    status: number,
    code: string,
    reason: TimesheetSubmitFailureReason = 'REQUEST_FAILED',
    issues: TimesheetSubmitValidationIssue[] = []
  ) {
    super(message);
    this.name = 'TimesheetSubmitRequestError';
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.issues = issues;
  }
}

export function getTimesheetSubmitErrorDiagnostics(error: unknown): Record<string, unknown> {
  if (error instanceof TimesheetSubmitRequestError) {
    return {
      name: error.name,
      status: error.status,
      code: error.code,
      reason: error.reason,
      issues: error.issues,
    };
  }

  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }

  return { name: 'UnknownError' };
}

export function logTimesheetSubmitFailure(
  error: unknown,
  logger: (message: string, diagnostics: Record<string, unknown>) => void = console.error
): void {
  logger('Error saving timesheet:', getTimesheetSubmitErrorDiagnostics(error));
}

export async function submitTimesheet(
  payload: TimesheetSubmitRequest
): Promise<TimesheetSubmitResponse> {
  const parsed = TimesheetSubmitBodySchema.safeParse(payload);
  if (!parsed.success) {
    throw new TimesheetSubmitRequestError(
      'Invalid timesheet submit payload',
      400,
      'INVALID_INPUT',
      'CLIENT_SCHEMA_VALIDATION',
      getTimesheetSubmitValidationIssues(parsed.error)
    );
  }

  const response = await fetch('/api/timesheets/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });

  const body = (await response.json().catch(() => null)) as
    | (Partial<TimesheetSubmitResponse> & {
        error?: string;
        code?: string;
        reason?: TimesheetSubmitFailureReason;
        issues?: TimesheetSubmitValidationIssue[];
      })
    | null;

  if (!response.ok || !body?.id) {
    throw new TimesheetSubmitRequestError(
      body?.error || 'Failed to submit timesheet',
      response.status,
      body?.code || 'SAVE_FAILED',
      body?.reason || 'REQUEST_FAILED',
      body?.issues || []
    );
  }

  return {
    id: body.id,
    status: 'submitted',
  };
}
