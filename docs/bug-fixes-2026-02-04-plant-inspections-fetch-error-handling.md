# Bug Fix: Missing Error Handling in Plant Inspections Sync

**Date:** 2026-02-04  
**Component:** Plant Inspections - New Page  
**Priority:** Medium  
**Status:** ✅ Fixed

---

## Overview

Fixed missing error handling in the `sync-defect-tasks` API call that prevented users from being notified when defect task synchronization failed.

---

## Bug Description

### Issue
The fetch call to `/api/plant-inspections/sync-defect-tasks` did not check the response status or handle API failures. If the API returned a non-ok status (e.g., 400 Bad Request, 500 Internal Server Error), the code continued silently without error, giving the user the false impression that defect tasks were synced successfully when they actually weren't.

### Location
- **File:** `app/(dashboard)/plant-inspections/new/page.tsx:748-771`
- **Function:** `handleSubmit` - defect task synchronization

### Comparison with Similar Code
The `inform-workshop` fetch call in the same file (lines 775-798) properly implements error handling:
- Checks `if (informResponse.ok)`
- Parses error response
- Throws descriptive error
- Shows toast notification to user
- Prevents navigation on failure

The `sync-defect-tasks` call lacked all of these safeguards.

---

## Problem Code

```typescript
try {
  const syncResponse = await fetch('/api/plant-inspections/sync-defect-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inspectionId: inspection.id,
      plantId: selectedPlantId,
      createdBy: user!.id,
      defects
    })
  });

  if (syncResponse.ok) {
    const syncResult = await syncResponse.json();
    console.log(`✅ Sync complete: ${syncResult.message}`);
  }
  // ❌ No handling for !syncResponse.ok
} catch (error) {
  console.error('Error syncing defect tasks:', error);
  // ❌ No user notification
}
```

### What Could Go Wrong

1. **API returns 400 (Bad Request):**
   - Missing required fields
   - Invalid data format
   - User sees nothing, thinks sync succeeded

2. **API returns 401/403 (Unauthorized/Forbidden):**
   - Session expired
   - Insufficient permissions
   - User sees nothing, thinks sync succeeded

3. **API returns 500 (Internal Server Error):**
   - Database error
   - Service unavailable
   - User sees nothing, thinks sync succeeded

4. **Network error:**
   - Only case that triggers catch block
   - Logs to console only, no user feedback

---

## Solution

Added comprehensive error handling matching the `inform-workshop` pattern:

```typescript
try {
  const syncResponse = await fetch('/api/plant-inspections/sync-defect-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inspectionId: inspection.id,
      plantId: selectedPlantId,
      createdBy: user!.id,
      defects
    })
  });

  if (syncResponse.ok) {
    const syncResult = await syncResponse.json();
    console.log(`✅ Sync complete: ${syncResult.message}`);
  } else {
    // ✅ Handle non-ok responses
    const errorData = await syncResponse.json();
    throw new Error(errorData.error || 'Failed to sync defect tasks');
  }
} catch (error) {
  console.error('Error syncing defect tasks:', error);
  // ✅ Notify user of failure
  const errorMsg = error instanceof Error ? error.message : 'Failed to sync defect tasks';
  toast.error(`Warning: Inspection saved, but ${errorMsg}`);
}
```

---

## Key Improvements

1. **Response Status Check:**
   - Added `else` branch to handle `!syncResponse.ok`
   - Parses error response body for detailed message

2. **Error Throwing:**
   - Throws descriptive error when API fails
   - Includes API error message if available
   - Falls back to generic message if parsing fails

3. **User Notification:**
   - Shows toast.error() with clear message
   - Explains that inspection was saved but defect sync failed
   - User understands the partial failure state

4. **Type-Safe Error Handling:**
   - Checks `error instanceof Error` before accessing `.message`
   - Provides fallback message for non-Error objects

---

## User Experience

### Before Fix
```
User submits inspection with defects marked for attention
→ API fails to sync defect tasks (500 error)
→ User redirected to inspections list
→ User thinks everything succeeded ❌
→ Workshop never receives defect tasks ❌
```

### After Fix
```
User submits inspection with defects marked for attention
→ API fails to sync defect tasks (500 error)
→ Toast error: "Warning: Inspection saved, but Failed to sync defect tasks"
→ User redirected to inspections list
→ User knows inspection saved but defect sync failed ✅
→ User can manually create workshop tasks or retry ✅
```

---

## Why Not Block Navigation?

The fix shows a warning but still allows navigation. This design choice is intentional:

**Rationale:**
- Inspection is successfully saved to database
- Defect task sync is a secondary operation
- Blocking would frustrate users if sync repeatedly fails
- Warning informs user of partial failure
- Users can manually create tasks from inspection list if needed

**Contrast with `inform-workshop`:**
- That feature completely blocks on failure
- Returns early, preventing navigation
- More critical operation requiring user retry

---

## Testing Scenarios

### Test 1: API Returns 400
```typescript
// Simulate: API returns { error: "Missing required field: plantId" }
Response: 400 Bad Request

Expected:
✅ Toast: "Warning: Inspection saved, but Missing required field: plantId"
✅ Inspection appears in list
✅ User can manually create tasks
```

### Test 2: API Returns 500
```typescript
// Simulate: Database connection failure
Response: 500 Internal Server Error

Expected:
✅ Toast: "Warning: Inspection saved, but Internal server error"
✅ Inspection appears in list
✅ Error logged to console
```

### Test 3: Network Failure
```typescript
// Simulate: fetch() throws TypeError
Error: Failed to fetch

Expected:
✅ Toast: "Warning: Inspection saved, but Failed to sync defect tasks"
✅ Inspection appears in list
✅ Error logged to console
```

### Test 4: API Success
```typescript
// Simulate: API returns { created: 3, skipped: 1, message: "..." }
Response: 200 OK

Expected:
✅ No toast (success is silent)
✅ Console log: "✅ Sync complete: Created 3 tasks, skipped 1 existing task"
✅ Inspection appears in list
```

---

## Files Changed

1. `app/(dashboard)/plant-inspections/new/page.tsx`
   - Added response status check (line 763-766)
   - Added user notification (line 770)
   - Added type-safe error handling (line 769)

---

## Related Patterns

This fix aligns error handling with:
- `inform-workshop` in same file (lines 785-791)
- Vehicle inspections sync (similar pattern)
- Standard fetch error handling throughout app

---

## Impact

**Risk Level:** Low  
**User Impact:** Positive (users now see failures instead of silent errors)  
**Breaking Changes:** None  

Users will now be properly informed when defect task synchronization fails, preventing confusion and lost work.
