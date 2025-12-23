// DVLA Vehicle Data API Service
// Supports multiple third-party DVLA data providers

import { VehicleDataResponse, DVLAProvider, DVLAApiConfig } from '@/types/dvla-api';

/**
 * Base DVLA API Service
 * Supports multiple third-party providers for DVLA data
 */
export class DVLAApiService {
  private provider: DVLAProvider;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: DVLAApiConfig) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  /**
   * Fetch vehicle data by registration number
   */
  async getVehicleData(registrationNumber: string): Promise<VehicleDataResponse> {
    const normalizedReg = this.normalizeRegistration(registrationNumber);

    try {
      switch (this.provider) {
        case 'ves':
          return await this.fetchFromVES(normalizedReg);
        case 'vehiclesmart':
          return await this.fetchFromVehicleSmart(normalizedReg);
        case 'checkcardetails':
          return await this.fetchFromCheckCarDetails(normalizedReg);
        case 'vehicledataglobal':
          return await this.fetchFromVehicleDataGlobal(normalizedReg);
        default:
          throw new Error(`Unsupported provider: ${this.provider}`);
      }
    } catch (error: any) {
      throw new Error(`DVLA API Error: ${error.message}`);
    }
  }

  /**
   * GOV.UK VES API Integration (Official DVLA API)
   */
  private async fetchFromVES(reg: string): Promise<VehicleDataResponse> {
    const response = await fetch(`${this.baseUrl}/vehicles`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registrationNumber: reg,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API request failed: ${response.status} - ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    return this.normalizeVESResponse(data);
  }

  /**
   * Vehicle Smart API Integration
   */
  private async fetchFromVehicleSmart(reg: string): Promise<VehicleDataResponse> {
    const response = await fetch(`${this.baseUrl}/vehicledata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        registrationNumber: reg,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this.normalizeVehicleSmartResponse(data);
  }

  /**
   * Check Car Details UK API Integration
   */
  private async fetchFromCheckCarDetails(reg: string): Promise<VehicleDataResponse> {
    const response = await fetch(`${this.baseUrl}/vehicle/${reg}`, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this.normalizeCheckCarDetailsResponse(data);
  }

  /**
   * Vehicle Data Global API Integration
   */
  private async fetchFromVehicleDataGlobal(reg: string): Promise<VehicleDataResponse> {
    const response = await fetch(`${this.baseUrl}/vehicle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        vrm: reg,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this.normalizeVehicleDataGlobalResponse(data);
  }

  /**
   * Normalize VES (GOV.UK) response to common format
   * Includes ALL fields returned by VES API for complete vehicle data storage
   */
  private normalizeVESResponse(data: any): VehicleDataResponse {
    return {
      registrationNumber: data.registrationNumber,
      taxStatus: data.taxStatus || null,
      taxDueDate: data.taxDueDate || null,
      motStatus: data.motStatus || null,
      motExpiryDate: null, // VES API doesn't provide MOT expiry date, only status text
      make: data.make || null,
      model: null, // VES API doesn't provide model
      colour: data.colour || null,
      yearOfManufacture: data.yearOfManufacture || null,
      engineSize: data.engineCapacity || null,
      fuelType: data.fuelType || null,
      co2Emissions: data.co2Emissions || null,
      
      // Additional VES fields for comprehensive vehicle data
      euroStatus: data.euroStatus || null,
      realDrivingEmissions: data.realDrivingEmissions || null,
      typeApproval: data.typeApproval || null,
      wheelplan: data.wheelplan || null,
      revenueWeight: data.revenueWeight || null,
      markedForExport: data.markedForExport || false,
      monthOfFirstRegistration: data.monthOfFirstRegistration || null,
      dateOfLastV5CIssued: data.dateOfLastV5CIssued || null,
      
      rawData: data,
    };
  }

  /**
   * Normalize Vehicle Smart response to common format
   */
  private normalizeVehicleSmartResponse(data: any): VehicleDataResponse {
    return {
      registrationNumber: data.RegistrationNumber || data.registrationNumber,
      taxStatus: data.TaxStatus || data.taxStatus,
      taxDueDate: data.TaxDueDate || data.taxDueDate || null,
      motStatus: data.MotStatus || data.motStatus,
      motExpiryDate: data.MotExpiryDate || data.motExpiryDate || null,
      make: data.Make || data.make || null,
      model: data.Model || data.model || null,
      colour: data.Colour || data.colour || null,
      yearOfManufacture: data.YearOfManufacture || data.yearOfManufacture || null,
      engineSize: data.EngineCapacity || data.engineSize || null,
      fuelType: data.FuelType || data.fuelType || null,
      co2Emissions: data.Co2Emissions || data.co2Emissions || null,
      rawData: data,
    };
  }

  /**
   * Normalize Check Car Details response to common format
   */
  private normalizeCheckCarDetailsResponse(data: any): VehicleDataResponse {
    return {
      registrationNumber: data.vrm || data.registrationMark,
      taxStatus: data.vehicleTaxStatus || data.taxStatus,
      taxDueDate: data.vehicleTaxDueDate || data.taxDueDate || null,
      motStatus: data.motStatus,
      motExpiryDate: data.motExpiryDate || null,
      make: data.make || null,
      model: data.model || null,
      colour: data.colour || null,
      yearOfManufacture: data.yearOfManufacture || null,
      engineSize: data.engineCapacity || null,
      fuelType: data.fuelType || null,
      co2Emissions: data.co2Emissions || null,
      rawData: data,
    };
  }

  /**
   * Normalize Vehicle Data Global response to common format
   */
  private normalizeVehicleDataGlobalResponse(data: any): VehicleDataResponse {
    return {
      registrationNumber: data.vrm,
      taxStatus: data.taxStatus,
      taxDueDate: data.taxDueDate || null,
      motStatus: data.motStatus,
      motExpiryDate: data.motExpiryDate || null,
      make: data.make || null,
      model: data.model || null,
      colour: data.colour || null,
      yearOfManufacture: data.manufactureYear || null,
      engineSize: data.engineCapacity || null,
      fuelType: data.fuelType || null,
      co2Emissions: data.co2Emissions || null,
      rawData: data,
    };
  }

  /**
   * Normalize registration number (remove spaces, uppercase)
   */
  private normalizeRegistration(reg: string): string {
    return reg.replace(/\s+/g, '').toUpperCase();
  }

  /**
   * Validate configuration
   */
  static validateConfig(config: DVLAApiConfig): boolean {
    if (!config.apiKey) {
      throw new Error('DVLA API key is required');
    }
    if (!config.baseUrl) {
      throw new Error('DVLA API base URL is required');
    }
    if (!config.provider) {
      throw new Error('DVLA API provider is required');
    }
    return true;
  }
}

/**
 * Factory function to create configured DVLA API service
 */
export function createDVLAApiService(): DVLAApiService | null {
  const provider = process.env.DVLA_API_PROVIDER as DVLAProvider;
  const apiKey = process.env.DVLA_API_KEY;
  const baseUrl = process.env.DVLA_API_BASE_URL;

  // If not configured, return null (feature disabled)
  if (!provider || !apiKey || !baseUrl) {
    console.warn('DVLA API not configured - feature disabled');
    return null;
  }

  const config: DVLAApiConfig = {
    provider,
    apiKey,
    baseUrl,
  };

  DVLAApiService.validateConfig(config);
  return new DVLAApiService(config);
}

