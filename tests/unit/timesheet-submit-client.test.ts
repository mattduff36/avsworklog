import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TimesheetSubmitRequestError,
  getTimesheetSubmitErrorDiagnostics,
  logTimesheetSubmitFailure,
  submitTimesheet,
  type TimesheetSubmitRequest,
} from '@/lib/client/timesheet-submit';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TIMESHEET_ID = '22222222-2222-4222-8222-222222222222';
const SIGNATURE = `data:image/png;base64,${'A'.repeat(40)}`;

function validRequest(): TimesheetSubmitRequest {
  return {
    userId: USER_ID,
    weekEnding: '2026-09-06',
    timesheetType: 'civils',
    templateVersion: 1,
    regNumber: '  AB12 CDE  ',
    signatureData: SIGNATURE,
    entries: Array.from({ length: 7 }, (_, index) => ({
      day_of_week: index + 1,
      time_started: index === 6 ? null : '08:00',
      time_finished: index === 6 ? null : '17:00',
      did_not_work: index === 6,
      daily_total: index === 6 ? 9 : 9,
      remarks: index === 6 ? 'Annual Leave' : null,
      job_numbers: index === 6 ? [] : ['JOB-1'],
    })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('timesheet submit client', () => {
  it('TS-SUBMIT-SHARED-001 validates strictly before fetch and sends parsed data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: TIMESHEET_ID, status: 'submitted' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitTimesheet(validRequest())).resolves.toEqual({
      id: TIMESHEET_ID,
      status: 'submitted',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      regNumber: string;
      signatureData: string;
    };
    expect(requestBody.regNumber).toBe('AB12 CDE');
    expect(requestBody.signatureData).toBe(SIGNATURE);

    const sensitiveKey = 'private_field_do_not_log';
    const sensitiveValue = 'private_value_do_not_log';
    const invalid = {
      ...validRequest(),
      [sensitiveKey]: sensitiveValue,
    } as TimesheetSubmitRequest;
    const invalidResult = submitTimesheet(invalid);
    await expect(invalidResult).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      reason: 'CLIENT_SCHEMA_VALIDATION',
      issues: [expect.objectContaining({
        code: 'unrecognized_keys',
        message: 'Unexpected field',
      })],
    });
    await invalidResult.catch((error: unknown) => {
      const serialized = JSON.stringify(getTimesheetSubmitErrorDiagnostics(error));
      expect(serialized).not.toContain(sensitiveKey);
      expect(serialized).not.toContain(sensitiveValue);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TS-SUBMIT-LOG-001 emits exactly one sanitized diagnostic without request values', () => {
    const error = new TimesheetSubmitRequestError(
      'Invalid timesheet submit payload',
      400,
      'INVALID_INPUT',
      'SCHEMA_VALIDATION',
      [{ path: ['entries', 0, 'daily_total'], message: 'Invalid field type', code: 'invalid_type' }]
    );
    const logger = vi.fn();

    const diagnostics = getTimesheetSubmitErrorDiagnostics(error);
    expect(diagnostics).toEqual({
      name: 'TimesheetSubmitRequestError',
      status: 400,
      code: 'INVALID_INPUT',
      reason: 'SCHEMA_VALIDATION',
      issues: [{ path: ['entries', 0, 'daily_total'], message: 'Invalid field type', code: 'invalid_type' }],
    });
    logTimesheetSubmitFailure(error, logger);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith('Error saving timesheet:', diagnostics);
    expect(JSON.stringify(diagnostics)).not.toContain(SIGNATURE);
    expect(JSON.stringify(diagnostics)).not.toContain(USER_ID);
  });
});
