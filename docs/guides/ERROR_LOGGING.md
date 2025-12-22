# Error Logging Guide

## Overview

The application has a comprehensive error logging system that captures ALL errors (both client-side and server-side) and stores them in the `error_logs` table. These logs are viewable in the Debug Console at `/debug` (SuperAdmin only).

## System Architecture

### Client-Side Error Logging

**Location:** `lib/utils/error-logger.ts`

The client-side error logger automatically captures:
- Unhandled JavaScript errors (`window.error`)
- Unhandled promise rejections (`window.unhandledrejection`)
- Console errors (`console.error` calls)

**Initialization:** Automatically initialized in `/app/layout.tsx` via the `<ErrorLoggerInit />` component.

**Usage:** Nothing required! All client-side errors are automatically logged.

```tsx
// Example: These are ALL automatically logged
throw new Error('Something went wrong'); // ✅ Logged
Promise.reject('Async error'); // ✅ Logged
console.error('Error message', error); // ✅ Logged
```

### Server-Side Error Logging

**Location:** `lib/utils/server-error-logger.ts`

Server-side errors (in API routes) need explicit logging since they don't run in the browser.

**Usage in API Routes:**

```typescript
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(request: NextRequest) {
  try {
    // Your API logic here
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in POST /api/example:', error);
    
    // Log to database
    await logServerError({
      error: error as Error,
      request,
      componentName: 'POST /api/example',
      additionalData: {
        endpoint: '/api/example',
        method: 'POST',
      },
    });
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Alternative: Error Handler Wrapper

For new API routes, you can use the wrapper function:

```typescript
import { withErrorHandler } from '@/lib/utils/api-error-handler';

export const GET = withErrorHandler(
  async (request) => {
    // Your API logic here
    return NextResponse.json({ success: true });
  },
  'GET /api/example'
);
```

## Viewing Errors

### Debug Console

1. Navigate to `/debug` (SuperAdmin only)
2. Click the "Error Log" tab
3. View all errors with:
   - Error message and stack trace
   - User information
   - Timestamp and device info
   - New vs. Viewed errors

### Features

- **Auto-categorization:** Errors are split into "New" (unread) and "Viewed" sections
- **Click to expand:** Click any error to see full details
- **Copy to clipboard:** Copy error details for sharing or bug reports
- **Filter:** Clear all errors when needed
- **Daily summary:** Automatic email sent on first error of each day

## Error Log Schema

The `error_logs` table contains:

```sql
- id: UUID
- timestamp: TIMESTAMPTZ
- error_message: TEXT
- error_stack: TEXT (nullable)
- error_type: VARCHAR (e.g., 'Error', 'TypeError', 'ReferenceError')
- user_id: UUID (nullable, references auth.users)
- user_email: VARCHAR (nullable)
- user_name: VARCHAR (nullable)
- page_url: TEXT
- user_agent: TEXT
- component_name: VARCHAR (nullable)
- additional_data: JSONB (nullable)
```

## API Routes Status

### Routes with Error Logging ✅

- `/api/messages` (POST)
- `/api/rams` (GET)

### Routes Needing Updates 🔨

Run the checker script to see which routes need updating:

```bash
npm run tsx scripts/check-api-error-logging.ts
```

## Best Practices

### DO ✅

- Always use `console.error()` for errors (client-side will auto-log)
- Add `logServerError()` to all API route catch blocks
- Include relevant context in `additionalData`
- Use descriptive `componentName` values

### DON'T ❌

- Don't swallow errors silently without logging
- Don't log sensitive data (passwords, tokens, etc.)
- Don't create infinite logging loops
- Don't log in development-only code paths

## Troubleshooting

### Errors not appearing in Debug Console

1. **Check the page URL:** Development/localhost errors are filtered out
2. **Check RLS policies:** Ensure `error_logs` table has proper policies
3. **Check browser console:** See if logging itself is failing
4. **Verify table exists:** Run migration `20241201_error_logs_table.sql`

### Too many errors

1. **Clear old errors:** Use "Clear All" button in Debug Console
2. **Filter noise:** Update filters in `lib/utils/error-logger.ts`
3. **Fix root cause:** Use error patterns to identify and fix issues

## Testing

To test error logging:

```typescript
// Client-side
throw new Error('Test error');

// Server-side (in API route)
await logServerError({
  error: new Error('Test API error'),
  request,
  componentName: 'Test',
});
```

## Future Enhancements

- [ ] AI-powered error summaries
- [ ] Error grouping/deduplication
- [ ] Trend analysis and charts
- [ ] Automatic issue creation in GitHub
- [ ] Slack/email notifications for critical errors
