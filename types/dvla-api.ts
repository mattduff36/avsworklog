// Types for DVLA API Integration

export type DVLAProvider = 'vehiclesmart' | 'checkcardetails' | 'vehicledataglobal' | 'ves';

export interface DVLAApiConfig {
  provider: DVLAProvider;
  apiKey: string;
  baseUrl: string;
}

export interface VehicleDataResponse {
  registrationNumber: string;
  taxStatus: string | null;
  taxDueDate: string | null; // ISO date string
  motStatus: string | null;
  motExpiryDate: string | null; // ISO date string
  make: string | null;
  model: string | null;
  colour: string | null;
  yearOfManufacture: number | null;
  engineSize: number | null;
  fuelType: string | null;
  co2Emissions: number | null;
  
  // Additional VES API fields
  euroStatus?: string | null;
  realDrivingEmissions?: string | null;
  typeApproval?: string | null;
  wheelplan?: string | null;
  revenueWeight?: number | null;
  markedForExport?: boolean | null;
  monthOfFirstRegistration?: string | null;
  dateOfLastV5CIssued?: string | null;
  
  rawData?: any; // Store complete API response for debugging
}

export interface DVLASyncResult {
  success: boolean;
  vehicleId: string;
  registrationNumber: string;
  updatedFields: string[];
  errors?: string[];
  syncedAt: string;
}

export interface DVLASyncBatchResult {
  total: number;
  successful: number;
  failed: number;
  results: DVLASyncResult[];
}

