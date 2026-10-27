import type { TimesheetStatus } from '@/types/timesheet';

export const TIMESHEET_LIST_SELECT =
  'id, user_id, week_ending, status, reg_number, submitted_at, manager_comments, profile:profiles!timesheets_user_id_fkey(full_name, employee_id, team_id)' as const;

export interface TimesheetListProfile {
  full_name: string;
  employee_id?: string | null;
  team_id?: string | null;
}

export interface TimesheetListRow {
  id: string;
  user_id: string;
  week_ending: string;
  status: TimesheetStatus;
  reg_number: string | null;
  submitted_at: string | null;
  manager_comments: string | null;
  profile?: TimesheetListProfile | null;
}

export type TimesheetListDeleteTarget = Pick<TimesheetListRow, 'id' | 'week_ending'>;
