# UX Bug Fixes - January 22, 2026

**Date:** 2026-01-22  
**Status:** ✅ COMPLETED  
**Component:** RAMS Upload Modal & Debug Page Audit Log

## Summary

Fixed two UX/interaction bugs:
1. **Misleading error message** - RAMS upload showing authentication-focused error for server errors
2. **Race condition** - Concurrent audit log fetch operations possible via refresh button

---

## Bug 1: Misleading Error Message in RAMS Upload

### Problem

**File:** `components/rams/UploadRAMSModal.tsx`  
**Line:** 72

When the RAMS upload API returned a non-JSON response (typically a server error), the error message incorrectly guided users to log in again:

```typescript
// ❌ BEFORE - Assumes authentication issue
if (!contentType || !contentType.includes('application/json')) {
  throw new Error('Server returned invalid response. Please try logging in again.');
}
```

### Why This Was Wrong

Non-JSON responses occur for many reasons:
- **500 Internal Server Error** - Backend exception
- **502 Bad Gateway** - Proxy/load balancer issues
- **503 Service Unavailable** - Maintenance or overload
- **Network errors** - Timeouts, DNS failures
- **CDN errors** - Edge node problems

Only **401 Unauthorized** is authentication-related, and that would typically still return JSON from our API middleware (as of Bug 1 fix in this session).

### User Impact

**Bad User Journey:**
1. User uploads RAMS document
2. Server throws 500 error → HTML error page returned
3. Client detects non-JSON response
4. Error: "Please try logging in again" 😕
5. User wastes time logging out and back in
6. Problem persists (because it's a server error, not auth)
7. User confused and frustrated

### Fix Applied

```typescript
// ✅ AFTER - Accurate, helpful error message
if (!contentType || !contentType.includes('application/json')) {
  throw new Error(`Server error (${response.status}). Please try again or contact support if the issue persists.`);
}
```

### Benefits

✅ **Shows HTTP status code** - Helps with debugging and support tickets  
✅ **Suggests immediate action** - "try again" (often works for transient errors)  
✅ **Provides escalation path** - "contact support if persists"  
✅ **No incorrect assumptions** - Doesn't blame authentication when it's not the issue  
✅ **Better support experience** - Status code helps support team diagnose the real problem

---

## Bug 2: Audit Log Refresh Race Condition

### Problem

**File:** `app/(dashboard)/debug/page.tsx`  
**Lines:** 1340-1347

The Refresh button on the Audit Log tab could be clicked while "Show More" was loading, creating race conditions:

```typescript
// ❌ BEFORE - No loading state check
<Button
  onClick={() => fetchAuditLogs(auditLogsLimit)}
  variant="outline"
  size="sm"
>
  <RefreshCw className="h-4 w-4 mr-2" />
  Refresh
</Button>
```

### Race Condition Scenarios

**Scenario 1: Duplicate Work**
1. User clicks "Show 100 More" → `loadingMoreAudits = true`, fetching 200 entries
2. User clicks "Refresh" → Fetches 200 entries again (concurrent!)
3. Both requests complete → Duplicate API calls, wasted bandwidth

**Scenario 2: Inconsistent State**
1. User clicks "Show More" → Fetching 200 entries... (slow connection)
2. User clicks "Refresh" → Fetching 200 entries again...
3. Second fetch completes first → UI shows 200 entries
4. First fetch completes → Overwrites UI (same data, but confusing for user tracking)

**Scenario 3: User Confusion**
- User sees "Show More" button disabled + spinner
- But Refresh button still clickable → Inconsistent UI state
- User might think app is broken when they can click one but not the other

### Fix Applied

```typescript
// ✅ AFTER - Consistent disabled state + visual feedback
<Button
  onClick={() => fetchAuditLogs(auditLogsLimit)}
  variant="outline"
  size="sm"
  disabled={loadingMoreAudits}  // ✅ Prevents race conditions
>
  <RefreshCw className={`h-4 w-4 mr-2 ${loadingMoreAudits ? 'animate-spin' : ''}`} />
  Refresh
</Button>
```

### Benefits

✅ **No race conditions** - Only one fetch operation at a time  
✅ **Visual feedback** - Spinning icon shows loading state  
✅ **Consistent UI** - Both buttons disabled during loading  
✅ **Better UX** - Clear indication that work is in progress  
✅ **Data integrity** - No state overwrites from concurrent fetches  
✅ **Performance** - No duplicate API calls

---

## Pattern: Loading States in UI

### Key Principle

**All buttons that trigger the same async operation should share the same loading state.**

**Good Example (After Fix):**
```typescript
const [loadingMoreAudits, setLoadingMoreAudits] = useState(false);

// Button 1: Show More
<Button disabled={loadingMoreAudits}>Show More</Button>

// Button 2: Refresh (also disabled!)
<Button disabled={loadingMoreAudits}>Refresh</Button>
```

**Bad Example (Before Fix):**
```typescript
// Button 1: Disabled ✅
<Button disabled={loadingMoreAudits}>Show More</Button>

// Button 2: NOT disabled ❌ → Race condition!
<Button>Refresh</Button>
```

---

## Testing Performed

### Bug 1 - Error Message
- ✅ Verified new error message format
- ✅ Confirmed HTTP status code is included
- ✅ Message suggests retry and support escalation
- ✅ No mention of authentication when not relevant

### Bug 2 - Race Condition
- ✅ Clicked "Show More" and verified Refresh button disables
- ✅ Confirmed spinner animation shows on Refresh button
- ✅ Verified button re-enables after fetch completes
- ✅ Tested rapid clicking - no duplicate fetches
- ✅ DevTools Network tab shows only one request at a time

---

## Related Fixes

These fixes complement:
- **Bug 1 (Middleware)** - API 401 responses now return JSON, reducing non-JSON errors
- **Bug 3-5 (Audit Log)** - Complete audit log fetch/pagination reliability

---

## Lessons Learned

1. **Error messages matter** - They guide users to correct actions or incorrect troubleshooting
2. **Include context in errors** - HTTP status codes help users and support
3. **Shared loading states** - All buttons for the same operation should disable together
4. **Visual feedback is critical** - Spinners/disabled states prevent user confusion
5. **Test race conditions** - Click buttons rapidly to find concurrency issues

---

## Files Modified

1. **`components/rams/UploadRAMSModal.tsx`**
   - Updated non-JSON error message (Line 72)
   - Changed from "Please try logging in again" to "Server error ({status}). Please try again..."

2. **`app/(dashboard)/debug/page.tsx`**
   - Added `disabled={loadingMoreAudits}` to Refresh button (Line 1344)
   - Added conditional `animate-spin` class to RefreshCw icon (Line 1346)

---

## Verification Steps

1. **Test RAMS error message:**
   - Simulate server error (e.g., stop dev server, try upload)
   - Verify error includes status code
   - Verify message suggests retry/support, not re-auth

2. **Test race condition prevention:**
   - Go to /debug page, Audit Log tab
   - Click "Show 100 More Entries"
   - Immediately try clicking "Refresh" button
   - ✅ Refresh should be disabled
   - ✅ Refresh icon should spin
   - ✅ Both buttons re-enable after load completes
   - Open DevTools Network tab and verify only ONE audit_log request
