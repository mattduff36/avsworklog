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

// All available modules in the system
export type ModuleName =
  | 'timesheets'
  | 'inspections'
  | 'rams'
  | 'absence'
  | 'toolbox-talks'
  | 'approvals'
  | 'actions'
  | 'reports'
  | 'admin-users'
  | 'admin-vehicles';

export const ALL_MODULES: ModuleName[] = [
  'timesheets',
  'inspections',
  'rams',
  'absence',
  'toolbox-talks',
  'approvals',
  'actions',
  'reports',
  'admin-users',
  'admin-vehicles',
];

export const MODULE_DISPLAY_NAMES: Record<ModuleName, string> = {
  'timesheets': 'Timesheets',
  'inspections': 'Vehicle Inspections',
  'rams': 'RAMS Documents',
  'absence': 'Absence & Leave',
  'toolbox-talks': 'Toolbox Talks',
  'approvals': 'Approvals',
  'actions': 'Actions',
  'reports': 'Reports',
  'admin-users': 'User Management',
  'admin-vehicles': 'Vehicle Management',
};

export const MODULE_DESCRIPTIONS: Record<ModuleName, string> = {
  'timesheets': 'Create and submit timesheets',
  'inspections': 'Perform vehicle inspections',
  'rams': 'Access and sign RAMS documents',
  'absence': 'Request and manage absence',
  'toolbox-talks': 'Receive and sign toolbox talks',
  'approvals': 'Approve timesheets, inspections, and absences',
  'actions': 'Manage and track actions',
  'reports': 'View system reports',
  'admin-users': 'Manage user accounts',
  'admin-vehicles': 'Manage vehicle fleet',
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

