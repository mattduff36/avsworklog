export const WORK_SHIFT_DAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export const WORK_SHIFT_DAY_LABELS: Record<(typeof WORK_SHIFT_DAY_ORDER)[number], string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

export type WorkShiftDayKey = (typeof WORK_SHIFT_DAY_ORDER)[number];
export type WorkShiftSession = 'AM' | 'PM';
export type WorkShiftCellKey = `${WorkShiftDayKey}_${Lowercase<WorkShiftSession>}`;

export interface WorkShiftPattern {
  monday_am: boolean;
  monday_pm: boolean;
  tuesday_am: boolean;
  tuesday_pm: boolean;
  wednesday_am: boolean;
  wednesday_pm: boolean;
  thursday_am: boolean;
  thursday_pm: boolean;
  friday_am: boolean;
  friday_pm: boolean;
  saturday_am: boolean;
  saturday_pm: boolean;
  sunday_am: boolean;
  sunday_pm: boolean;
}

export interface WorkShiftTemplate {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  pattern: WorkShiftPattern;
}

export interface EmployeeWorkShiftRow {
  id: string;
  profile_id: string;
  full_name: string;
  employee_id: string | null;
  template_id: string | null;
  template_name: string | null;
  updated_at: string;
  pattern: WorkShiftPattern;
}

export interface WorkShiftMatrixResponse {
  success: boolean;
  templates: WorkShiftTemplate[];
  employees: EmployeeWorkShiftRow[];
}

export interface CurrentWorkShiftResponse {
  success: boolean;
  templateId: string | null;
  templateName: string | null;
  pattern: WorkShiftPattern;
}

export interface CreateWorkShiftTemplateRequest {
  name: string;
  description?: string | null;
  pattern: WorkShiftPattern;
}

export interface UpdateWorkShiftTemplateRequest {
  name?: string;
  description?: string | null;
  is_default?: boolean;
  pattern?: WorkShiftPattern;
}

export interface UpdateEmployeeWorkShiftRequest {
  templateId?: string | null;
  pattern: WorkShiftPattern;
}

export interface ApplyWorkShiftTemplateRequest {
  templateId: string;
  profileIds?: string[];
  mode?: 'all' | 'selected';
}
