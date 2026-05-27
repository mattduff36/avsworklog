/**
 * Notification Preferences Types
 */

export type NotificationModuleKey =
  | 'errors'
  | 'maintenance'
  | 'rams'
  | 'approvals'
  | 'inspections'
  | 'toolbox_talks'
  | 'reminders'
  | 'general_notifications'
  | 'sensitive_pin_security';

export const NOTIFICATION_MODULE_KEYS: NotificationModuleKey[] = [
  'errors',
  'maintenance',
  'rams',
  'approvals',
  'inspections',
  'toolbox_talks',
  'reminders',
  'general_notifications',
  'sensitive_pin_security',
];

export interface NotificationPreference {
  id: string;
  user_id: string;
  module_key: NotificationModuleKey;
  enabled: boolean;
  notify_in_app: boolean;
  notify_email: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationModule {
  key: NotificationModuleKey;
  label: string;
  description: string;
  icon: string; // lucide icon name
  availableFor: 'all' | 'admin' | 'manager'; // who can receive these
}

export const NOTIFICATION_MODULES: NotificationModule[] = [
  {
    key: 'errors',
    label: 'Error Reports',
    description: 'Notifications when errors are reported or detected',
    icon: 'AlertTriangle',
    availableFor: 'admin',
  },
  {
    key: 'maintenance',
    label: 'Maintenance Alerts',
    description: 'Overdue and due soon maintenance reminders',
    icon: 'Wrench',
    availableFor: 'all',
  },
  {
    key: 'rams',
    label: 'RAMS Signatures',
    description: 'Notifications when RAMS documents are signed',
    icon: 'FileText',
    availableFor: 'manager',
  },
  {
    key: 'approvals',
    label: 'Approval Requests',
    description: 'Timesheet and absence approval notifications',
    icon: 'CheckSquare',
    availableFor: 'manager',
  },
  {
    key: 'inspections',
    label: 'Inspection Defects',
    description: 'Notifications when defects create workshop tasks',
    icon: 'ClipboardCheck',
    availableFor: 'all',
  },
  {
    key: 'toolbox_talks',
    label: 'Toolbox Talks',
    description: 'Assigned toolbox talks that need reading and signing',
    icon: 'PenLine',
    availableFor: 'all',
  },
  {
    key: 'reminders',
    label: 'Reminders',
    description: 'Reminder messages from managers, maintenance workflows, and actions',
    icon: 'Bell',
    availableFor: 'all',
  },
  {
    key: 'general_notifications',
    label: 'General Notifications',
    description: 'Operational notifications such as quotes, inventory, absence, and timesheet alerts',
    icon: 'Bell',
    availableFor: 'all',
  },
  {
    key: 'sensitive_pin_security',
    label: 'Sensitive PIN Security',
    description: 'Admin alerts when users set or change sensitive module PINs',
    icon: 'Shield',
    availableFor: 'admin',
  },
];

// API request/response types
export interface GetNotificationPreferencesResponse {
  success: boolean;
  preferences: NotificationPreference[];
  error?: string;
}

export interface UpdateNotificationPreferenceRequest {
  module_key: NotificationModuleKey;
  notify_in_app?: boolean;
  notify_email?: boolean;
}

export interface UpdateNotificationPreferenceResponse {
  success: boolean;
  preference: NotificationPreference;
  error?: string;
}

// Admin API types
export interface GetAllNotificationPreferencesResponse {
  success: boolean;
  users: Array<{
    user_id: string;
    full_name: string;
    role_name: string;
    preferences: NotificationPreference[];
  }>;
  error?: string;
}

export interface AdminUpdatePreferenceRequest {
  user_id: string;
  module_key: NotificationModuleKey;
  enabled?: boolean;
  notify_in_app?: boolean;
  notify_email?: boolean;
}
