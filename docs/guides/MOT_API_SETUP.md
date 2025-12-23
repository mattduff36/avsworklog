# MOT History API Setup Guide

This guide explains how to integrate the official GOV.UK MOT History API to retrieve MOT test history and expiry dates for vehicles.

## Overview

The **MOT History API** from the Driver and Vehicle Standards Agency (DVSA) provides:
- Complete MOT test history since 2005 (GB) and 2017 (NI)
- MOT expiry dates
- Test results, odometer readings, and defects
- Coverage for all vehicle types (cars, vans, motorcycles, HGVs, trailers, buses)

**Documentation**: https://documentation.history.mot.api.gov.uk/

## Why We Use This API

The VES (Vehicle Enquiry Service) API provides tax information but **only provides MOT status as text** (e.g., "Valid"), not the actual expiry date. The MOT History API fills this gap by providing:
- ✅ Actual MOT expiry dates
- ✅ Complete test history
- ✅ Test results and advisory items

## Registration Process

1. **Register for API Access**:
   - Visit: https://documentation.history.mot.api.gov.uk/mot-history-api/register
   - Provide: Name, email, postal address, organization details
   - Review time: Up to 5 working days

2. **Receive Credentials**:
   You'll receive 5 pieces of information:
   - **Client ID** - OAuth 2.0 client identifier
   - **Client Secret** - OAuth 2.0 client secret (expires every 2 years)
   - **Scope** - OAuth 2.0 scope URL
   - **Access Token URL** - OAuth 2.0 token endpoint
   - **API Key** - API authentication key

## Environment Variables

Add these variables to your `.env.local` (development) and Vercel Environment Variables (production):

```bash
# MOT History API Configuration (GOV.UK DVSA)
MOT_API_CLIENT_ID=your_client_id_here
MOT_API_CLIENT_SECRET=your_client_secret_here
MOT_API_SCOPE=https://history.mot.api.gov.uk/.default
MOT_API_ACCESS_TOKEN_URL=https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token
MOT_API_KEY=your_api_key_here
```

**Note**: Replace `{tenant_id}` in the access token URL with the actual tenant ID provided in your registration email.

## Authentication Flow

The MOT History API uses **OAuth 2.0 with client credentials**:

1. Request an access token using client_id and client_secret
2. Access tokens are valid for **60 minutes**
3. Tokens are cached and automatically refreshed
4. Every API request requires:
   - `Authorization: Bearer {access_token}` header
   - `X-API-Key: {api_key}` header

## Rate Limits

- **500,000 requests per day** (quota)
- **15 requests per second** (average)
- **10 requests in burst**

Exceeding limits returns HTTP 429 (Too Many Requests).

## Integration with Existing DVLA Sync

The system now uses **two APIs together**:

### VES API (Vehicle Enquiry Service)
- Tax status and tax due date
- Vehicle details (make, color, engine, fuel type, year)
- Basic MOT status text only

### MOT History API
- **MOT expiry dates** (the missing piece!)
- Complete MOT test history
- Test results and defects

### Combined Workflow

When syncing a vehicle:
1. **VES API** → Get tax due date + vehicle details
2. **MOT History API** → Get MOT expiry date
3. **Store both** in the database
4. Display comprehensive vehicle information to users

## Usage in Code

```typescript
import { createMotHistoryService } from '@/lib/services/mot-history-api';

// Create service instance
const motService = createMotHistoryService();

if (motService) {
  // Get MOT expiry data
  const motData = await motService.getMotExpiryData('AB12CDE');
  
  console.log(motData.motExpiryDate);    // "2026-07-15"
  console.log(motData.motStatus);        // "Valid"
  console.log(motData.lastTestDate);     // "2025-06-20"
  console.log(motData.lastTestResult);   // "PASSED"
}
```

## Testing

1. **Test with Your Own Vehicle**:
   ```bash
   # Set up environment variables first
   npx tsx scripts/test-mot-api.ts YOUR_REG_NUMBER
   ```

2. **Verify Token Caching**:
   - First request: Obtains new access token
   - Subsequent requests (within 60 mins): Uses cached token
   - Check logs for "Requesting new MOT History API access token" vs cached usage

3. **Test Rate Limiting**:
   - Bulk sync respects 15 RPS limit (1-second delay between requests)
   - Monitor for HTTP 429 responses

## Security Notes

- **Never commit credentials** to Git
- Store all 5 credentials securely in environment variables
- Client secrets expire every 2 years - you'll receive email reminders
- Rotate secrets immediately if compromised

## Troubleshooting

### "Token request failed"
- Check client_id and client_secret are correct
- Verify access_token_url includes correct tenant_id
- Ensure no extra spaces in environment variables

### "MOT API request failed: 404"
- Vehicle registration not found in MOT database
- Check VRN is correct (no spaces, uppercase)
- Some vehicles may not have MOT history if:
  - Brand new (under 3 years old)
  - Exempt from MOT testing
  - Northern Ireland vehicle tested before 2017

### "Rate limit exceeded" (HTTP 429)
- Wait before retrying
- Check you haven't exceeded 500,000 requests/day
- Ensure bulk operations have delays between requests

### "No MOT history found"
- Vehicle may be too new (< 3 years old)
- Could be MOT-exempt (historic vehicles, some electric vehicles)
- May not be in the system yet

## Support

- **API Documentation**: https://documentation.history.mot.api.gov.uk/
- **Register**: https://documentation.history.mot.api.gov.uk/mot-history-api/register
- **Support**: Use the "Get support" link on the documentation site
- **API Status**: https://documentation.history.mot.api.gov.uk/mot-history-api/status

## Next Steps

Once you receive your API credentials:
1. Add environment variables
2. Test with a known vehicle registration
3. Run bulk sync to populate MOT expiry dates for all vehicles
4. Monitor sync logs for any errors
5. Set up weekly cron job to keep data current

