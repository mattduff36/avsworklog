import type { QuickLinkItem } from '@/lib/profile/quick-links';
import type { ModuleName, PermissionAccessLevel } from '@/types/roles';

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
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  secondary_emergency_contact_name: string | null;
  secondary_emergency_contact_phone: string | null;
  secondary_emergency_contact_relationship: string | null;
  employer_profile_notes: string | null;
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

export interface ProfileManagerSummary {
  id: string;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  source: 'line_manager' | 'secondary_manager' | 'team_manager';
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
  status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled';
  reason_name: string;
}

export interface ProfileAnnualLeaveSummary {
  allowance: number;
  approved_taken: number;
  pending_total: number;
  remaining: number;
}

export interface ProfileProjectAssignmentSummaryItem {
  id: string;
  document_id: string;
  title: string;
  document_type_name: string | null;
  required_signature: boolean;
  status: 'pending' | 'read' | 'signed';
  assigned_at: string | null;
  signed_at: string | null;
}

export interface ProfilePermissionSummaryItem {
  module_name: ModuleName;
  display_name: string;
  description: string;
  access_level: PermissionAccessLevel;
  access_label: string;
  requires_sensitive_pin: boolean;
}

export interface ProfileHelpArticleSummaryItem {
  id: string;
  title: string;
  summary: string | null;
  category_name: string;
  category_slug: string;
  module_name: ModuleName | null;
}

export interface ProfileOverviewPayload {
  prd_epic_id: string;
  profile: ProfileIdentityPayload;
  can_edit_basic_fields: boolean;
  managers: ProfileManagerSummary[];
  timesheets: ProfileTimesheetSummaryItem[];
  inspections: ProfileInspectionSummaryItem[];
  absences: ProfileAbsenceSummaryItem[];
  annual_leave_summary: ProfileAnnualLeaveSummary;
  project_assignments: ProfileProjectAssignmentSummaryItem[];
  permission_summary: {
    effective_team_name: string | null;
    has_sensitive_module_access: boolean;
    modules: ProfilePermissionSummaryItem[];
  };
  help_articles: ProfileHelpArticleSummaryItem[];
  quick_links: {
    recent: QuickLinkItem[];
    frequent: QuickLinkItem[];
  };
}

