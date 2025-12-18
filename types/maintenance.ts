// Types for Vehicle Maintenance & Service System

export interface MaintenanceCategory {
  id: string;
  name: string;
  description: string | null;
  type: 'date' | 'mileage';
  alert_threshold_days: number | null;
  alert_threshold_miles: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface VehicleMaintenance {
  id: string;
  vehicle_id: string;
  
  // Date-based maintenance
  tax_due_date: string | null;
  mot_due_date: string | null;
  first_aid_kit_expiry: string | null;
  
  // Mileage-based maintenance
  current_mileage: number | null;
  last_service_mileage: number | null;
  next_service_mileage: number | null;
  cambelt_due_mileage: number | null;
  
  // Tracker
  tracker_id: string | null;
  
  // Tracking
  last_mileage_update: string | null;
  last_updated_at: string;
  last_updated_by: string | null;
  
  created_at: string;
  updated_at: string;
  
  // Metadata
  notes: string | null;
}

export interface MaintenanceHistory {
  id: string;
  vehicle_id: string;
  maintenance_category_id: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  value_type: 'date' | 'mileage' | 'boolean' | 'text';
  comment: string; // Minimum 10 characters
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
}

export interface VehicleArchive {
  id: string;
  vehicle_id: string;
  reg_number: string;
  category_id: string | null;
  status: string | null;
  archive_reason: 'Sold' | 'Scrapped' | 'Other';
  archive_comment: string | null;
  archived_by: string | null;
  archived_at: string;
  vehicle_data: Record<string, any>;
  maintenance_data: Record<string, any> | null;
  created_at: string;
}

// ============================================================================
// Extended types with calculations
// ============================================================================

export type MaintenanceStatus = 'overdue' | 'due_soon' | 'ok' | 'not_set';

export interface MaintenanceItemStatus {
  status: MaintenanceStatus;
  days_until?: number;
  miles_until?: number;
  due_date?: string;
  due_mileage?: number;
}

export interface VehicleMaintenanceWithStatus extends VehicleMaintenance {
  vehicle?: {
    id: string;
    reg_number: string;
    category_id: string | null;
    status: string;
  };
  
  // Last inspection info
  last_inspector?: string | null;
  last_inspection_date?: string | null;
  
  // Calculated status for each maintenance type
  tax_status?: MaintenanceItemStatus;
  mot_status?: MaintenanceItemStatus;
  service_status?: MaintenanceItemStatus;
  cambelt_status?: MaintenanceItemStatus;
  first_aid_status?: MaintenanceItemStatus;
  
  // Overall counts
  overdue_count: number;
  due_soon_count: number;
}

// ============================================================================
// Request/Response types for API
// ============================================================================

export interface UpdateMaintenanceRequest {
  current_mileage?: number | null; // Manual override for current mileage
  tax_due_date?: string | null;
  mot_due_date?: string | null;
  first_aid_kit_expiry?: string | null;
  next_service_mileage?: number | null;
  last_service_mileage?: number | null;
  cambelt_due_mileage?: number | null;
  tracker_id?: string | null;
  notes?: string | null;
  comment: string; // Mandatory for audit trail (min 10 chars)
}

export interface CreateCategoryRequest {
  name: string;
  description?: string;
  type: 'date' | 'mileage';
  alert_threshold_days?: number;
  alert_threshold_miles?: number;
  sort_order?: number;
}

export interface UpdateCategoryRequest {
  name?: string;
  description?: string;
  alert_threshold_days?: number;
  alert_threshold_miles?: number;
  is_active?: boolean;
  sort_order?: number;
}

export interface ArchiveVehicleRequest {
  vehicle_id: string;
  reason: 'Sold' | 'Scrapped' | 'Other';
  comment?: string;
}

export interface MaintenanceListResponse {
  success: boolean;
  vehicles: VehicleMaintenanceWithStatus[];
  summary: {
    total: number;
    overdue: number;
    due_soon: number;
  };
}

export interface MaintenanceUpdateResponse {
  success: boolean;
  maintenance: VehicleMaintenance;
  history_entry: MaintenanceHistory;
}

export interface CategoriesListResponse {
  success: boolean;
  categories: MaintenanceCategory[];
}

export interface MaintenanceHistoryResponse {
  success: boolean;
  history: MaintenanceHistory[];
  vehicle: {
    id: string;
    reg_number: string;
  };
}

// ============================================================================
// Utility types
// ============================================================================

export interface DateThreshold {
  overdue_days: number; // Negative if overdue
  status: MaintenanceStatus;
}

export interface MileageThreshold {
  miles_until: number; // Negative if overdue
  status: MaintenanceStatus;
}
