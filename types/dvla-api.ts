// Types for DVLA API Integration

export type DVLAProvider = 'vehiclesmart' | 'checkcardetails' | 'vehicledataglobal';

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

