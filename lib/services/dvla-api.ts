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
  private readonly requestTimeoutMs = 15_000;

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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`DVLA API Error: ${message}`);
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
  }

  /**
   * GOV.UK VES API Integration (Official DVLA API)
   */
  private async fetchFromVES(reg: string): Promise<VehicleDataResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/vehicles`, {
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

    const data = (await response.json()) as Record<string, unknown>;
    return this.normalizeVESResponse(data);
  }

  /**
   * Vehicle Smart API Integration
   */
  private async fetchFromVehicleSmart(reg: string): Promise<VehicleDataResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/vehicledata`, {
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

    const data = (await response.json()) as Record<string, unknown>;
    return this.normalizeVehicleSmartResponse(data);
  }

  /**
   * Check Car Details UK API Integration
   */
  private async fetchFromCheckCarDetails(reg: string): Promise<VehicleDataResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/vehicle/${reg}`, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.normalizeCheckCarDetailsResponse(data);
  }

  /**
   * Vehicle Data Global API Integration
   */
  private async fetchFromVehicleDataGlobal(reg: string): Promise<VehicleDataResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/vehicle`, {
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

    const data = (await response.json()) as Record<string, unknown>;
    return this.normalizeVehicleDataGlobalResponse(data);
  }

  private static str(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
  }
  private static num(v: unknown): number | null {
    return typeof v === 'number' ? v : null;
  }
  private static bool(v: unknown): boolean {
    return v === true;
  }

  /**
   * Normalize VES (GOV.UK) response to common format
   * Includes ALL fields returned by VES API for complete vehicle data storage
   */
  private normalizeVESResponse(data: Record<string, unknown>): VehicleDataResponse {
    return {
      registrationNumber: DVLAApiService.str(data.registrationNumber) ?? '',
      taxStatus: DVLAApiService.str(data.taxStatus) ?? null,
      taxDueDate: DVLAApiService.str(data.taxDueDate) ?? null,
      motStatus: DVLAApiService.str(data.motStatus) ?? null,
      motExpiryDate: null, // VES API doesn't provide MOT expiry date, only status text
      make: DVLAApiService.str(data.make) ?? null,
      model: null, // VES API doesn't provide model
      colour: DVLAApiService.str(data.colour) ?? null,
      yearOfManufacture: DVLAApiService.num(data.yearOfManufacture) ?? null,
      engineSize: DVLAApiService.num(data.engineCapacity) ?? null,
      fuelType: DVLAApiService.str(data.fuelType) ?? null,
      co2Emissions: DVLAApiService.num(data.co2Emissions) ?? null,

      // Additional VES fields for comprehensive vehicle data
      euroStatus: DVLAApiService.str(data.euroStatus) ?? null,
      realDrivingEmissions: DVLAApiService.str(data.realDrivingEmissions) ?? null,
      typeApproval: DVLAApiService.str(data.typeApproval) ?? null,
      wheelplan: DVLAApiService.str(data.wheelplan) ?? null,
      revenueWeight: DVLAApiService.num(data.revenueWeight) ?? null,
      markedForExport: DVLAApiService.bool(data.markedForExport),
      monthOfFirstRegistration: DVLAApiService.str(data.monthOfFirstRegistration) ?? null,
      dateOfLastV5CIssued: DVLAApiService.str(data.dateOfLastV5CIssued) ?? null,

      rawData: data,
    };
  }

  /**
   * Normalize Vehicle Smart response to common format
   */
  private normalizeVehicleSmartResponse(data: Record<string, unknown>): VehicleDataResponse {
    return {
      registrationNumber: DVLAApiService.str(data.RegistrationNumber ?? data.registrationNumber) ?? '',
      taxStatus: DVLAApiService.str(data.TaxStatus ?? data.taxStatus) ?? null,
      taxDueDate: DVLAApiService.str(data.TaxDueDate ?? data.taxDueDate) ?? null,
      motStatus: DVLAApiService.str(data.MotStatus ?? data.motStatus) ?? null,
      motExpiryDate: DVLAApiService.str(data.MotExpiryDate ?? data.motExpiryDate) ?? null,
      make: DVLAApiService.str(data.Make ?? data.make) ?? null,
      model: DVLAApiService.str(data.Model ?? data.model) ?? null,
      colour: DVLAApiService.str(data.Colour ?? data.colour) ?? null,
      yearOfManufacture: DVLAApiService.num(data.YearOfManufacture ?? data.yearOfManufacture) ?? null,
      engineSize: DVLAApiService.num(data.EngineCapacity ?? data.engineSize) ?? null,
      fuelType: DVLAApiService.str(data.FuelType ?? data.fuelType) ?? null,
      co2Emissions: DVLAApiService.num(data.Co2Emissions ?? data.co2Emissions) ?? null,
      rawData: data,
    };
  }

  /**
   * Normalize Check Car Details response to common format
   */
  private normalizeCheckCarDetailsResponse(data: Record<string, unknown>): VehicleDataResponse {
    return {
      registrationNumber: DVLAApiService.str(data.vrm ?? data.registrationMark) ?? '',
      taxStatus: DVLAApiService.str(data.vehicleTaxStatus ?? data.taxStatus) ?? null,
      taxDueDate: DVLAApiService.str(data.vehicleTaxDueDate ?? data.taxDueDate) ?? null,
      motStatus: DVLAApiService.str(data.motStatus) ?? null,
      motExpiryDate: DVLAApiService.str(data.motExpiryDate) ?? null,
      make: DVLAApiService.str(data.make) ?? null,
      model: DVLAApiService.str(data.model) ?? null,
      colour: DVLAApiService.str(data.colour) ?? null,
      yearOfManufacture: DVLAApiService.num(data.yearOfManufacture) ?? null,
      engineSize: DVLAApiService.num(data.engineCapacity) ?? null,
      fuelType: DVLAApiService.str(data.fuelType) ?? null,
      co2Emissions: DVLAApiService.num(data.co2Emissions) ?? null,
      rawData: data,
    };
  }

  /**
   * Normalize Vehicle Data Global response to common format
   */
  private normalizeVehicleDataGlobalResponse(data: Record<string, unknown>): VehicleDataResponse {
    return {
      registrationNumber: DVLAApiService.str(data.vrm) ?? '',
      taxStatus: DVLAApiService.str(data.taxStatus) ?? null,
      taxDueDate: DVLAApiService.str(data.taxDueDate) ?? null,
      motStatus: DVLAApiService.str(data.motStatus) ?? null,
      motExpiryDate: DVLAApiService.str(data.motExpiryDate) ?? null,
      make: DVLAApiService.str(data.make) ?? null,
      model: DVLAApiService.str(data.model) ?? null,
      colour: DVLAApiService.str(data.colour) ?? null,
      yearOfManufacture: DVLAApiService.num(data.manufactureYear) ?? null,
      engineSize: DVLAApiService.num(data.engineCapacity) ?? null,
      fuelType: DVLAApiService.str(data.fuelType) ?? null,
      co2Emissions: DVLAApiService.num(data.co2Emissions) ?? null,
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

