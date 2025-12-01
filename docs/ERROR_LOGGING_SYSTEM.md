# Error Logging System

## Overview

A comprehensive error logging system has been implemented to track and debug application errors, especially those occurring on mobile devices.

## Components

### 1. Error Logger (`lib/utils/error-logger.ts`)

The global error logger automatically captures:
- Unhandled JavaScript errors
- Unhandled promise rejections
- Console.error calls (filtered to exclude React warnings)
- Manual error logs from components

**Features:**
- Automatically captures user context (user ID, email)
- Records page URL, user agent, and timestamp
- Stores stack traces for debugging
- Supports additional context data
- Queues errors for batch insertion

**Usage in Components:**

```typescript
import { errorLogger } from '@/lib/utils/error-logger';

// Log an error
errorLogger.logError({
  error: new Error('Something went wrong'),
  componentName: 'MyComponent',
  additionalData: {
    someContext: 'value',
    itemCount: 42,
  },
});

// Or use the global instance (available after initialization)
window.errorLogger.logError({
  error: err,
  componentName: 'MyComponent',
});
```

### 2. Error Logger Initialization (`components/ErrorLoggerInit.tsx`)

This component initializes the error logger and makes it globally available on `window.errorLogger`.

**Integrated in:** `app/layout.tsx` - Runs once on app startup.

### 3. Error Log Tab (Debug Page)

Location: `/debug` → **Error Log** tab (first tab)

**Features:**
- View last 100 errors
- See error messages, stack traces, and context
- Filter by mobile/desktop
- Identify which user experienced the error
- View page URL where error occurred
- Clear all logs button
- Auto-refresh capability

**Access:** SuperAdmin only (`admin@mpdee.co.uk`)

## Database Setup

### Create the `error_logs` Table

The migration SQL is located at: `supabase/migrations/20241201_error_logs_table.sql`

**To create the table:**

1. Go to your Supabase project dashboard
2. Open the **SQL Editor**
3. Paste the contents of the migration file
4. Click **Run**

**Or use the automated script (if SSL allows):**

```bash
npx tsx scripts/run-error-logs-migration.ts
```

### Table Schema

```sql
error_logs (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  error_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  user_email TEXT,
  page_url TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  component_name TEXT,
  additional_data JSONB,
  created_at TIMESTAMPTZ NOT NULL
)
```

**Indexes:**
- `idx_error_logs_timestamp` - Fast chronological queries
- `idx_error_logs_user_id` - Filter by user
- `idx_error_logs_error_type` - Filter by error type

**RLS Policies:**
- SuperAdmin can view all logs
- All authenticated users can insert logs
- SuperAdmin can delete logs

## Mobile Inspection Fix

### Issue
Mobile users were unable to edit and save existing draft inspections.

### Fix Implemented

Added comprehensive logging to `app/(dashboard)/inspections/[id]/page.tsx`:

- **[Mobile Debug] logs** throughout the save process
- Log inspection ID, item counts, and user agent
- Detailed error logging with context
- Integration with global error logger

**Benefits:**
- Can now see exactly where the save process fails
- Tracks mobile-specific issues
- Provides user context for debugging
- All errors automatically appear in Error Log tab

## Testing Checklist

### On Desktop
1. Navigate to `/debug`
2. Click "Error Log" tab
3. Verify empty state shows "No errors logged"
4. Trigger an error (e.g., access invalid route)
5. Refresh Error Log tab
6. Verify error appears with correct details

### On Mobile
1. Open a draft inspection on mobile
2. Edit some inspection items
3. Click "Save Changes"
4. If error occurs, it will be logged
5. Check Error Log on desktop `/debug`
6. Look for mobile-specific context

### Manual Error Logging Test

Open browser console and run:

```javascript
window.errorLogger.logError({
  error: new Error('Test error from console'),
  componentName: 'Manual Test',
  additionalData: { testField: 'test value' }
});
```

Then refresh the Error Log tab to see your test error.

## Monitoring Best Practices

1. **Check Error Log daily** during active development
2. **Look for patterns** - same error from multiple users
3. **Mobile vs Desktop** - filter by device type
4. **Clear old logs** monthly to keep database clean
5. **Stack traces** - expand to see exact line numbers

## Troubleshooting

### Error logs not appearing
- Check if `error_logs` table exists in Supabase
- Verify RLS policies are applied
- Check browser console for error logger initialization message: "✅ Error logger initialized"
- Ensure user is authenticated

### Can't access Error Log tab
- Only SuperAdmin (`admin@mpdee.co.uk`) can access
- Must be in "Actual Role" mode (not viewing as another role)

### Table doesn't exist error
- Run the migration SQL in Supabase Dashboard
- See "Database Setup" section above

## Future Enhancements

Potential improvements:
- Email alerts for critical errors
- Error frequency analytics
- Group similar errors together
- Export errors to CSV
- Search and filter capabilities
- Error severity levels

