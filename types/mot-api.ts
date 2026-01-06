/**
 * Type definitions for GOV.UK MOT History API
 * Documentation: https://documentation.history.mot.api.gov.uk/
 * 
 * This file contains ALL data structures returned by the MOT History API
 */

// ============================================================================
// RAW API RESPONSE TYPES
// ============================================================================

export interface MotDefect {
  type: 'ADVISORY' | 'MINOR' | 'MAJOR' | 'DANGEROUS' | 'PRS' | 'FAIL';
  text: string;
  dangerous: boolean;
  locationLateral?: string; // 'nearside', 'offside', 'front', 'rear'
  locationLongitudinal?: string;
  locationVertical?: string;
}

export interface MotComment {
  text: string;
  type?: string;
}

export interface MotTest {
  // Test identification
  completedDate: string; // ISO 8601
  testResult: 'PASSED' | 'FAILED' | 'ABANDONED' | 'ABORTED' | 'REFUSED';
  expiryDate: string | null; // Only for passed tests
  motTestNumber: string;
  
  // Odometer
  odometerValue: string;
  odometerUnit: 'mi' | 'km';
  odometerResultType: 'READ' | 'NOT_READABLE' | 'NO_ODOMETER';
  
  // Test details
  testClass: string; // '4' for cars, '5' for motorcycles, '7' for vans, etc.
  testType: 'NORMAL' | 'RETEST' | 'PARTIAL_RETEST' | 'ADVISORY_NOTICE' | 'MOT_REPLACEMENT' | 'INVERTED_APPEAL';
  cylinderCapacity?: number; // Engine size at time of test
  
  // Location
  testNumber?: string;
  testStationName?: string;
  testStationPNumber?: string; // Test station number
  testStationPcode?: string; // Postcode
  
  // Defects and comments
  defects?: MotDefect[];
  comments?: MotComment[];
}

export interface MotHistoryApiResponse {
  // Vehicle identification
  registration: string;
  vehicleId?: string; // DVSA internal ID
  vin?: string; // Vehicle Identification Number
  dvlaId?: string;
  v5cReference?: string;
  
  // Vehicle details
  make: string;
  model: string;
  firstUsedDate: string; // YYYY-MM-DD
  registrationDate?: string;
  manufactureDate?: string;
  engineSize?: string; // cc
  fuelType: string;
  primaryColour: string;
  secondaryColour?: string;
  
  // MOT test history (array of all tests, newest first)
  motTests?: MotTest[];
  
  // For new vehicles without MOT history yet
  motTestDueDate?: string; // YYYY-MM-DD - first MOT due date
}

// ============================================================================
// PROCESSED DATA TYPES
// ============================================================================

export interface MotExpiryData {
  registration: string;
  motExpiryDate: string | null;
  motStatus: 'Valid' | 'Expired' | 'No MOT History' | 'No Valid MOT' | 'No Expiry Date' | 'Unknown';
  lastTestDate: string | null;
  lastTestResult: string | null;
  rawData: MotHistoryApiResponse;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  ext_expires_in: number;
}

// ============================================================================
// DATABASE TYPES (for Supabase tables)
// ============================================================================

export interface MotTestHistoryRow {
  id: string;
  vehicle_id: string;
  
  // Test identification
  mot_test_number: string;
  completed_date: string;
  test_result: string;
  
  // MOT expiry
  expiry_date: string | null;
  
  // Odometer
  odometer_value: number | null;
  odometer_unit: string | null;
  odometer_result_type: string | null;
  
  // Test details
  test_class: string | null;
  test_type: string | null;
  cylinder_capacity: number | null;
  
  // Location
  test_station_number: string | null;
  test_station_name: string | null;
  test_station_pcode: string | null;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface MotTestDefectRow {
  id: string;
  mot_test_id: string;
  
  // Defect details
  type: string;
  text: string;
  location_lateral: string | null;
  location_longitudinal: string | null;
  location_vertical: string | null;
  dangerous: boolean;
  
  // Timestamp
  created_at: string;
}

export interface MotTestCommentRow {
  id: string;
  mot_test_id: string;
  comment_text: string;
  comment_type: string | null;
  created_at: string;
}

// ============================================================================
// EXTENDED VEHICLE MAINTENANCE TYPE (with all MOT data)
// ============================================================================

export interface VehicleMaintenanceWithMotData {
  // ... existing vehicle maintenance fields ...
  
  // MOT expiry and sync tracking
  mot_expiry_date: string | null;
  mot_api_sync_status: string | null;
  mot_api_sync_error: string | null;
  last_mot_api_sync: string | null;
  mot_raw_data: MotHistoryApiResponse | null;
  
  // MOT vehicle-level data
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
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface MotTestWithDefects extends MotTestHistoryRow {
  defects: MotTestDefectRow[];
  comments: MotTestCommentRow[];
}

export interface MotHistorySummary {
  vehicleId: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  latestTest: MotTestHistoryRow | null;
  latestPassedTest: MotTestHistoryRow | null;
  currentMotExpiry: string | null;
  hasActiveAdvisories: boolean;
  dangerousDefectsCount: number;
}
