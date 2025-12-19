# Testing Error Logging System

This guide explains how to test and verify that the error logging system is working correctly.

## Quick Test (Recommended)

### Option 1: Interactive Test Page

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Navigate to the test page:
   ```
   http://localhost:3000/test-error-logging
   ```

3. Click **"Run All Tests"** button

4. Wait for tests to complete (~5 seconds)

5. Navigate to the debug console:
   ```
   http://localhost:3000/debug
   ```

6. Click the **"Error Log"** tab

7. Verify you see all test errors with:
   - ✅ Clear error messages with context
   - ✅ Component names (e.g., "GET /api/test-error-logging")
   - ✅ Stack traces (where applicable)
   - ✅ Additional data showing request details
   - ✅ User information
   - ✅ Device and browser info

### Option 2: Automated Test Script

```bash
# Make sure the dev server is running first
npm run dev

# In another terminal, run the test script
npx tsx scripts/test-error-logging.ts
```

This will:
- Test server-side error logging
- Verify errors are saved to database
- Check that errors have all required fields
- Validate error context and descriptions

## Manual Testing

### Test Client-Side Errors

1. Open browser console (F12)
2. Navigate to any page
3. In the console, type:
   ```javascript
   throw new Error('Test error');
   ```
4. Check `/debug` - you should see the error logged

### Test Server-Side Errors

1. Make a request to the test endpoint:
   ```bash
   curl http://localhost:3000/api/test-error-logging?type=throw
   ```
2. Check `/debug` - you should see the API error logged

### Test Real API Errors

1. Try to access a non-existent resource:
   ```bash
   curl http://localhost:3000/api/rams/fake-id/email -X POST \
     -H "Content-Type: application/json" \
     -d '{"test": "data"}'
   ```
2. Check `/debug` - you should see the 404 error with full context

## What to Verify

Each logged error should include:

### Required Fields ✅
- **Error Message**: Clear, descriptive message
- **Error Type**: TypeError, ReferenceError, Error, etc.
- **Timestamp**: When the error occurred
- **Page URL**: Where the error happened
- **User Agent**: Browser/device information

### Enhanced Context ✅
- **Component Name**: Which part of code threw the error
- **Stack Trace**: Full call stack (when available)
- **Additional Data**: Request details, query params, etc.

### Server Errors Should Show:
- HTTP method (GET, POST, etc.)
- API endpoint path
- Query parameters (if any)
- Request context (referer, origin)

### Client Errors Should Show:
- File name and line number (when available)
- Type of error (uncaught, promise rejection, console)
- Page URL where error occurred

## Example Error Logs

### Good Error Log (Server):
```
Error in GET /api/rams - Test server-side error: Simulated API failure

Additional Data:
{
  "method": "GET",
  "pathname": "/api/rams",
  "searchParams": { "type": "throw" },
  "referer": "http://localhost:3000/test-error-logging",
  "errorContext": {
    "originalMessage": "Simulated API failure",
    "errorName": "Error",
    "timestamp": "2025-12-19T23:00:00.000Z"
  }
}
```

### Good Error Log (Client):
```
Uncaught Error: Test error at main.js:42:15

Additional Data:
{
  "filename": "http://localhost:3000/_next/static/chunks/main.js",
  "lineno": 42,
  "colno": 15,
  "location": "main.js:42:15",
  "description": "Unhandled JavaScript error thrown at runtime",
  "pageUrl": "http://localhost:3000/test-error-logging"
}
```

## Troubleshooting

### Errors not appearing in Debug Console

1. **Check RLS policies**: Ensure you're logged in as SuperAdmin
2. **Check table exists**: Run migration `20241201_error_logs_table.sql`
3. **Check browser console**: Look for any logging errors
4. **Clear filters**: Make sure localhost errors aren't being filtered

### Tests failing

1. **Check database connection**: Verify `.env.local` has correct Supabase credentials
2. **Check permissions**: Ensure `error_logs` table has proper RLS policies
3. **Check dev server**: Make sure `npm run dev` is running

### No context in errors

1. **Check logger version**: Make sure you're using the enhanced logger
2. **Check imports**: Verify using `logServerError` for API routes
3. **Update code**: Re-run `scripts/add-api-error-logging.ts` if needed

## Success Criteria

All tests pass when:
- ✅ Client-side errors are logged automatically
- ✅ Server-side errors are logged automatically
- ✅ Each error has a clear, descriptive message
- ✅ Error messages include component/endpoint context
- ✅ Additional data shows useful debugging information
- ✅ Stack traces are preserved (when available)
- ✅ User information is captured (when authenticated)
- ✅ Errors appear in Debug Console within 1-2 seconds

## Next Steps

After confirming tests pass:
1. ✅ Delete the test page and API route (optional, but recommended for production)
2. ✅ Monitor `/debug` regularly for real production errors
3. ✅ Set up email notifications for critical errors (future enhancement)
