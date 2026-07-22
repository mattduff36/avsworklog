import type {
  YardKioskBootstrapResponse,
  YardKioskLocation,
} from '@/lib/inventory/kiosk-types';

export type YardKioskRemoteCommandType =
  | 'ping'
  | 'refresh_status'
  | 'refresh_session'
  | 'reload_app'
  | 'reset_workflow'
  | 'logout'
  | 'clear_credentials'
  | 'control_action';

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
  payload: Record<string, unknown>;
}

export type YardKioskControlAction =
  | { type: 'select_direction'; direction: 'take' | 'return' }
  | { type: 'select_location'; location_id: string }
  | { type: 'set_location_search'; query: string }
  | { type: 'set_location_filter'; filter: 'all' | 'manual' | 'vans' | 'sites' }
  | { type: 'set_location_page'; page_index: number }
  | { type: 'set_include_legacy_quotes'; enabled: boolean }
  | { type: 'toggle_location_pin'; location_id: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'set_item_search'; query: string }
  | { type: 'set_item_category'; category: string }
  | { type: 'set_item_page'; page_index: number }
  | { type: 'add_serialized'; item_id: string }
  | { type: 'open_hardware_quantity'; item_id: string }
  | { type: 'set_hardware_dialog_quantity'; quantity: number }
  | { type: 'set_hardware_quantity'; item_id: string; quantity: number }
  | { type: 'close_hardware_quantity' }
  | { type: 'remove_line'; kind: 'serialized' | 'hardware'; item_id: string }
  | { type: 'clear_basket' }
  | { type: 'dismiss_error' }
  | { type: 'reset' };

export interface YardKioskLocationUiState {
  query: string;
  active_filter: 'all' | 'manual' | 'vans' | 'sites';
  page_index: number;
  include_legacy_quotes: boolean;
  recent_ids: string[];
  pinned_ids: string[];
}

export interface YardKioskItemUiState {
  page_index: number;
  hardware_item_id: string | null;
  hardware_quantity: number;
}

export interface YardKioskWorkflowSnapshot {
  schema_version: 1;
  revision: number;
  state: Record<string, unknown>;
  bootstrap: YardKioskBootstrapResponse;
  locations: YardKioskLocation[];
  offline: boolean;
  location_ui: YardKioskLocationUiState;
  item_ui: YardKioskItemUiState;
  recorded_at: string;
}

export interface YardKioskControlLeaseView {
  session_id: string | null;
  holder_user_id: string | null;
  acquired_at: string | null;
  expires_at: string | null;
  is_active: boolean;
}

export interface YardKioskHeartbeatInput {
  phase?: string | null;
  offline?: boolean;
  app_version?: string | null;
  deployment_id?: string | null;
  last_error_code?: string | null;
  diagnostic_id?: string | null;
  workflow_snapshot?: unknown;
}

export const YARD_KIOSK_DESTRUCTIVE_COMMANDS: YardKioskRemoteCommandType[] = [
  'reset_workflow',
  'logout',
  'clear_credentials',
];

export const YARD_KIOSK_ONLINE_THRESHOLD_MS = 45_000;
