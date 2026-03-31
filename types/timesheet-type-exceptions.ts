export const TIMESHEET_EXCEPTION_ALLOWED_TYPES = ['civils', 'plant'] as const;

export type TimesheetExceptionType = (typeof TIMESHEET_EXCEPTION_ALLOWED_TYPES)[number];

export interface TimesheetTypeExceptionUserRow {
  profile_id: string;
  full_name: string;
  employee_id: string | null;
  role_name: string | null;
  role_display_name: string | null;
  team_id: string | null;
  team_name: string | null;
  team_timesheet_type: TimesheetExceptionType;
  default_timesheet_type: TimesheetExceptionType;
  override_timesheet_type: TimesheetExceptionType | null;
  effective_timesheet_type: TimesheetExceptionType;
  has_exception_row: boolean;
}

export interface TimesheetTypeExceptionMatrixResponse {
  rows: TimesheetTypeExceptionUserRow[];
}

export function normalizeTimesheetExceptionType(value: unknown): TimesheetExceptionType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'civils' || normalized === 'plant') return normalized;
  return null;
}
