// Role and Permission Types

export interface Role {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  is_super_admin: boolean;
  is_manager_admin: boolean;
  timesheet_type?: string;
  created_at: string;
  updated_at: string;
}

export interface RolePermission {
  id: string;
  role_id: string;
  module_name: ModuleName;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoleWithPermissions extends Role {
  permissions: RolePermission[];
  user_count?: number;
}

export interface RoleWithUserCount extends Role {
  user_count: number;
  permission_count: number;
}

export interface RoleMatrixRow extends Role {
  user_count: number;
  permissions: Record<ModuleName, boolean>;
}

export const STANDARD_MODULES: ModuleName[] = [
  'timesheets',
  'inspections',
  'plant-inspections',
  'hgv-inspections',
  'rams',
  'absence',
  'maintenance',
  'workshop-tasks',
  'admin-vans',
];

export const MANAGEMENT_MODULES: ModuleName[] = [
  'approvals',
  'actions',
  'reports',
  'toolbox-talks',
  'suggestions',
  'faq-editor',
  'error-reports',
  'admin-users',
  'customers',
  'quotes',
];

export const MODULE_SHORT_NAMES: Record<ModuleName, string> = {
  'timesheets': 'Timesheets',
  'inspections': 'Van Checks',
  'plant-inspections': 'Plant Checks',
  'hgv-inspections': 'HGV Checks',
  'rams': 'Projects',
  'absence': 'Absence',
  'maintenance': 'Maint.',
  'toolbox-talks': 'Toolbox',
  'workshop-tasks': 'Workshop',
  'approvals': 'Approvals',
  'actions': 'Actions',
  'reports': 'Reports',
  'suggestions': 'Suggest.',
  'faq-editor': 'FAQ',
  'error-reports': 'Errors',
  'admin-users': 'Users',
  'admin-vans': 'Fleet',
  'customers': 'Customers',
  'quotes': 'Quotes',
};

export const MODULE_CSS_VAR: Record<ModuleName, string> = {
  'timesheets': '--timesheet-primary',
  'inspections': '--inspection-primary',
  'plant-inspections': '--plant-inspection-primary',
  'hgv-inspections': '--inspection-primary',
  'rams': '--rams-primary',
  'absence': '--absence-primary',
  'maintenance': '--maintenance-primary',
  'toolbox-talks': '--avs-yellow',
  'workshop-tasks': '--workshop-primary',
  'approvals': '--avs-yellow',
  'actions': '--avs-yellow',
  'reports': '--avs-yellow',
  'suggestions': '--avs-yellow',
  'faq-editor': '--avs-yellow',
  'error-reports': '--avs-yellow',
  'admin-users': '--avs-yellow',
  'admin-vans': '--fleet-primary',
  'customers': '--avs-yellow',
  'quotes': '--avs-yellow',
};

// All available modules in the system
export type ModuleName =
  | 'timesheets'
  | 'inspections'
  | 'plant-inspections'
  | 'hgv-inspections'
  | 'rams'
  | 'absence'
  | 'maintenance'
  | 'toolbox-talks'
  | 'workshop-tasks'
  | 'approvals'
  | 'actions'
  | 'reports'
  | 'suggestions'
  | 'faq-editor'
  | 'error-reports'
  | 'admin-users'
  | 'admin-vans'
  | 'customers'
  | 'quotes';

export const ALL_MODULES: ModuleName[] = [
  'timesheets',
  'inspections',
  'plant-inspections',
  'hgv-inspections',
  'rams',
  'absence',
  'maintenance',
  'toolbox-talks',
  'workshop-tasks',
  'approvals',
  'actions',
  'reports',
  'suggestions',
  'faq-editor',
  'error-reports',
  'admin-users',
  'admin-vans',
  'customers',
  'quotes',
];

export const MODULE_DISPLAY_NAMES: Record<ModuleName, string> = {
  'timesheets': 'Timesheets',
  'inspections': 'Van Daily Checks',
  'plant-inspections': 'Plant Daily Checks',
  'hgv-inspections': 'HGV Daily Checks',
  'rams': 'Projects',
  'absence': 'Absence & Leave',
  'maintenance': 'Maintenance & Service',
  'toolbox-talks': 'Toolbox Talks',
  'workshop-tasks': 'Workshop Tasks',
  'approvals': 'Approvals',
  'actions': 'Actions',
  'reports': 'Reports',
  'suggestions': 'Suggestions',
  'faq-editor': 'FAQ Editor',
  'error-reports': 'Error Reports',
  'admin-users': 'User Management',
  'admin-vans': 'Fleet Management',
  'customers': 'Customers',
  'quotes': 'Quotes',
};

export const MODULE_DESCRIPTIONS: Record<ModuleName, string> = {
  'timesheets': 'Create and submit timesheets',
  'inspections': 'Perform van daily checks',
  'plant-inspections': 'Perform plant machinery daily checks',
  'hgv-inspections': 'Perform daily HGV checks',
  'rams': 'Access and sign project documents',
  'absence': 'Request and manage absence',
  'maintenance': 'Track and manage van maintenance schedules',
  'toolbox-talks': 'Send toolbox talks to users (admin/manager only)',
  'workshop-tasks': 'Track van & plant repairs and workshop work',
  'approvals': 'Approve timesheets, daily checks, and absences',
  'actions': 'Manage and track actions',
  'reports': 'View system reports',
  'suggestions': 'Review and triage user suggestions',
  'faq-editor': 'Manage FAQ categories and articles',
  'error-reports': 'Review and resolve submitted error reports',
  'admin-users': 'Manage user accounts',
  'admin-vans': 'Manage fleet assets',
  'customers': 'Manage customer directory',
  'quotes': 'Create and track customer quotations',
};

// For API responses
export interface GetRolesResponse {
  success: boolean;
  roles: RoleWithUserCount[];
}

export interface GetRoleResponse {
  success: boolean;
  role: RoleWithPermissions;
}

export interface CreateRoleRequest {
  name: string;
  display_name: string;
  description?: string;
  is_manager_admin?: boolean;
  role_type?: 'admin' | 'manager' | 'employee';
}

export interface UpdateRoleRequest {
  display_name?: string;
  description?: string;
}

export interface UpdatePermissionsRequest {
  permissions: {
    module_name: ModuleName;
    enabled: boolean;
  }[];
}

export interface UserPermissions {
  [key: string]: boolean;
}

