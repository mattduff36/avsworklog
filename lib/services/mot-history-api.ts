/**
 * MOT History API Service
 * Official GOV.UK API for MOT test history and expiry dates
 * Documentation: https://documentation.history.mot.api.gov.uk/
 */

import { logger } from '@/lib/utils/logger';

interface MotHistoryConfig {
  clientId: string;
  clientSecret: string;
  scope: string;
  accessTokenUrl: string;
  apiKey: string;
}

interface AccessToken {
  token: string;
  expiresAt: number; // Unix timestamp
}

interface MotTest {
  completedDate: string;
  testResult: string;
  expiryDate: string | null;
  odometerValue: string;
  odometerUnit: string;
  motTestNumber: string;
  defects?: Array<{
    type: string;
    text: string;
    dangerous: boolean;
  }>;
}

interface MotHistoryResponse {
  registration: string;
  make: string;
  model: string;
  firstUsedDate: string;
  fuelType: string;
  primaryColour: string;
  motTests?: MotTest[];
}

export interface MotExpiryData {
  registration: string;
  motExpiryDate: string | null;
  motStatus: string; // 'Valid', 'Expired', 'No MOT Required', etc.
  lastTestDate: string | null;
  lastTestResult: string | null;
  rawData: MotHistoryResponse;
}

/**
 * MOT History API Client
 * Handles OAuth 2.0 authentication and data retrieval
 */
export class MotHistoryService {
  private config: MotHistoryConfig;
  private tokenCache: AccessToken | null = null;
  private baseUrl = process.env.MOT_API_BASE_URL || 'https://history.mot.api.gov.uk';

  constructor(config: MotHistoryConfig) {
    this.config = config;
  }

  /**
   * Get or refresh OAuth 2.0 access token
   * Tokens are valid for 60 minutes and should be cached
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 5 minute buffer)
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 5 * 60 * 1000) {
      return this.tokenCache.token;
    }

    try {
      logger.info('Requesting new MOT History API access token');

      const response = await fetch(this.config.accessTokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          scope: this.config.scope,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      // Cache the token (expires_in is in seconds)
      this.tokenCache = {
        token: data.access_token,
        expiresAt: now + (data.expires_in * 1000),
      };

      logger.info('MOT History API access token obtained successfully');
      return data.access_token;

    } catch (error: any) {
      logger.error('Failed to obtain MOT History API access token', error);
      throw new Error(`MOT API authentication failed: ${error.message}`);
    }
  }

  /**
   * Get MOT history for a vehicle by registration number
   */
  async getMotHistory(registration: string): Promise<MotHistoryResponse> {
    const cleanReg = registration.replace(/\s+/g, '').toUpperCase();
    const accessToken = await this.getAccessToken();

    try {
      logger.info(`Fetching MOT history for ${cleanReg}`);

      const response = await fetch(
        `${this.baseUrl}/v1/trade/vehicles/registration/${cleanReg}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-API-Key': this.config.apiKey,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`No MOT history found for ${cleanReg}`);
        }
        if (response.status === 429) {
          throw new Error('MOT API rate limit exceeded');
        }
        const errorText = await response.text();
        throw new Error(`MOT API request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      logger.info(`MOT history retrieved successfully for ${cleanReg}`);
      return data;

    } catch (error: any) {
      logger.error(`Failed to fetch MOT history for ${cleanReg}`, error);
      throw error;
    }
  }

  /**
   * Get MOT expiry date for a vehicle
   * Extracts the most relevant MOT expiry information
   */
  async getMotExpiryData(registration: string): Promise<MotExpiryData> {
    const history = await this.getMotHistory(registration);

    // Sort MOT tests by date (most recent first)
    const sortedTests = (history.motTests || []).sort((a, b) => 
      new Date(b.completedDate).getTime() - new Date(a.completedDate).getTime()
    );

    const latestTest = sortedTests[0];
    const latestPassedTest = sortedTests.find(test => test.testResult === 'PASSED');

    // Determine MOT status and expiry
    let motStatus = 'Unknown';
    let motExpiryDate: string | null = null;

    if (latestPassedTest) {
      motExpiryDate = latestPassedTest.expiryDate || null;
      
      if (motExpiryDate) {
        const expiryTimestamp = new Date(motExpiryDate).getTime();
        const now = Date.now();
        
        if (expiryTimestamp > now) {
          motStatus = 'Valid';
        } else {
          motStatus = 'Expired';
        }
      } else {
        motStatus = 'No Expiry Date';
      }
    } else if (sortedTests.length === 0) {
      // No MOT tests yet - check if API provides motTestDueDate for new vehicles
      if (history.motTestDueDate) {
        motExpiryDate = history.motTestDueDate;
        motStatus = 'Not Yet Due';
      } else {
        motStatus = 'No MOT History';
      }
    } else {
      motStatus = 'No Valid MOT';
    }

    return {
      registration: history.registration,
      motExpiryDate,
      motStatus,
      lastTestDate: latestTest?.completedDate || null,
      lastTestResult: latestTest?.testResult || null,
      rawData: history,
    };
  }
}

/**
 * Create MOT History API service instance from environment variables
 */
export function createMotHistoryService(): MotHistoryService | null {
  const clientId = process.env.MOT_API_CLIENT_ID;
  const clientSecret = process.env.MOT_API_CLIENT_SECRET;
  const scope = process.env.MOT_API_SCOPE;
  const accessTokenUrl = process.env.MOT_API_ACCESS_TOKEN_URL;
  const apiKey = process.env.MOT_API_KEY;

  if (!clientId || !clientSecret || !scope || !accessTokenUrl || !apiKey) {
    logger.warn('MOT History API credentials not configured');
    return null;
  }

  return new MotHistoryService({
    clientId,
    clientSecret,
    scope,
    accessTokenUrl,
    apiKey,
  });
}

