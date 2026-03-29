export type ErrorClassificationCategory =
  | 'user_error_expected'
  | 'codebase_error'
  | 'connection_error'
  | 'other';

export interface ErrorHandlingSnapshot {
  wasHandled?: boolean;
  didShowMessage?: boolean | null;
  messageChannel?: 'toast' | 'inline' | 'modal' | 'unknown';
  userMessage?: string | null;
  userMessageTitle?: string | null;
  userMessageDescription?: string | null;
  correlationKey?: string | null;
}

export interface ErrorClassificationSnapshot {
  category?: ErrorClassificationCategory | string;
  confidence?: 'high' | 'medium' | 'low' | string;
  reason?: string;
}

export interface ErrorUserActionSnapshot {
  actionType?: 'click' | 'submit' | 'keyboard' | 'navigation' | 'unknown' | string;
  label?: string | null;
  element?: string | null;
  href?: string | null;
  pageUrl?: string;
  timestamp?: string;
  ageMs?: number;
}

export interface ErrorAdditionalData extends Record<string, unknown> {
  errorHandling?: ErrorHandlingSnapshot;
  errorClassification?: ErrorClassificationSnapshot;
  userAction?: ErrorUserActionSnapshot;
  userMessage?: string | null;
  userMessageTitle?: string | null;
  userMessageDescription?: string | null;
  toastCorrelationKey?: string | null;
}

export interface DebugInfo {
  environment: string;
  buildTime: string;
  nodeVersion: string;
  nextVersion: string;
}

export interface AuditLogEntry {
  id: string;
  table_name: string;
  record_id: string;
  user_id: string | null;
  user_name: string;
  team_id: string | null;
  action: string;
  changes: Record<string, { old?: unknown; new?: unknown }> | null;
  created_at: string;
}

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  error_message: string;
  error_stack: string | null;
  error_type: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  page_url: string;
  user_agent: string;
  component_name: string | null;
  additional_data: ErrorAdditionalData | null;
}

export interface TestVehicle {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: string;
  fleet_type: 'van' | 'hgv' | 'plant';
}

export interface PurgeActions {
  inspections: boolean;
  workshop_tasks: boolean;
  maintenance: boolean;
  attachments: boolean;
  archives: boolean;
}
