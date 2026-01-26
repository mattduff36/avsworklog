/**
 * Module Pages Configuration
 * Defines all modules/pages with their sub-pages for error reporting dropdown
 */

import type { ModuleName } from '@/types/roles';
import { MODULE_DISPLAY_NAMES } from '@/types/roles';

export interface ModulePage {
  module: ModuleName | 'other';
  displayName: string;
  subPages: {
    value: string; // unique identifier
    label: string; // display name
  }[];
}

export const MODULE_PAGES: ModulePage[] = [
  {
    module: 'timesheets',
    displayName: MODULE_DISPLAY_NAMES.timesheets,
    subPages: [
      { value: 'timesheets-list', label: 'Timesheets List' },
      { value: 'timesheets-new', label: 'New Timesheet' },
      { value: 'timesheets-view', label: 'View/Edit Timesheet' },
    ],
  },
  {
    module: 'inspections',
    displayName: MODULE_DISPLAY_NAMES.inspections,
    subPages: [
      { value: 'inspections-list', label: 'Inspections List' },
      { value: 'inspections-new', label: 'New Inspection' },
      { value: 'inspections-view', label: 'View Inspection' },
    ],
  },
  {
    module: 'rams',
    displayName: MODULE_DISPLAY_NAMES.rams,
    subPages: [
      { value: 'rams-list', label: 'RAMS List' },
      { value: 'rams-manage', label: 'Manage RAMS' },
      { value: 'rams-view', label: 'View RAMS' },
      { value: 'rams-read', label: 'Read & Sign RAMS' },
    ],
  },
  {
    module: 'absence',
    displayName: MODULE_DISPLAY_NAMES.absence,
    subPages: [
      { value: 'absence-list', label: 'Absence List' },
      { value: 'absence-manage', label: 'Manage Absence' },
      { value: 'absence-allowances', label: 'Allowances' },
      { value: 'absence-reasons', label: 'Absence Reasons' },
    ],
  },
  {
    module: 'maintenance',
    displayName: MODULE_DISPLAY_NAMES.maintenance,
    subPages: [
      { value: 'maintenance-overview', label: 'Maintenance Overview' },
      { value: 'maintenance-schedule', label: 'Maintenance Schedule' },
    ],
  },
  {
    module: 'workshop-tasks',
    displayName: MODULE_DISPLAY_NAMES['workshop-tasks'],
    subPages: [
      { value: 'workshop-tasks-list', label: 'Workshop Tasks List' },
      { value: 'workshop-tasks-new', label: 'New Task' },
      { value: 'workshop-tasks-view', label: 'View/Edit Task' },
    ],
  },
  {
    module: 'approvals',
    displayName: MODULE_DISPLAY_NAMES.approvals,
    subPages: [
      { value: 'approvals-list', label: 'Approvals List' },
      { value: 'approvals-timesheets', label: 'Timesheet Approvals' },
      { value: 'approvals-absence', label: 'Absence Approvals' },
    ],
  },
  {
    module: 'actions',
    displayName: MODULE_DISPLAY_NAMES.actions,
    subPages: [
      { value: 'actions-list', label: 'Actions List' },
      { value: 'actions-my', label: 'My Actions' },
    ],
  },
  {
    module: 'reports',
    displayName: MODULE_DISPLAY_NAMES.reports,
    subPages: [
      { value: 'reports-list', label: 'Reports' },
      { value: 'reports-timesheets', label: 'Timesheet Reports' },
      { value: 'reports-absence', label: 'Absence Reports' },
    ],
  },
  {
    module: 'toolbox-talks',
    displayName: MODULE_DISPLAY_NAMES['toolbox-talks'],
    subPages: [
      { value: 'toolbox-talks-list', label: 'Toolbox Talks List' },
      { value: 'toolbox-talks-new', label: 'New Toolbox Talk' },
    ],
  },
  {
    module: 'admin-users',
    displayName: 'User Management',
    subPages: [
      { value: 'admin-users-list', label: 'User Management' },
      { value: 'admin-users-roles', label: 'Role Management' },
    ],
  },
  {
    module: 'admin-vehicles',
    displayName: 'Vehicle Management',
    subPages: [
      { value: 'admin-vehicles-list', label: 'Vehicles List' },
      { value: 'admin-vehicles-history', label: 'Vehicle History' },
    ],
  },
  {
    module: 'other',
    displayName: 'Other',
    subPages: [
      { value: 'dashboard', label: 'Dashboard' },
      { value: 'notifications', label: 'Notifications' },
      { value: 'help', label: 'Help & FAQ' },
      { value: 'fleet-overview', label: 'Fleet Overview' },
      { value: 'something-else', label: 'Something else' },
    ],
  },
];

/**
 * Get all page options flattened for dropdown
 */
export function getAllPageOptions(): Array<{ value: string; label: string; module: string }> {
  const options: Array<{ value: string; label: string; module: string }> = [];
  
  MODULE_PAGES.forEach(moduleGroup => {
    moduleGroup.subPages.forEach(page => {
      options.push({
        value: page.value,
        label: `${moduleGroup.displayName} - ${page.label}`,
        module: moduleGroup.displayName,
      });
    });
  });
  
  return options;
}

/**
 * Get page label by value
 */
export function getPageLabel(value: string): string {
  for (const moduleGroup of MODULE_PAGES) {
    const page = moduleGroup.subPages.find(p => p.value === value);
    if (page) {
      return `${moduleGroup.displayName} - ${page.label}`;
    }
  }
  return value;
}

/**
 * Get actual page URL by value
 */
export function getPageUrl(value: string): string {
  // Map page values to their actual URLs
  const urlMap: Record<string, string> = {
    // Timesheets
    'timesheets-list': '/timesheets',
    'timesheets-new': '/timesheets/new',
    'timesheets-view': '/timesheets/[id]',
    
    // Inspections
    'inspections-list': '/inspections',
    'inspections-new': '/inspections/new',
    'inspections-view': '/inspections/[id]',
    
    // RAMS
    'rams-list': '/rams',
    'rams-manage': '/rams/manage',
    'rams-view': '/rams/[id]',
    'rams-read': '/rams/read/[id]',
    
    // Absence
    'absence-list': '/absence',
    'absence-manage': '/absence/manage',
    'absence-allowances': '/absence/allowances',
    'absence-reasons': '/absence/reasons',
    
    // Maintenance
    'maintenance-overview': '/fleet/maintenance',
    'maintenance-schedule': '/fleet/maintenance/schedule',
    
    // Workshop Tasks
    'workshop-tasks-list': '/workshop-tasks',
    'workshop-tasks-new': '/workshop-tasks/new',
    'workshop-tasks-view': '/workshop-tasks/[id]',
    
    // Approvals
    'approvals-list': '/approvals',
    'approvals-timesheets': '/approvals/timesheets',
    'approvals-absence': '/approvals/absence',
    
    // Actions
    'actions-list': '/actions',
    'actions-my': '/actions/my',
    
    // Reports
    'reports-list': '/reports',
    'reports-timesheets': '/reports/timesheets',
    'reports-absence': '/reports/absence',
    
    // Toolbox Talks
    'toolbox-talks-list': '/toolbox-talks',
    'toolbox-talks-new': '/toolbox-talks/new',
    
    // Admin - Users
    'admin-users-list': '/admin/users',
    'admin-users-roles': '/admin/roles',
    
    // Admin - Vehicles
    'admin-vehicles-list': '/admin/vehicles',
    'admin-vehicles-new': '/admin/vehicles/new',
    
    // Admin - FAQ
    'admin-faq-list': '/admin/faq',
    'admin-faq-categories': '/admin/faq/categories',
    
    // Other
    'other-dashboard': '/dashboard',
    'other-help': '/help',
    'other-debug': '/debug',
  };
  
  return urlMap[value] || value;
}
