# Mobile Draft Inspection Save Issue - Investigation & Fix

## Issue Reported

Mobile users were unable to edit and save existing draft inspections.

## Investigation Approach

Instead of making blind fixes, I implemented a comprehensive error logging and debugging system to:

1. **Capture the actual error** when it occurs on mobile
2. **Provide detailed context** about what's happening during the save process
3. **Enable remote debugging** without needing direct access to the user's device

## Solution Implemented

### 1. Global Error Logging System

Created a production-ready error logging system that automatically captures:

- ✅ All unhandled JavaScript errors
- ✅ Unhandled promise rejections  
- ✅ Console.error calls (filtered)
- ✅ Manual error logs from components
- ✅ Complete stack traces
- ✅ User context (ID, email, device)
- ✅ Page URL and user agent
- ✅ Additional custom context data

**Files Created:**
- `lib/utils/error-logger.ts` - Core error logging functionality
- `components/ErrorLoggerInit.tsx` - Initializer component
- `supabase/migrations/20241201_error_logs_table.sql` - Database schema
- `scripts/run-error-logs-migration.ts` - Migration runner script

### 2. Error Log Tab in Debug Page

Added a new **Error Log** tab to `/debug` (first tab) that shows:

- Last 100 errors in chronological order
- Error messages with full stack traces
- User who experienced the error
- Page URL where it occurred
- Device type (Mobile/Desktop indicators)
- Browser information
- Additional context data
- Ability to clear all logs

**Access:** SuperAdmin only (`admin@mpdee.co.uk`)

### 3. Enhanced Mobile Inspection Debugging

Added detailed logging to the inspection save process:

```
[Mobile Debug] Starting save...
[Mobile Debug] Inspection updated successfully
[Mobile Debug] Deleting existing items...
[Mobile Debug] Existing items deleted successfully
[Mobile Debug] Items to insert: { count: X, sample: {...} }
[Mobile Debug] Items inserted successfully
[Mobile Debug] Save completed, refreshing data...
[Mobile Debug] Save process complete!
```

**Benefits:**
- Can see exactly which step fails (if any)
- Tracks item counts and data being saved
- Automatically logs errors to error_logs table
- Errors visible in debug console without mobile access

## Next Steps

### 1. Create the Database Table

Run this SQL in Supabase Dashboard → SQL Editor:

```sql
-- Copy from: supabase/migrations/20241201_error_logs_table.sql
```

Or try the automated script:
```bash
npx tsx scripts/run-error-logs-migration.ts
```

### 2. Test on Mobile

1. Open a draft inspection on your iPhone
2. Make edits to some items
3. Click "Save Changes"
4. Watch for any errors (check browser console too)

### 3. Check Error Logs

1. On desktop, go to `/debug`
2. Click **Error Log** tab
3. Look for any errors from the mobile save attempt
4. Expand stack traces and additional data for clues

### 4. If No Errors Appear

If the save works without errors, the issue may have been intermittent or browser-specific. The logging system will capture it if it happens again.

### 5. If Errors Appear

Share the error details from the Error Log tab:
- Error message
- Stack trace
- Additional data (especially `itemCount`, `itemsWithStatus`, `isMobile`)
- Page URL

## Manual Error Testing

To test the error logger works, open browser console and run:

```javascript
window.errorLogger.logError({
  error: new Error('Test error'),
  componentName: 'Manual Test',
  additionalData: { test: true }
});
```

Then refresh the Error Log tab to see your test error.

## What This Solves

### Before
- Mobile errors happened silently
- No way to know what went wrong
- Had to guess at fixes
- Couldn't debug without device access

### After
- All errors automatically logged with context
- Can see exact error messages and stack traces
- Know which user, device, and page had the issue
- Can debug remotely via Error Log tab
- Mobile-specific logs show save process step-by-step

## Documentation

See `docs/ERROR_LOGGING_SYSTEM.md` for:
- Complete system overview
- Usage examples
- Monitoring best practices
- Troubleshooting guide
- Future enhancement ideas

