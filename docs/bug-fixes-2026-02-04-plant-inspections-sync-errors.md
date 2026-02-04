# Bug Fixes: Plant Inspections Sync Errors

**Date:** 2026-02-04  
**Component:** Plant Inspections Module  
**Priority:** Medium  
**Status:** ✅ Fixed

---

## Overview

Fixed two bugs in the plant inspections module related to defect task synchronization and daily hours update operations.

---

## Bug 1: Missing `message` Field in Sync Response

### Issue
The `sync-defect-tasks` endpoint returned `{ created, updated, skipped }` but the calling code expected a `message` field. This resulted in `undefined` being logged instead of a proper summary message.

### Location
- **API Route:** `app/api/plant-inspections/sync-defect-tasks/route.ts:127`
- **Calling Code:** `app/(dashboard)/plant-inspections/new/page.tsx:762`

### Problem
```typescript
// API returned:
return NextResponse.json({ created, updated: 0, skipped });

// But caller expected:
console.log(`✅ Sync complete: ${syncResult.message}`); // undefined!
```

### Solution
Added a `message` field to the API response with a properly formatted summary:

```typescript
// Generate summary message
const message = `Created ${created} task${created !== 1 ? 's' : ''}, skipped ${skipped} existing task${skipped !== 1 ? 's' : ''}`;

return NextResponse.json({ created, updated: 0, skipped, message });
```

### Result
- Console now logs: `"✅ Sync complete: Created 3 tasks, skipped 1 existing task"`
- Proper plural handling for both created and skipped counts
- Maintains backward compatibility (existing fields still present)

---

## Bug 2: Unhandled Error in Daily Hours Delete Operation

### Issue
The deletion of existing daily hours records lacked error checking. If deletion failed, the code silently continued and attempted to insert new records, potentially creating duplicate entries or data inconsistency.

### Location
- **File:** `app/(dashboard)/plant-inspections/[id]/page.tsx:207-210`

### Problem
```typescript
// Delete without error checking
await supabase
  .from('inspection_daily_hours')
  .delete()
  .eq('inspection_id', inspection.id);

// Then insert with error checking
const { error: hoursError } = await supabase
  .from('inspection_daily_hours')
  .insert(dailyHoursToInsert);

if (hoursError) throw hoursError; // Asymmetric error handling!
```

**Risk:** If deletion failed but insert succeeded, duplicate entries could accumulate over multiple edits.

### Solution
Added comprehensive error checking for the delete operation:

```typescript
// Update daily hours - delete existing entries first
const { error: deleteHoursError } = await supabase
  .from('inspection_daily_hours')
  .delete()
  .eq('inspection_id', inspection.id);

if (deleteHoursError) {
  console.error('Failed to delete existing daily hours:', deleteHoursError);
  throw deleteHoursError;
}

// Then proceed with insert (existing error handling preserved)
const dailyHoursToInsert = Object.entries(editableDailyHours)
  .filter(([_, hours]) => hours !== null)
  .map(([day, hours]) => ({
    inspection_id: inspection.id,
    day_of_week: parseInt(day),
    hours: hours!
  }));

if (dailyHoursToInsert.length > 0) {
  const { error: hoursError } = await supabase
    .from('inspection_daily_hours')
    .insert(dailyHoursToInsert);

  if (hoursError) throw hoursError;
}
```

### Result
- Symmetric error handling for both delete and insert operations
- Prevents data inconsistency by catching delete failures early
- Transaction-like behavior: if delete fails, insert is never attempted
- Error is logged and propagated to the caller for proper UI feedback

---

## Testing Checklist

- [x] Verify sync message appears correctly in console when creating defect tasks
- [x] Verify plural handling (1 task vs 2+ tasks)
- [x] Verify daily hours update succeeds with proper error handling
- [x] Verify daily hours update fails gracefully if delete operation fails
- [x] Build passes with no linter errors
- [x] No TypeScript errors

---

## Files Changed

1. `app/api/plant-inspections/sync-defect-tasks/route.ts`
   - Added `message` field to response (line 128-130)

2. `app/(dashboard)/plant-inspections/[id]/page.tsx`
   - Added error checking for daily hours deletion (line 207-215)
   - Added clarifying comment (line 206)

---

## Related Issues

These fixes ensure the plant inspections module has consistent error handling patterns that match the vehicle inspections module.

---

## Impact

**Risk Level:** Low  
**User Impact:** None (fixes internal logging and prevents potential data corruption)  
**Breaking Changes:** None  

The fixes improve code reliability and maintainability without changing user-facing behavior.
