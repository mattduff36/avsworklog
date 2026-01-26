# Bug Fixes - Debug Page & Middleware - 2026-01-22

**Date:** 2026-01-22  
**Status:** ✅ FIXED  
**Affected Components:** Supabase Middleware, Debug Page Audit Logs

## Summary

Fixed seven bugs affecting authentication middleware, error messaging, and the debug page audit log functionality:
1. **Session termination bug (API)** - Middleware not preserving cookies for API 401 responses
2. **Session termination bug (Redirects)** - Middleware not preserving cookies for redirect responses
3. **Double-fetch bug** - useEffect triggering unnecessary refetches when loading more audit logs
4. **Pagination reset bug** - Refresh button resetting audit log pagination state
5. **Default parameter closure bug** - Function default parameter capturing stale state value
6. **Misleading error message** - RAMS upload error incorrectly suggesting authentication issue
7. **Race condition** - Audit log refresh button allowing concurrent fetch operations

---

## Bug 1: Session Termination on API 401 Responses

### Problem

**File:** `lib/supabase/middleware.ts`  
**Lines:** 67-71

When an unauthenticated request was made to an API route, the middleware returned a new `NextResponse.json()` with a 401 status **without copying the session cookies** from `supabaseResponse`.

```typescript
// ❌ BEFORE - Missing cookie preservation
if (isApiRoute) {
  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401 }
  )
}
```

### Root Cause

The critical warning at lines 88-99 of the middleware explicitly states:

> **IMPORTANT:** You *must* return the supabaseResponse object as it is. If you're creating a new response object with NextResponse.next() make sure to:
> 1. Pass the request in it
> 2. **Copy over the cookies**
> 3. Change the response to fit your needs, but avoid changing the cookies!
> 4. If this is not done, you may be **causing the browser and server to go out of sync and terminate the user's session prematurely!**

The JSON 401 response violated rule #2 by not copying cookies, which would cause:
- Browser and server session state to desync
- Premature session termination
- Users being logged out unexpectedly during API calls

### Fix Applied

```typescript
// ✅ AFTER - Cookies preserved correctly
if (isApiRoute) {
  const apiResponse = NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401 }
  )
  // CRITICAL: Copy cookies from supabaseResponse to avoid session termination
  apiResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  return apiResponse
}
```

### Impact

- **Prevents:** Premature session logout during API requests
- **Ensures:** Session cookies are properly maintained across all responses
- **Maintains:** Browser-server session synchronization

---

## Bug 2: Session Termination on Redirect Responses

### Problem

**File:** `lib/supabase/middleware.ts`  
**Lines:** 77-81, 85-88

Both redirect responses in the middleware were created **without copying session cookies** from `supabaseResponse`, violating the same critical warning from Bug 1.

```typescript
// ❌ BEFORE - Missing cookie preservation on redirects
// Redirect 1: Unauthenticated user to login
const url = request.nextUrl.clone()
url.pathname = '/login'
url.searchParams.set('redirect', request.nextUrl.pathname)
return NextResponse.redirect(url)  // ❌ No cookies copied

// Redirect 2: Authenticated user away from login
if (request.nextUrl.pathname === '/login' && user) {
  const url = request.nextUrl.clone()
  url.pathname = '/dashboard'
  return NextResponse.redirect(url)  // ❌ No cookies copied
}
```

### Root Cause

The same critical warning at lines 91-102 applies to **ALL new response objects**, including redirects. Both redirect paths created new `NextResponse.redirect()` objects without copying cookies from `supabaseResponse`.

**Impact:**
- Session cookies not updated in browser
- Auth state desynchronization between client and server
- Users randomly logged out after navigation
- Especially problematic on first login or session refresh

### Fix Applied

```typescript
// ✅ AFTER - Cookies preserved on all redirects
// Redirect 1: Unauthenticated user to login
const url = request.nextUrl.clone()
url.pathname = '/login'
url.searchParams.set('redirect', request.nextUrl.pathname)
const redirectResponse = NextResponse.redirect(url)
// CRITICAL: Copy cookies from supabaseResponse to avoid session termination
redirectResponse.cookies.setAll(supabaseResponse.cookies.getAll())
return redirectResponse

// Redirect 2: Authenticated user away from login
if (request.nextUrl.pathname === '/login' && user) {
  const url = request.nextUrl.clone()
  url.pathname = '/dashboard'
  const dashboardRedirect = NextResponse.redirect(url)
  // CRITICAL: Copy cookies from supabaseResponse to avoid session termination
  dashboardRedirect.cookies.setAll(supabaseResponse.cookies.getAll())
  return dashboardRedirect
}
```

### Impact

- **Critical security fix** - Prevents session loss on navigation
- **Improves reliability** - No more random logouts after redirects
- **Complete coverage** - All middleware response paths now preserve cookies

---

## Bug 3: Double-Fetch on Audit Log Pagination

### Problem

**File:** `app/(dashboard)/debug/page.tsx`  
**Lines:** 171-178

The `useEffect` dependency array included `auditLogsLimit`, causing unnecessary refetches when the limit changed.

```typescript
// ❌ BEFORE - auditLogsLimit in dependency array
useEffect(() => {
  if (userEmail === 'admin@mpdee.co.uk') {
    fetchDebugInfo();
    fetchAuditLogs(auditLogsLimit);  // Called with current limit
    fetchErrorLogs();
  }
}, [userEmail, auditLogsLimit]);  // ❌ Changes trigger re-fetch
```

### Root Cause

When `loadMoreAuditLogs` was called:

1. User clicks "Show 100 More Entries"
2. `setAuditLogsLimit(newLimit)` updates state (e.g., 100 → 200)
3. `await fetchAuditLogs(newLimit)` explicitly fetches with new limit
4. **useEffect sees `auditLogsLimit` changed** → triggers AGAIN
5. Second fetch with potentially stale or new limit value

This caused:
- **Double API calls** when loading more entries
- **UI flashing** as data loaded twice
- **Wasted bandwidth** and database queries
- **Race condition** potential if second fetch completed first

### Fix Applied

Removed `auditLogsLimit` from the dependency array:

```typescript
// ✅ AFTER - Only refetch on user change
useEffect(() => {
  if (userEmail === 'admin@mpdee.co.uk') {
    fetchDebugInfo();
    fetchAuditLogs();  // Uses default limit on mount
    fetchErrorLogs();
  }
}, [userEmail]);  // ✅ Only when user changes
```

**Why this is safe:**
- Initial mount: Fetches with default limit (100)
- Load more: Explicitly calls `fetchAuditLogs(newLimit)` in `loadMoreAuditLogs`
- No need to re-trigger on limit changes since pagination is handled explicitly

### Impact

- **Eliminates:** Redundant API calls on pagination
- **Improves:** User experience (no flashing)
- **Reduces:** Server load and bandwidth usage

---

## Bug 4: Pagination State Lost on Refresh

### Problem

**File:** `app/(dashboard)/debug/page.tsx`  
**Line:** 1338

The Refresh button called `fetchAuditLogs()` without arguments, resetting to the default limit instead of maintaining the current pagination state.

```typescript
// ❌ BEFORE - No argument = default limit
<Button
  onClick={fetchAuditLogs}  // ❌ Defaults to 100
  variant="outline"
  size="sm"
>
  <RefreshCw className="h-4 w-4 mr-2" />
  Refresh
</Button>
```

### Root Cause

**Scenario:**
1. User loads page → Shows 100 audit logs
2. User clicks "Show 100 More Entries" → Shows 200 logs
3. User clicks "Show 100 More Entries" again → Shows 300 logs
4. User clicks **Refresh** button
5. `fetchAuditLogs()` called with no argument → Uses default `limit = auditLogsLimit` but...
6. `setAuditLogs()` replaces the entire list with only the fetched entries

**Expected:** Show 300 refreshed entries  
**Actual:** Reset to showing 100 entries (lost pagination state)

### Fix Applied

```typescript
// ✅ AFTER - Preserves current limit
<Button
  onClick={() => fetchAuditLogs(auditLogsLimit)}  // ✅ Maintains pagination
  variant="outline"
  size="sm"
>
  <RefreshCw className="h-4 w-4 mr-2" />
  Refresh
</Button>
```

### Impact

- **Maintains:** User's current pagination state on refresh
- **Improves:** UX by respecting user's view preferences
- **Prevents:** Frustration from losing loaded data

---

## Bug 6: Misleading Error Message in RAMS Upload

### Problem

**File:** `components/rams/UploadRAMSModal.tsx`  
**Lines:** 69-73

The error message shown when the server returns a non-JSON response incorrectly assumed the problem was authentication-related.

```typescript
// ❌ BEFORE - Assumes authentication issue
if (!contentType || !contentType.includes('application/json')) {
  throw new Error('Server returned invalid response. Please try logging in again.');
}
```

### Root Cause

Non-JSON responses can occur for many reasons beyond authentication:
- **500 Internal Server Error** - Server-side exceptions
- **502 Bad Gateway** - Reverse proxy/load balancer issues
- **503 Service Unavailable** - Server overload or maintenance
- **Network errors** - Connection timeouts, DNS failures
- **CDN errors** - Edge node issues

The error message sent users on a wild goose chase to log in again when the actual problem required a different resolution (waiting, retry, contacting support).

**User Experience Impact:**
1. User uploads RAMS document
2. Server throws 500 error (HTML error page)
3. Client detects non-JSON response
4. Error: "Please try logging in again" ❌
5. User logs out/in unnecessarily
6. Problem persists (because it's a server error)

### Fix Applied

```typescript
// ✅ AFTER - Accurate, actionable error message
if (!contentType || !contentType.includes('application/json')) {
  throw new Error(`Server error (${response.status}). Please try again or contact support if the issue persists.`);
}
```

**Improvements:**
- ✅ Shows actual HTTP status code for debugging
- ✅ Suggests immediate action (retry)
- ✅ Provides escalation path (contact support)
- ✅ No incorrect assumption about cause

### Impact

- **Better UX** - Users get accurate information about the problem
- **Faster resolution** - No wasted time on incorrect troubleshooting
- **Better support** - Status code helps support team diagnose issues
- **Correct guidance** - Users know to retry or escalate, not re-authenticate

---

## Bug 7: Race Condition in Audit Log Refresh

### Problem

**File:** `app/(dashboard)/debug/page.tsx`  
**Lines:** 1340-1347

The Refresh button could be clicked while "Show More" was loading, creating a race condition.

```typescript
// ❌ BEFORE - No disabled state during loading
<Button
  onClick={() => fetchAuditLogs(auditLogsLimit)}
  variant="outline"
  size="sm"
>
  <RefreshCw className="h-4 w-4 mr-2" />
  Refresh
</Button>
```

**Race Condition Scenario:**
1. User clicks "Show 100 More Entries" → `loadingMoreAudits = true`, `auditLogsLimit = 200`
2. `fetchAuditLogs(200)` starts fetching...
3. User clicks "Refresh" → `fetchAuditLogs(200)` starts again (concurrent!)
4. First fetch completes → Sets `auditLogs` to 200 entries
5. Second fetch completes → Overwrites `auditLogs` with 200 entries (duplicate work)

**OR worse:**
1. User clicks "Show More" → Fetching 200 entries...
2. User clicks "Refresh" → Fetching 200 entries again...
3. Second fetch completes first → UI shows 200 entries
4. First fetch completes → UI shows 200 entries (same data, wasted work)

### Root Cause

The "Show More" button was correctly disabled during `loadingMoreAudits`:

```typescript
<Button
  onClick={loadMoreAuditLogs}
  disabled={loadingMoreAudits}  // ✅ Correctly disabled
>
```

But the Refresh button was **not** disabled, allowing concurrent fetch operations.

### Fix Applied

```typescript
// ✅ AFTER - Disabled during loading, with visual feedback
<Button
  onClick={() => fetchAuditLogs(auditLogsLimit)}
  variant="outline"
  size="sm"
  disabled={loadingMoreAudits}  // ✅ Prevents concurrent fetches
>
  <RefreshCw className={`h-4 w-4 mr-2 ${loadingMoreAudits ? 'animate-spin' : ''}`} />
  Refresh
</Button>
```

**Improvements:**
- ✅ Button disabled during any audit log loading operation
- ✅ Spinner animation provides visual feedback
- ✅ Prevents race conditions between refresh and show more
- ✅ Ensures data consistency

### Impact

- **Data consistency** - Only one fetch operation at a time
- **Better UX** - Visual feedback (disabled + spinning icon)
- **Performance** - No duplicate API calls
- **State reliability** - No race condition overwrites

---

## Testing Performed

### Bug 1 - Middleware Cookie Preservation (API 401)
- ✅ Verified cookies are copied to API 401 responses
- ✅ No linter errors
- ✅ Follows Supabase SSR best practices

### Bug 2 - Middleware Cookie Preservation (Redirects)
- ✅ Verified cookies are copied to both redirect responses
- ✅ Login redirect preserves session cookies
- ✅ Dashboard redirect preserves session cookies
- ✅ No session loss on navigation

### Bug 3 - Double-Fetch Elimination
- ✅ Verified useEffect only triggers on user change
- ✅ Load more functionality still works correctly
- ✅ No duplicate API calls observed

### Bug 4 - Pagination Persistence
- ✅ Verified refresh maintains current limit
- ✅ Load more + refresh preserves entries count
- ✅ User experience improved

---

## Files Modified

1. **`lib/supabase/middleware.ts`**
   - Added cookie preservation for API 401 responses (Lines: 67-74)
   - Added cookie preservation for login redirect (Lines: 77-84)
   - Added cookie preservation for dashboard redirect (Lines: 87-95)

2. **`app/(dashboard)/debug/page.tsx`**
   - Removed `auditLogsLimit` from useEffect dependencies (Line: 171)
   - Modified fetchAuditLogs signature to `(limit?: number)` (Line: 189)
   - Updated Refresh button to pass `auditLogsLimit` explicitly (Line: 1341)
   - Added `disabled={loadingMoreAudits}` to Refresh button (Line: 1344)
   - Added conditional spinner animation to Refresh button icon (Line: 1346)

3. **`components/rams/UploadRAMSModal.tsx`**
   - Updated non-JSON error message to show HTTP status code (Line: 72)
   - Changed message from "Please try logging in again" to actionable guidance

---

## Related Issues

These bugs were identified through code review and user testing. The middleware bugs are particularly critical as they could affect all authenticated requests and navigation.

## Security Impact

**Bugs 1 & 2** had critical security implications:
- Session desync could cause unexpected authentication state
- Users might remain logged in on client but logged out on server
- Could lead to confusing authentication errors

The fixes ensure proper session management across **all response types** (JSON, redirects, and regular responses).

---

## Lessons Learned

1. **Always follow framework warnings** - The Supabase middleware had explicit warnings about cookie handling that must be respected in ALL code paths
2. **Careful with useEffect dependencies** - State that's explicitly managed in handlers doesn't need to be in dependency arrays
3. **Preserve user state** - Actions like "refresh" should maintain user context (pagination, filters, etc.)

---

## Bug 5: Default Parameter Closure Issue (Follow-up Fix)

### Problem

**File:** `app/(dashboard)/debug/page.tsx`  
**Line:** 190

The `fetchAuditLogs` function used a default parameter that captured state in closure:

```typescript
// ❌ BEFORE - Default parameter captures state at definition time
const fetchAuditLogs = async (limit: number = auditLogsLimit) => {
```

While this technically works in the current implementation (function is recreated on each render), it's an error-prone pattern that could cause issues if:
- The function reference is memoized in the future
- The execution context changes
- The code is refactored

### Root Cause

Default parameters in JavaScript capture values from the surrounding scope (closure) at the time the function is created. Since React components re-render frequently, the function is recreated each time, but this pattern is confusing and fragile.

### Fix Applied

Changed to explicitly read from state when no argument is provided:

```typescript
// ✅ AFTER - Explicitly reads current state value
const fetchAuditLogs = async (limit?: number) => {
  // Use current state value if no limit provided
  const effectiveLimit = limit ?? auditLogsLimit;
  
  try {
    // ... use effectiveLimit
  }
}
```

### Benefits

- **Clarity:** Explicit about when state is read
- **Maintainability:** No hidden closure dependencies
- **Future-proof:** Works correctly even if function is memoized
- **Consistency:** Same pattern as other React best practices

---

## Verification Steps

To verify these fixes work:

1. **Session persistence (API):**
   - Make an authenticated API call
   - Trigger a 401 response
   - Verify session remains valid

2. **Session persistence (Redirects):**
   - Access a protected page without authentication
   - Verify redirect to login and session cookies preserved
   - Log in and access /login page
   - Verify redirect to dashboard and session cookies preserved

3. **Audit log pagination:**
   - Load debug page
   - Click "Show 100 More Entries" 2-3 times
   - Click Refresh
   - Verify all loaded entries remain visible

4. **No double-fetching:**
   - Open browser DevTools Network tab
   - Click "Show 100 More Entries"
   - Verify only ONE request to audit_log is made

5. **Default parameter behavior:**
   - Load debug page (uses current state: 100)
   - Click "Show 100 More Entries" (explicitly passes 200)
   - Verify correct limits are used in all scenarios

6. **RAMS upload error messaging:**
   - Simulate a server error (trigger 500 response)
   - Verify error message includes HTTP status code
   - Verify message suggests retry/contact support, not re-authentication

7. **Audit log race condition prevention:**
   - Click "Show 100 More Entries" button
   - Verify Refresh button becomes disabled
   - Verify Refresh icon shows spinner animation
   - Confirm button re-enables after fetch completes
   - Verify only one fetch operation is made
