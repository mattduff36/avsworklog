export type YardKioskRemoteCommandType =
  | 'ping'
  | 'refresh_status'
  | 'refresh_session'
  | 'reload_app'
  | 'reset_workflow'
  | 'logout'
  | 'clear_credentials';

export type YardKioskRemoteCommandStatus =
  | 'pending'
  | 'accepted'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface YardKioskRemoteCommandView {
  id: string;
  device_id: string;
  command_type: YardKioskRemoteCommandType;
  status: YardKioskRemoteCommandStatus;
  issued_at: string;
  expires_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  result_code: string | null;
  error_message: string | null;
}

export interface YardKioskHeartbeatInput {
  phase?: string | null;
  offline?: boolean;
  app_version?: string | null;
  deployment_id?: string | null;
  last_error_code?: string | null;
  diagnostic_id?: string | null;
}

export const YARD_KIOSK_DESTRUCTIVE_COMMANDS: YardKioskRemoteCommandType[] = [
  'reset_workflow',
  'logout',
  'clear_credentials',
];

export const YARD_KIOSK_ONLINE_THRESHOLD_MS = 45_000;
