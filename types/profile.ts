import type { QuickLinkItem } from '@/lib/profile/quick-links';

export interface ProfileIdentityPayload {
  id: string;
  full_name: string;
  phone_number: string | null;
  employee_id: string | null;
  avatar_url: string | null;
  must_change_password: boolean;
  annual_holiday_allowance_days: number | null;
  super_admin: boolean;
  email: string | null;
  team: {
    id: string;
    name: string;
  } | null;
  role: {
    name: string;
    display_name: string;
    role_class: 'admin' | 'manager' | 'employee';
    is_manager_admin: boolean;
    is_super_admin: boolean;
  } | null;
}

export interface ProfileTimesheetSummaryItem {
  id: string;
  week_ending: string;
  status: string;
}

export interface ProfileInspectionSummaryItem {
  id: string;
  inspection_date: string;
  status: string;
  inspectionType: 'van' | 'plant' | 'hgv';
  href: string;
  has_reported_defect: boolean;
  has_inform_workshop_task: boolean;
}

export interface ProfileAbsenceSummaryItem {
  id: string;
  date: string;
  end_date: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason_name: string;
}

export interface ProfileAnnualLeaveSummary {
  allowance: number;
  approved_taken: number;
  pending_total: number;
  remaining: number;
}

export interface ProfileOverviewPayload {
  prd_epic_id: string;
  profile: ProfileIdentityPayload;
  can_edit_basic_fields: boolean;
  timesheets: ProfileTimesheetSummaryItem[];
  inspections: ProfileInspectionSummaryItem[];
  absences: ProfileAbsenceSummaryItem[];
  annual_leave_summary: ProfileAnnualLeaveSummary;
  quick_links: {
    recent: QuickLinkItem[];
    frequent: QuickLinkItem[];
  };
}

