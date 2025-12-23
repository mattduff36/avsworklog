# DVLA VES API - Scheduled Sync Setup

## Overview

Automated weekly syncing of vehicle tax due dates from GOV.UK VES API using Vercel Cron Jobs.

---

## 📅 Schedule

**Current Configuration**: Every Sunday at 2:00 AM UTC

```json
{
  "crons": [
    {
      "path": "/api/maintenance/sync-dvla-scheduled",
      "schedule": "0 2 * * 0"
    }
  ]
}
```

### Cron Schedule Format

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday = 0)
│ │ │ │ │
│ │ │ │ │
0 2 * * 0  = Every Sunday at 2:00 AM UTC
```

### Alternative Schedules

```json
// Every day at 3 AM
"schedule": "0 3 * * *"

// Every Monday at 1 AM
"schedule": "0 1 * * 1"

// Twice per week (Monday and Thursday at 2 AM)
"schedule": "0 2 * * 1,4"
```

---

## 🔧 Setup Instructions

### 1. Add Cron Secret (Security)

Add to Vercel Environment Variables:

```bash
CRON_SECRET=your_random_secret_here_min_32_chars
```

**Generate a secure secret:**
```bash
# On Mac/Linux
openssl rand -base64 32

# Or use online generator
https://www.random.org/strings/
```

### 2. Deploy to Vercel

The `vercel.json` file is already configured. Just deploy:

```bash
git push origin main
```

Vercel will automatically detect and register the cron job.

### 3. Verify Cron Job

1. Go to Vercel Dashboard → Your Project
2. Navigate to **Settings → Cron Jobs**
3. You should see: `/api/maintenance/sync-dvla-scheduled`
4. Status should be **Active**

---

## 🎯 How It Works

### Sync Logic

1. **Runs weekly** (Sunday 2 AM UTC)
2. **Fetches all active vehicles** from database
3. **Filters vehicles** that haven't been synced in 6+ days
4. **Syncs each vehicle** with 1-second delay between requests
5. **Updates tax due dates** from DVLA VES API
6. **Logs all operations** to `dvla_sync_log` table

### Smart Syncing

- ✅ Only syncs vehicles not updated in last 6 days
- ✅ Skips recently synced vehicles (saves API quota)
- ✅ 1-second delay between requests (respects rate limits)
- ✅ Continues on individual failures
- ✅ Complete audit trail

### Example Output

```json
{
  "success": true,
  "total": 55,
  "synced": 48,
  "successful": 47,
  "failed": 1,
  "skipped": 7
}
```

---

## 📊 Monitoring

### Check Cron Execution Logs

1. Vercel Dashboard → Your Project → **Logs**
2. Filter by: `/api/maintenance/sync-dvla-scheduled`
3. View execution history and results

### Check Sync Audit Trail

Query the database:

```sql
SELECT 
  registration_number,
  sync_status,
  fields_updated,
  tax_due_date_new,
  trigger_type,
  created_at
FROM dvla_sync_log
WHERE trigger_type = 'automatic'
ORDER BY created_at DESC
LIMIT 50;
```

### Check Last Sync Times

```sql
SELECT 
  v.reg_number,
  vm.last_dvla_sync,
  vm.dvla_sync_status,
  vm.tax_due_date
FROM vehicle_maintenance vm
JOIN vehicles v ON v.id = vm.vehicle_id
WHERE v.status = 'active'
ORDER BY vm.last_dvla_sync DESC NULLS LAST;
```

---

## 💰 Cost Estimation

### API Usage

- **55 active vehicles** (example)
- **Weekly sync** = ~48 vehicles per week (7 skipped as recently synced)
- **Monthly usage** = ~192 API calls/month

### Vercel Cron

- **Hobby Plan**: 100 cron invocations/month (FREE)
- **Pro Plan**: Unlimited cron invocations

### DVLA VES API

Check your API plan for:
- Requests per second limit
- Monthly quota
- Pricing per request

---

## 🔍 Testing

### Manual Test (Before Enabling Cron)

Test the endpoint manually:

```bash
curl -X POST https://your-app.vercel.app/api/maintenance/sync-dvla-scheduled \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### Test in Debug Page

Go to `/debug` → DVLA Sync tab → "Sync All Vehicles"

This uses the same logic but triggered manually.

---

## 🚨 Troubleshooting

### Cron Job Not Running

**Check:**
1. Vercel Dashboard → Settings → Cron Jobs shows "Active"
2. `vercel.json` is in project root
3. Latest deployment includes `vercel.json`

**Solution:** Redeploy the project

### 401 Unauthorized Error

**Cause:** Missing or incorrect `CRON_SECRET`

**Solution:**
1. Add `CRON_SECRET` to Vercel environment variables
2. Redeploy

### API Rate Limit Errors

**Cause:** Too many requests too fast

**Solution:**
- Increase delay between requests (currently 1 second)
- Reduce sync frequency (e.g., bi-weekly instead of weekly)
- Contact DVLA to increase rate limit

### Some Vehicles Failing

**Check sync logs:**
```sql
SELECT * FROM dvla_sync_log 
WHERE sync_status = 'error' 
ORDER BY created_at DESC;
```

**Common causes:**
- Vehicle not in DVLA database
- Invalid registration number
- Temporary API issue

---

## ⚙️ Configuration

### Change Sync Frequency

Edit `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/maintenance/sync-dvla-scheduled",
      "schedule": "0 3 * * *"  // Daily at 3 AM
    }
  ]
}
```

Then redeploy.

### Change Delay Between Requests

Edit `app/api/maintenance/sync-dvla-scheduled/route.ts`:

```typescript
// Change from 1000ms to 2000ms (2 seconds)
await new Promise(resolve => setTimeout(resolve, 2000));
```

### Change "Recently Synced" Threshold

Edit `app/api/maintenance/sync-dvla-scheduled/route.ts`:

```typescript
// Change from 6 days to 3 days
const sixDaysAgo = new Date();
sixDaysAgo.setDate(sixDaysAgo.getDate() - 3);
```

---

## 📧 Notifications (Future Enhancement)

Consider adding email notifications for:
- Cron job failures
- High failure rate (>10%)
- API quota warnings

Example integration: Vercel Log Drains + Email service

---

## 🔐 Security

### Cron Secret

- **Required** for production
- **32+ characters** recommended
- **Rotate regularly** (every 90 days)

### API Key

- Stored in Vercel environment variables
- Never committed to Git
- Rotate if compromised

---

## 📚 Related Documentation

- **Setup Guide**: `docs/guides/DVLA_API_SETUP.md`
- **Feature Docs**: `docs/features/DVLA_API_INTEGRATION.md`
- **VES API Docs**: https://developer-portal.driver-vehicle-licensing.api.gov.uk/

---

**Last Updated**: December 22, 2025  
**Status**: ✅ Ready for Production  
**Cron Schedule**: Every Sunday at 2:00 AM UTC

