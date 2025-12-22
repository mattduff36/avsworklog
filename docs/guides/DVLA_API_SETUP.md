# DVLA API Integration Setup Guide

## Overview

The DVLA API integration allows automatic syncing of vehicle tax and MOT expiry dates from official DVLA data sources through third-party providers.

## ⚠️ Important Note

**DVLA does not provide a public API directly**. This integration uses approved third-party services that access DVLA data. You'll need to sign up with one of the supported providers.

---

## Supported Providers

### 1. Vehicle Smart (Recommended)
- **Website**: https://vehiclesmart.com/
- **Features**: Tax status, MOT data, comprehensive vehicle information
- **Pricing**: Pay-per-request or monthly plans
- **Sign Up**: Contact them for API access

### 2. Check Car Details UK
- **Website**: https://api.checkcardetails.co.uk/
- **Features**: VRM lookup, tax/MOT status, vehicle specs
- **Pricing**: Flexible pricing tiers
- **Sign Up**: Register on their website

### 3. Vehicle Data Global Limited
- **Website**: https://vehicledataglobal.com/
- **Features**: Live DVLA calls, 1-10 requests/second
- **Pricing**: Standard and premium tiers
- **Sign Up**: Request access via their website

---

## Setup Instructions

### Step 1: Choose a Provider

1. Review the providers above
2. Consider your budget and request volume
3. Sign up for an account
4. Obtain your API key and base URL

### Step 2: Configure Environment Variables

Add these variables to your `.env.local` file:

```bash
# DVLA API Configuration
# Provider: 'vehiclesmart' | 'checkcardetails' | 'vehicledataglobal'
DVLA_API_PROVIDER=vehiclesmart

# API Key from your provider
DVLA_API_KEY=your_api_key_here

# Base URL for API requests
DVLA_API_BASE_URL=https://api.vehiclesmart.com/v1

# Example for Check Car Details UK:
# DVLA_API_PROVIDER=checkcardetails
# DVLA_API_KEY=your_api_key_here
# DVLA_API_BASE_URL=https://api.checkcardetails.co.uk/v1

# Example for Vehicle Data Global:
# DVLA_API_PROVIDER=vehicledataglobal
# DVLA_API_KEY=your_api_key_here
# DVLA_API_BASE_URL=https://api.vehicledataglobal.com
```

### Step 3: Verify Configuration

1. Restart your Next.js development server:
   ```bash
   npm run dev
   ```

2. Navigate to the Maintenance module
3. Look for the sync icon (🔄) next to each vehicle
4. Click to test syncing a vehicle

### Step 4: Test the Integration

1. Choose a vehicle with a valid UK registration number
2. Click the sync button (refresh icon)
3. Check for success/error message
4. Verify that tax/MOT dates are updated

---

## How It Works

### Automatic Syncing

1. **Manual Sync**: Click the refresh icon next to any vehicle
2. **Sync Status Indicators**:
   - 🔵 Blue: Ready to sync / Never synced
   - 🟢 Green: Last sync successful
   - 🔴 Red: Last sync failed
   - 🟡 Yellow: Never synced before
   - ⏳ Spinning: Sync in progress

### Data Stored

The integration stores:
- Tax due date
- MOT expiry date
- Last sync timestamp
- Sync status (success/error)
- Raw API response (for debugging)

### Audit Trail

Every sync operation is logged in the `dvla_sync_log` table with:
- Vehicle details
- Fields updated
- Old and new values
- API provider used
- Response time
- User who triggered it

---

## Cost Considerations

### Request Volume

Each vehicle sync = 1 API request

**Typical Usage**:
- 50 vehicles synced weekly = ~200 requests/month
- 50 vehicles synced daily = ~1,500 requests/month

### Provider Costs

Check with your chosen provider for current pricing. Most offer:
- Free trial periods
- Pay-per-request pricing
- Monthly subscription tiers
- Volume discounts

---

## API Response Examples

### Vehicle Smart Response
```json
{
  "RegistrationNumber": "AB12 CDE",
  "TaxStatus": "Taxed",
  "TaxDueDate": "2026-03-31",
  "MotStatus": "Valid",
  "MotExpiryDate": "2026-07-15",
  "Make": "FORD",
  "Model": "TRANSIT",
  "Colour": "WHITE"
}
```

### Check Car Details UK Response
```json
{
  "vrm": "AB12CDE",
  "vehicleTaxStatus": "Taxed",
  "vehicleTaxDueDate": "2026-03-31",
  "motStatus": "Valid",
  "motExpiryDate": "2026-07-15",
  "make": "FORD",
  "model": "TRANSIT"
}
```

---

## Troubleshooting

### "DVLA API Not Configured" Error

**Solution**: Check that all three environment variables are set in `.env.local`:
- `DVLA_API_PROVIDER`
- `DVLA_API_KEY`
- `DVLA_API_BASE_URL`

### "API Request Failed" Error

**Possible Causes**:
1. Invalid API key
2. Incorrect base URL
3. Rate limit exceeded
4. Provider service down
5. Invalid vehicle registration

**Solutions**:
- Verify API key is correct
- Check base URL matches provider's documentation
- Review provider's rate limits
- Check vehicle registration format (e.g., "AB12 CDE" vs "AB12CDE")

### Vehicle Not Found

Some vehicles may not be in the DVLA database if they are:
- Very new (not yet registered)
- Historic vehicles
- Imported vehicles
- Invalid registrations

### Sync Taking Too Long

- Check your internet connection
- Verify provider's API status
- Check rate limiting settings
- Consider increasing timeout settings

---

## Security Best Practices

1. **Never commit `.env.local` to Git**
   - Already in `.gitignore`
   - Contains sensitive API keys

2. **Rotate API Keys Regularly**
   - Change keys every 90 days
   - Update in `.env.local` after rotation

3. **Monitor API Usage**
   - Track requests in provider dashboard
   - Set up usage alerts
   - Review sync logs regularly

4. **Limit Access**
   - Only maintenance module users can sync
   - Audit trail tracks who synced what

---

## Database Schema

### vehicle_maintenance (extended)
```sql
-- DVLA sync fields
last_dvla_sync TIMESTAMP      -- Last successful sync
dvla_sync_status VARCHAR(20)  -- 'never', 'success', 'error', 'pending'
dvla_sync_error TEXT           -- Error message if failed
dvla_raw_data JSONB            -- Complete API response
```

### dvla_sync_log
```sql
-- Audit trail of all sync operations
id UUID
vehicle_id UUID
registration_number VARCHAR(20)
sync_status VARCHAR(20)
error_message TEXT
fields_updated TEXT[]          -- Array of updated fields
tax_due_date_old DATE
tax_due_date_new DATE
mot_due_date_old DATE
mot_due_date_new DATE
api_provider VARCHAR(50)
api_response_time_ms INTEGER
raw_response JSONB
triggered_by UUID
trigger_type VARCHAR(20)       -- 'manual', 'automatic', 'bulk'
created_at TIMESTAMP
```

---

## Future Enhancements

### Planned Features
- [ ] Bulk sync all vehicles button
- [ ] Automatic scheduled syncing (daily/weekly)
- [ ] Email alerts for expiring tax/MOT
- [ ] Sync history dashboard
- [ ] Support for additional providers
- [ ] Rate limit handling
- [ ] Retry failed syncs automatically

### Provider Support Roadmap
- ✅ Vehicle Smart
- ✅ Check Car Details UK
- ✅ Vehicle Data Global
- 🔄 Additional providers on request

---

## Support

### Need Help?

1. Check the troubleshooting section above
2. Review provider documentation
3. Check sync logs in the database:
   ```sql
   SELECT * FROM dvla_sync_log 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```
4. Contact your API provider's support

### API Provider Support

- **Vehicle Smart**: support@vehiclesmart.com
- **Check Car Details UK**: Via their website contact form
- **Vehicle Data Global**: dvlaapiaccess@dvla.gov.uk

---

**Last Updated**: December 22, 2025  
**Version**: 1.0  
**Status**: ✅ Production Ready

