export interface TimesheetEntry {
  id?: string;
  timesheet_id: string;
  day_of_week: number; // 1-7 (Monday-Sunday)
  time_started: string | null;
  time_finished: string | null;
  working_in_yard: boolean;
  daily_total: number | null; // Hours (e.g., 8.5)
  remarks: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Timesheet {
  id: string;
  user_id: string;
  reg_number: string | null;
  week_ending: string; // Date string (Sunday of the week)
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  signature_data: string | null;
  signed_at: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  manager_comments: string | null;
  created_at: string;
  updated_at: string;
  entries?: TimesheetEntry[];
}

export interface TimesheetFormData {
  reg_number: string;
  week_ending: Date;
  entries: {
    [key: number]: { // day_of_week as key
      time_started: string;
      time_finished: string;
      working_in_yard: boolean;
      remarks: string;
    };
  };
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

