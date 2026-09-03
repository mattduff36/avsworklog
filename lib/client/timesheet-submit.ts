export interface TimesheetSubmitEntryInput {
  day_of_week: number;
  time_started?: string | null;
  time_finished?: string | null;
  operator_travel_hours?: number | null;
  operator_yard_hours?: number | null;
  operator_working_hours?: number | null;
  machine_travel_hours?: number | null;
  machine_start_time?: string | null;
  machine_finish_time?: string | null;
  machine_working_hours?: number | null;
  machine_standing_hours?: number | null;
  machine_operator_hours?: number | null;
  maintenance_breakdown_hours?: number | null;
  job_number?: string | null;
  job_numbers?: string[] | null;
  did_not_work?: boolean | null;
  working_in_yard?: boolean | null;
  subsistence_payment_required?: boolean | null;
  daily_total?: number | null;
  night_shift?: boolean | null;
  bank_holiday?: boolean | null;
  remarks?: string | null;
}

export interface TimesheetSubmitRequest {
  timesheetId?: string | null;
  userId: string;
  weekEnding: string;
  timesheetType: 'civils' | 'plant';
  templateVersion?: 1 | 2;
  regNumber?: string | null;
  siteAddress?: string | null;
  hirerName?: string | null;
  isHiredPlant?: boolean | null;
  hiredPlantIdSerial?: string | null;
  hiredPlantDescription?: string | null;
  hiredPlantHiringCompany?: string | null;
  signatureData: string;
  entries: TimesheetSubmitEntryInput[];
}

export interface TimesheetSubmitResponse {
  id: string;
  status: 'submitted';
}

export class TimesheetSubmitRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'TimesheetSubmitRequestError';
    this.status = status;
    this.code = code;
  }
}

export async function submitTimesheet(
  payload: TimesheetSubmitRequest
): Promise<TimesheetSubmitResponse> {
  const response = await fetch('/api/timesheets/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as
    | (Partial<TimesheetSubmitResponse> & { error?: string; code?: string })
    | null;

  if (!response.ok || !body?.id) {
    throw new TimesheetSubmitRequestError(
      body?.error || 'Failed to submit timesheet',
      response.status,
      body?.code || 'SAVE_FAILED'
    );
  }

  return {
    id: body.id,
    status: 'submitted',
  };
}
