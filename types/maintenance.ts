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
  
  // DVLA API Sync
  last_dvla_sync: string | null;
  dvla_sync_status: 'never' | 'success' | 'error' | 'pending' | null;
  dvla_sync_error: string | null;
  dvla_raw_data: Record<string, any> | null;
  
  // VES API Vehicle Data
  ves_make: string | null;
  ves_colour: string | null;
  ves_fuel_type: string | null;
  ves_year_of_manufacture: number | null;
  ves_engine_capacity: number | null;
  ves_tax_status: string | null;
  ves_mot_status: string | null;
  ves_co2_emissions: number | null;
  ves_euro_status: string | null;
  ves_real_driving_emissions: string | null;
  ves_type_approval: string | null;
  ves_wheelplan: string | null;
  ves_revenue_weight: number | null;
  ves_marked_for_export: boolean | null;
  ves_month_of_first_registration: string | null;
  ves_date_of_last_v5c_issued: string | null;
  
  // MOT History API Data - Sync tracking
  mot_expiry_date: string | null;
  mot_api_sync_status: 'never' | 'success' | 'error' | 'pending' | null;
  mot_api_sync_error: string | null;
  last_mot_api_sync: string | null;
  mot_raw_data: Record<string, any> | null;
  
  // MOT History API Data - Vehicle details
  mot_make: string | null;
  mot_model: string | null;
  mot_first_used_date: string | null;
  mot_registration_date: string | null;
  mot_manufacture_date: string | null;
  mot_engine_size: string | null;
  mot_fuel_type: string | null;
  mot_primary_colour: string | null;
  mot_secondary_colour: string | null;
  mot_vehicle_id: string | null;
  mot_registration: string | null;
  mot_vin: string | null;
  mot_v5c_reference: string | null;
  mot_dvla_id: string | null;
  
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
    nickname?: string | null;
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
  vesData?: {
    ves_make: string | null;
    ves_colour: string | null;
    ves_fuel_type: string | null;
    ves_year_of_manufacture: number | null;
    ves_engine_capacity: number | null;
    ves_tax_status: string | null;
    ves_mot_status: string | null;
    ves_co2_emissions: number | null;
    ves_euro_status: string | null;
    ves_real_driving_emissions: string | null;
    ves_type_approval: string | null;
    ves_wheelplan: string | null;
    ves_revenue_weight: number | null;
    ves_marked_for_export: boolean | null;
    ves_month_of_first_registration: string | null;
    ves_date_of_last_v5c_issued: string | null;
    tax_due_date: string | null;
    last_dvla_sync: string | null;
  } | null;
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
