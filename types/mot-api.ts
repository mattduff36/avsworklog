/**
 * Type definitions for GOV.UK MOT History API
 * Documentation: https://documentation.history.mot.api.gov.uk/
 */

export interface MotDefect {
  type: string;
  text: string;
  dangerous: boolean;
}

export interface MotTest {
  completedDate: string;
  testResult: string; // 'PASSED', 'FAILED', etc.
  expiryDate: string | null;
  odometerValue: string;
  odometerUnit: string; // 'mi' or 'km'
  motTestNumber: string;
  defects?: MotDefect[];
}

export interface MotHistoryApiResponse {
  registration: string;
  make: string;
  model: string;
  firstUsedDate: string;
  fuelType: string;
  primaryColour: string;
  registrationDate: string;
  manufactureDate: string;
  engineSize: string;
  motTests?: MotTest[];
}

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

