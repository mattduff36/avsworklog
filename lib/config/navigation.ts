/**
 * Navigation Configuration - Single Source of Truth
 * 
 * This file defines all navigation items used across:
 * - Dashboard tiles (Quick Actions & Management Tools)
 * - Top navigation bar
 * - Left sidebar navigation
 * 
 * To add a new module:
 * 1. Add it to the appropriate array below
 * 2. It will automatically appear in all navigation areas
 */

import {
  Home,
  FileText,
  ClipboardCheck,
  CheckSquare,
  Calendar,
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
  LucideIcon
} from 'lucide-react';
import { ModuleName } from '@/types/roles';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  module?: ModuleName; // For permission checking
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
    href: '/inspections', 
    label: 'Inspections', 
    icon: ClipboardCheck, 
    module: 'inspections',
    category: 'employee',
    dropdownItems: [
      {
        href: '/inspections',
        label: 'Vehicle Inspections',
        icon: ClipboardCheck,
        module: 'inspections',
        category: 'employee'
      },
      {
        href: '/plant-inspections',
        label: 'Plant Inspections',
        icon: ClipboardCheck,
        module: 'plant-inspections',
        category: 'employee'
      }
    ]
  },
  { 
    href: '/rams', 
    label: 'RAMS', 
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
    href: '/fleet?tab=maintenance', 
    label: 'Maintenance', 
    icon: Wrench, 
    module: 'maintenance',
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
    category: 'manager'
  },
  { 
    href: '/actions', 
    label: 'Actions', 
    icon: ListTodo,
    category: 'manager'
  },
  { 
    href: '/toolbox-talks', 
    label: 'Toolbox Talks', 
    icon: MessageSquare,
    category: 'manager'
  },
  { 
    href: '/reports', 
    label: 'Reports', 
    icon: BarChart3,
    category: 'manager'
  },
  { 
    href: '/suggestions/manage', 
    label: 'Suggestions', 
    icon: Lightbulb,
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
    href: '/admin/users', 
    label: 'Users', 
    icon: Users,
    category: 'admin'
  },
  { 
    href: '/fleet?tab=vehicles', 
    label: 'Vehicles', 
    icon: Truck,
    category: 'admin'
  },
  { 
    href: '/admin/faq', 
    label: 'FAQ Editor', 
    icon: HelpCircle,
    category: 'admin'
  },
  { 
    href: '/admin/errors/manage', 
    label: 'Error Reports', 
    icon: AlertTriangle,
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
  isManager: boolean,
  isAdmin: boolean,
  hasRAMSAssignments: boolean
): NavItem[] {
  return employeeNavItems.filter(item => {
    // Managers and admins always have access to all modules
    // (RAMS should be visible to managers/admins regardless of assignments)
    if (isManager || isAdmin) {
      return true;
    }
    
    // For items with dropdown children, check if user has access to ANY child
    if (item.dropdownItems && item.dropdownItems.length > 0) {
      const hasAccessToAnyChild = item.dropdownItems.some(child => {
        // If child has no module requirement, it's accessible
        if (!child.module) return true;
        // Otherwise check if user has the module permission
        return userPermissions.has(child.module);
      });
      
      // If user has access to at least one child, show the parent
      return hasAccessToAnyChild;
    }
    
    // Check basic permission for employees
    if (item.module && !userPermissions.has(item.module)) {
      return false;
    }
    
    // Special handling for RAMS - hide for employees with no assignments
    if (item.module === 'rams' && !hasRAMSAssignments) {
      return false;
    }
    
    return true;
  });
}

