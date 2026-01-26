/**
 * Error Reports System Types
 */

export type ErrorReportStatus = 'new' | 'investigating' | 'resolved';

export interface ErrorReport {
  id: string;
  created_by: string;
  title: string;
  description: string;
  error_code: string | null;
  page_url: string | null;
  user_agent: string | null;
  additional_context: Record<string, unknown> | null;
  status: ErrorReportStatus;
  admin_notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  notification_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ErrorReportWithUser extends ErrorReport {
  user: {
    id: string;
    full_name: string;
    email?: string;
  } | null;
}

export interface ErrorReportUpdate {
  id: string;
  error_report_id: string;
  created_by: string;
  old_status: string | null;
  new_status: string | null;
  note: string | null;
  created_at: string;
}

export interface ErrorReportUpdateWithUser extends ErrorReportUpdate {
  user: {
    id: string;
    full_name: string;
  } | null;
}

// API Request/Response Types

export interface CreateErrorReportRequest {
  title: string;
  description: string;
  error_code?: string;
  page_url?: string;
  user_agent?: string;
  additional_context?: Record<string, unknown>;
}

export interface CreateErrorReportResponse {
  success: boolean;
  report_id?: string;
  notification_sent?: boolean;
  email_sent?: boolean;
  error?: string;
}

export interface GetErrorReportsResponse {
  success: boolean;
  reports?: ErrorReport[];
  error?: string;
}

export interface GetErrorReportDetailResponse {
  success: boolean;
  report?: ErrorReportWithUser;
  updates?: ErrorReportUpdateWithUser[];
  error?: string;
}

export interface UpdateErrorReportRequest {
  status?: ErrorReportStatus;
  admin_notes?: string;
  note?: string; // For update history
}

export interface UpdateErrorReportResponse {
  success: boolean;
  report?: ErrorReport;
  error?: string;
}

export interface GetAllErrorReportsResponse {
  success: boolean;
  reports?: ErrorReportWithUser[];
  counts?: Record<ErrorReportStatus | 'all', number>;
  error?: string;
}

// Display helpers
export const ERROR_REPORT_STATUS_LABELS: Record<ErrorReportStatus, string> = {
  new: 'New',
  investigating: 'Investigating',
  resolved: 'Resolved',
};

export const ERROR_REPORT_STATUS_COLORS: Record<ErrorReportStatus, string> = {
  new: 'bg-red-500',
  investigating: 'bg-yellow-500',
  resolved: 'bg-green-500',
};
