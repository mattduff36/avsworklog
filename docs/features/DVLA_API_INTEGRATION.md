# DVLA API Integration Feature

## Overview

Automated vehicle tax and MOT date synchronization from DVLA data through third-party API providers.

## ✅ Status: Production Ready

**Implemented**: December 22, 2025

---

## Features

### 🔄 Automatic Data Sync
- One-click sync for individual vehicles
- Fetches tax due dates
- Fetches MOT expiry dates
- Updates maintenance records automatically

### 📊 Sync Status Tracking
- Visual indicators for sync status
- Last sync timestamp
- Error messages for failed syncs
- Complete audit trail

### 🔐 Security
- API keys stored in environment variables
- RLS policies enforce access control
- Full audit logging
- No sensitive data exposed

### 🎨 User Interface
- Sync button on each vehicle row
- Status icons with tooltips
- Color-coded sync states
- Toast notifications

---

## Quick Start

### 1. Choose a Provider

Select from supported providers:
- **Vehicle Smart** (recommended)
- **Check Car Details UK**
- **Vehicle Data Global**

### 2. Get API Credentials

Sign up with your chosen provider and obtain:
- API Key
- Base URL
- Provider identifier

### 3. Configure Environment

Add to `.env.local`:

```bash
DVLA_API_PROVIDER=vehiclesmart
DVLA_API_KEY=your_api_key_here
DVLA_API_BASE_URL=https://api.vehiclesmart.com/v1
```

### 4. Start Syncing

1. Go to Maintenance module
2. Click the sync icon (🔄) next to any vehicle
3. Watch for success notification
4. Verify updated tax/MOT dates

---

## Components

### Backend Services

**lib/services/dvla-api.ts**
- Multi-provider support
- Request normalization
- Error handling
- Response parsing

**app/api/maintenance/sync-dvla/route.ts**
- Sync endpoint
- Single and bulk operations
- Audit logging
- Status tracking

### Frontend Components

**app/(dashboard)/maintenance/components/DVLASyncButton.tsx**
- Interactive sync button
- Status indicators
- Tooltips
- Loading states

### Database

**Migrations**:
- `20251222_add_dvla_sync_tracking.sql` - Adds sync tracking fields

**Tables Extended**:
- `vehicle_maintenance` - Adds DVLA sync columns
- `dvla_sync_log` - New audit trail table

---

## Sync Status Indicators

| Icon | Color | Status | Meaning |
|------|-------|--------|---------|
| 🔄 | Blue | Ready | Never synced or ready to sync |
| ✅ | Green | Success | Last sync successful |
| ❌ | Red | Error | Last sync failed |
| ⚠️ | Yellow | Warning | Never synced before |
| ⏳ | Gray | Loading | Sync in progress |

---

## API Flow

```
User clicks sync button
    ↓
Frontend sends POST /api/maintenance/sync-dvla
    ↓
Backend validates auth & config
    ↓
DVLAApiService.getVehicleData(reg)
    ↓
Provider API request
    ↓
Response normalization
    ↓
Update vehicle_maintenance table
    ↓
Log to dvla_sync_log
    ↓
Return success/error to frontend
    ↓
Toast notification
```

---

## Provider Integration

### Vehicle Smart
```typescript
{
  provider: 'vehiclesmart',
  endpoint: '/vehicledata',
  method: 'POST',
  auth: 'Bearer token'
}
```

### Check Car Details UK
```typescript
{
  provider: 'checkcardetails',
  endpoint: '/vehicle/{reg}',
  method: 'GET',
  auth: 'x-api-key header'
}
```

### Vehicle Data Global
```typescript
{
  provider: 'vehicledataglobal',
  endpoint: '/vehicle',
  method: 'POST',
  auth: 'x-api-key header'
}
```

---

## Error Handling

### API Not Configured
- **Status**: 503 Service Unavailable
- **Message**: "DVLA API not configured"
- **Solution**: Set environment variables

### Vehicle Not Found
- **Status**: 404 Not Found
- **Message**: "Vehicle not found in DVLA database"
- **Solution**: Verify registration number

### Rate Limit Exceeded
- **Status**: 429 Too Many Requests
- **Message**: "Rate limit exceeded"
- **Solution**: Wait or upgrade plan

### Invalid API Key
- **Status**: 401 Unauthorized
- **Message**: "Invalid API key"
- **Solution**: Check API key in `.env.local`

---

## Audit Trail

Every sync operation logs:

```sql
SELECT 
  registration_number,
  sync_status,
  fields_updated,
  tax_due_date_old,
  tax_due_date_new,
  mot_due_date_old,
  mot_due_date_new,
  api_response_time_ms,
  created_at
FROM dvla_sync_log
ORDER BY created_at DESC;
```

---

## Cost Optimization

### Strategies

1. **Manual Sync Only**
   - User-initiated syncs
   - No scheduled jobs
   - Minimal API usage

2. **Scheduled Sync** (Future)
   - Weekly batch sync
   - Off-peak hours
   - Estimated: 200 requests/month for 50 vehicles

3. **Smart Sync** (Future)
   - Only sync vehicles with expiring dates
   - Skip recently synced vehicles
   - Estimated: 50% reduction

### Monitoring

Track usage in provider dashboard:
- Total requests this month
- Cost per request
- Projected monthly cost
- Rate limit status

---

## Testing

### Manual Testing

1. Configure test API credentials
2. Select a vehicle with valid UK registration
3. Click sync button
4. Verify:
   - Success toast appears
   - Tax/MOT dates updated
   - Sync status icon changes
   - Audit log entry created

### Test Registrations

Use real UK registrations from your fleet:
- Format: "AB12 CDE" or "AB12CDE"
- Must exist in DVLA database
- Active tax/MOT status

---

## Future Enhancements

### Planned
- [ ] Bulk sync all vehicles button
- [ ] Automatic scheduled syncing
- [ ] Email alerts for sync failures
- [ ] Sync history dashboard
- [ ] Retry failed syncs
- [ ] Cache responses (24 hours)

### Under Consideration
- [ ] Multiple provider fallback
- [ ] Real-time webhooks
- [ ] MOT history tracking
- [ ] Insurance data integration

---

## Documentation

**Setup Guide**: `docs/guides/DVLA_API_SETUP.md`  
**API Reference**: `lib/services/dvla-api.ts`  
**Types**: `types/dvla-api.ts`

---

## Support

**Configuration Issues**: Check `DVLA_API_SETUP.md`  
**API Errors**: Check provider documentation  
**Bug Reports**: Contact development team

---

**Feature Owner**: Lyra AI  
**Date Implemented**: December 22, 2025  
**Version**: 1.0  
**Status**: ✅ Production Ready

