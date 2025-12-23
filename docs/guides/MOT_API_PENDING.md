# MOT History API - Pending Integration

## Status: ⏳ **Awaiting API Credentials**

The MOT History API integration is **fully prepared** and ready to activate once you receive your API credentials from DVSA.

## What's Been Prepared

✅ **Service Layer** (`lib/services/mot-history-api.ts`)
- OAuth 2.0 authentication with token caching
- MOT history data retrieval by VRN
- Rate limiting and error handling

✅ **Database Schema**
- `mot_expiry_date` field for storing actual MOT expiry dates
- MOT API sync tracking fields
- Migration ready to run: `20251223_add_mot_expiry_date.sql`

✅ **Types**
- TypeScript interfaces for MOT API responses
- Type-safe data handling

✅ **Documentation**
- Complete setup guide (`MOT_API_SETUP.md`)
- Environment variable reference
- Troubleshooting guide

## When Your API Credentials Arrive

You'll receive an email with **5 credentials**:
1. **Client ID**
2. **Client Secret**
3. **Scope URL**
4. **Access Token URL**
5. **API Key**

### Activation Steps

#### 1. **Add Environment Variables**

Add to `.env.local` (development):
```bash
# MOT History API Configuration
MOT_API_CLIENT_ID=your_client_id_here
MOT_API_CLIENT_SECRET=your_client_secret_here
MOT_API_SCOPE=https://history.mot.api.gov.uk/.default
MOT_API_ACCESS_TOKEN_URL=https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token
MOT_API_KEY=your_api_key_here
```

Add to **Vercel Environment Variables** (production):
- Same 5 variables as above
- Available for all environments (Production, Preview, Development)

#### 2. **Run Database Migration**

```bash
# Test environment connection
npm run db:test

# Run migration
npx tsx scripts/run-mot-expiry-migration.ts
```

This adds:
- `mot_expiry_date` - The actual MOT expiry date
- `mot_api_sync_status` - Sync status tracking
- `mot_api_sync_error` - Error logging
- `last_mot_api_sync` - Last sync timestamp
- `mot_raw_data` - Raw API response storage

#### 3. **Test the Integration**

Create test script:
```typescript
// scripts/test-mot-api.ts
import { createMotHistoryService } from '@/lib/services/mot-history-api';

async function test() {
  const service = createMotHistoryService();
  
  if (!service) {
    console.error('MOT API not configured');
    return;
  }

  const data = await service.getMotExpiryData('VO23UKG'); // Use your VRN
  console.log('MOT Expiry:', data.motExpiryDate);
  console.log('Status:', data.motStatus);
  console.log('Last Test:', data.lastTestDate);
}

test();
```

Run:
```bash
npx tsx scripts/test-mot-api.ts
```

#### 4. **Update DVLA Sync to Include MOT Data**

Modify `lib/services/dvla-api.ts` to call both APIs:
```typescript
// Fetch VES data (tax info)
const vesData = await dvlaService.getVehicleData(regNumber);

// Fetch MOT data (expiry date)
const motService = createMotHistoryService();
const motData = motService ? await motService.getMotExpiryData(regNumber) : null;

// Store both in database
await supabase
  .from('vehicle_maintenance')
  .update({
    // VES data
    tax_due_date: vesData.taxDueDate,
    ves_tax_status: vesData.taxStatus,
    // ... other VES fields ...
    
    // MOT data
    mot_expiry_date: motData?.motExpiryDate,
    mot_api_sync_status: motData ? 'success' : 'error',
    last_mot_api_sync: new Date().toISOString(),
    mot_raw_data: motData?.rawData
  });
```

#### 5. **Run Bulk Sync**

Once tested, sync all vehicles:
1. Go to `/debug` page
2. Click "DVLA Sync" tab
3. Click "Sync All Vehicles"
4. Monitor progress (will now fetch both tax AND MOT data)

#### 6. **Verify in UI**

Open any vehicle's maintenance history:
- Should now show **MOT Expiry Date** (from MOT History API)
- Should show **Tax Due Date** (from VES API)
- Both fields populated automatically

## What This Solves

**Before**: VES API only provided MOT status as text ("Valid", "No details held")  
**After**: MOT History API provides actual expiry dates ("2026-07-15")

## Benefits

✅ **Accurate MOT tracking** - Actual expiry dates, not just status  
✅ **Proactive alerts** - Know exactly when MOT is due  
✅ **Complete history** - Access to all past MOT tests  
✅ **Test results** - See passes, failures, and advisory items  
✅ **Automated updates** - Weekly sync keeps data current  

## Rate Limits (Very Generous!)

- **500,000 requests/day** - More than enough for your fleet
- **15 requests/second** - Fast bulk operations
- **10 burst requests** - Handle spikes

For ~55 vehicles syncing weekly: **~3,000 requests/year** (well under limit!)

## Support

Once activated:
- Monitor logs in `/debug` page
- Check `last_mot_api_sync` timestamps
- Review `mot_api_sync_error` for any failures

Questions? See:
- 📖 `docs/guides/MOT_API_SETUP.md` - Complete setup guide
- 🌐 https://documentation.history.mot.api.gov.uk/ - Official docs

## When You're Ready

Just say: **"I received my MOT API credentials"** and share them securely (or add them to `.env.local` yourself).

I'll then:
1. Help add them to environment variables
2. Run the migration
3. Test with a real vehicle
4. Integrate with existing sync
5. Run bulk sync
6. Verify everything works!

---

**Status**: 🟡 Ready to activate when credentials arrive  
**Impact**: 🚀 Major improvement - Real MOT expiry dates for all vehicles

