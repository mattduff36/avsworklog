/**
 * Navigation Configuration - Single Source of Truth
 * 
 * This file defines all navigation items used across:
 * - Dashboard tiles (Quick Actions & Management Tools)
 * - Top navigation bar
 * - Left sidebar navigation
 * 
 * To add a new module:
 * Follow docs/guides/ADDING_A_NEW_MODULE_WITH_PERMISSIONS.md, then add its
 * level-aware navigation entries to the appropriate arrays below.
 */

import {
  Home,
  FileText,
  ClipboardCheck,
  CheckSquare,
  Calendar,
  CalendarDays,
  Wrench,
  Settings,
  ListTodo,
  MessageSquare,
  BarChart3,
  Users,
  Truck,
  HelpCircle,
  Lightbulb,
  AlertTriangle,
  Building2,
  Receipt,
  SlidersHorizontal,
  PackageSearch,
  GraduationCap,
  LucideIcon
} from 'lucide-react';
import type { ModuleName, PermissionAccessLevel } from '@/types/roles';

export type ModulePermissionLevelMap = Partial<
  Record<ModuleName, number | null | undefined>
>;

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  module?: ModuleName; // For permission checking
  minimumAccessLevel?: PermissionAccessLevel;
  category?: 'employee' | 'manager' | 'admin'; // Which nav area it belongs to
  dropdownItems?: NavItem[]; // For dropdown menus
}

/**
 * Employee Navigation Items
 * These appear in:
 * - Dashboard Quick Actions tiles
 * - Top navigation bar
 */
export const employeeNavItems: NavItem[] = [
  { 
    href: '/timesheets', 
    label: 'Timesheets', 
    icon: FileText, 
    module: 'timesheets',
    category: 'employee'
  },
  { 
    href: '/van-inspections', 
    label: 'Van Daily Checks', 
    icon: ClipboardCheck, 
    module: 'inspections',
    category: 'employee'
  },
  { 
    href: '/plant-inspections', 
    label: 'Plant Daily Checks', 
    icon: ClipboardCheck, 
    module: 'plant-inspections',
    category: 'employee'
  },
  { 
    href: '/hgv-inspections', 
    label: 'HGV Daily Checks', 
    icon: ClipboardCheck, 
    module: 'hgv-inspections',
    category: 'employee'
  },
  { 
    href: '/projects', 
    label: 'Projects', 
    icon: CheckSquare, 
    module: 'rams',
    category: 'employee'
  },
  { 
    href: '/absence', 
    label: 'Absence', 
    icon: Calendar, 
    module: 'absence',
    category: 'employee'
  },
  { 
    href: '/maintenance', 
    label: 'Maintenance', 
    icon: Wrench, 
    module: 'maintenance',
    category: 'employee'
  },
  { 
    href: '/fleet', 
    label: 'Fleet', 
    icon: Truck, 
    module: 'admin-vans',
    category: 'employee'
  },
  { 
    href: '/workshop-tasks', 
    label: 'Workshop', 
    icon: Settings, 
    module: 'workshop-tasks',
    category: 'employee'
  },
  {
    href: '/inventory',
    label: 'Inventory',
    icon: PackageSearch,
    module: 'inventory',
    category: 'employee'
  },
  {
    href: '/daily-allocation/my',
    label: 'My Allocation',
    icon: CalendarDays,
    module: 'daily-allocation',
    minimumAccessLevel: 2,
    category: 'employee'
  },
  { 
    href: '/help', 
    label: 'Help', 
    icon: HelpCircle, 
    // No module - always visible to all authenticated users
    category: 'employee'
  },
];

/**
 * Manager Navigation Items
 * These appear in:
 * - Dashboard Management Tools tiles
 * - Top navigation bar (mobile menu)
 * - Left sidebar navigation
 */
export const managerNavItems: NavItem[] = [
  { 
    href: '/approvals', 
    label: 'Approvals', 
    icon: CheckSquare,
    module: 'approvals',
    category: 'manager'
  },
  { 
    href: '/actions', 
    label: 'Actions', 
    icon: ListTodo,
    module: 'actions',
    category: 'manager'
  },
  {
    href: '/absence/manage',
    label: 'Manage Absence',
    icon: Calendar,
    module: 'absence',
    category: 'manager'
  },
  { 
    href: '/toolbox-talks', 
    label: 'Toolbox Talks', 
    icon: MessageSquare,
    module: 'toolbox-talks',
    category: 'manager'
  },
  {
    href: '/training',
    label: 'Training',
    icon: GraduationCap,
    module: 'training',
    category: 'manager'
  },
  {
    href: '/daily-allocation',
    label: 'Daily Allocation',
    icon: CalendarDays,
    module: 'daily-allocation',
    minimumAccessLevel: 4,
    category: 'manager'
  },
  { 
    href: '/reports', 
    label: 'Reports', 
    icon: BarChart3,
    module: 'reports',
    category: 'manager'
  },
  { 
    href: '/suggestions/manage', 
    label: 'Suggestions', 
    icon: Lightbulb,
    module: 'suggestions',
    category: 'manager'
  },
];

/**
 * Admin Navigation Items
 * These appear in:
 * - Dashboard Management Tools tiles
 * - Top navigation bar (mobile menu)
 * - Left sidebar navigation
 */
export const adminNavItems: NavItem[] = [
  { 
    href: '/customers', 
    label: 'Customers', 
    icon: Building2,
    module: 'customers',
    category: 'admin'
  },
  { 
    href: '/quotes', 
    label: 'Quotes', 
    icon: Receipt,
    module: 'quotes',
    category: 'admin'
  },
  { 
    href: '/admin/users', 
    label: 'Users', 
    icon: Users,
    module: 'admin-users',
    category: 'admin'
  },
  {
    href: '/admin/settings',
    label: 'Admin Settings',
    icon: SlidersHorizontal,
    module: 'admin-settings',
    category: 'admin',
  },
  { 
    href: '/admin/faq', 
    label: 'FAQ Editor', 
    icon: HelpCircle,
    module: 'faq-editor',
    category: 'admin'
  },
  { 
    href: '/admin/errors/manage', 
    label: 'Error Reports', 
    icon: AlertTriangle,
    module: 'error-reports',
    category: 'admin'
  },
];

/**
 * Dashboard Navigation Item
 * Always visible
 */
export const dashboardNavItem: NavItem = {
  href: '/dashboard',
  label: 'Dashboard',
  icon: Home,
};

/**
 * Get all navigation items filtered by permissions
 * 
 * @param userPermissions - Set of modules user has access to
 * @param isManager - Whether user is a manager
 * @param isAdmin - Whether user is an admin
 * @param hasRAMSAssignments - Whether user has RAMS assignments (for filtering)
 * @returns Filtered navigation items
 */
export function getFilteredEmployeeNav(
  userPermissions: Set<ModuleName>,
  permissionLevels: ModulePermissionLevelMap | null,
  isManager: boolean,
  isAdmin: boolean,
  hasRAMSAssignments: boolean
): NavItem[] {
  return employeeNavItems.filter(item => {
    // Check basic permission for employees
    if (!canAccessNavItem(item, userPermissions, permissionLevels, isAdmin)) {
      return false;
    }
    
    // Special handling for RAMS - hide for employees with no assignments
    if (item.module === 'rams' && !hasRAMSAssignments && !isManager && !isAdmin) {
      return false;
    }
    
    return true;
  });
}

export function canAccessNavItem(
  item: NavItem,
  userPermissions: Set<ModuleName>,
  permissionLevels: ModulePermissionLevelMap | null,
  isAdmin: boolean
): boolean {
  if (isAdmin) {
    return true;
  }
  if (item.dropdownItems && item.dropdownItems.length > 0) {
    return item.dropdownItems.some((child) => canAccessNavItem(
      child,
      userPermissions,
      permissionLevels,
      false
    ));
  }
  if (!item.module) {
    return true;
  }
  if (!userPermissions.has(item.module)) {
    return false;
  }
  if (item.minimumAccessLevel === undefined) {
    return true;
  }

  return (permissionLevels?.[item.module] ?? 0) >= item.minimumAccessLevel;
}

export function getFilteredNavByPermissions(
  items: NavItem[],
  userPermissions: Set<ModuleName>,
  permissionLevels: ModulePermissionLevelMap | null,
  isAdmin: boolean
): NavItem[] {
  return items.filter((item) => canAccessNavItem(
    item,
    userPermissions,
    permissionLevels,
    isAdmin
  ));
}

