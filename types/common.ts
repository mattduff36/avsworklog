/**
 * Common types shared across the application
 * Centralized to avoid duplication and inconsistencies
 */

/**
 * Employee - Basic employee information
 * Used in dropdowns, filters, and assignments
 */
export interface Employee {
  id: string;
  full_name: string;
  employee_id: string | null;
}

/**
 * Status filters for different modules
 */
export type TimesheetStatusFilter = 'all' | 'draft' | 'pending' | 'approved' | 'rejected' | 'processed' | 'adjusted';
export type InspectionStatusFilter = 'all' | 'draft' | 'pending' | 'approved' | 'rejected';
export type AbsenceStatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
export type StatusFilter = TimesheetStatusFilter | InspectionStatusFilter | AbsenceStatusFilter;

/**
 * Generic type to extend database types with profile information
 * Usage: TimesheetWithProfile = WithProfile<Timesheet>
 */
export interface WithProfile<T> {
  user?: {
    full_name: string;
    employee_id?: string | null;
  };
  profile?: {
    full_name: string;
    employee_id?: string | null;
  };
}

/**
 * Extended types for list views with related data
 */
export type WithUser<T> = T & {
  user: {
    full_name: string;
    employee_id: string | null;
  };
};

export type WithVehicle<T> = T & {
  vehicles: {
    reg_number: string;
    vehicle_type?: string;
  };
};

/**
 * Common pagination types
 */
export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * API Response types
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  details?: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

