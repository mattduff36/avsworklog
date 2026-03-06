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
  additional_data: Record<string, unknown> | null;
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
