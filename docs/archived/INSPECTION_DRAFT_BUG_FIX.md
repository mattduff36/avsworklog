# Inspection Draft Bug Fix

## Date
November 27, 2025

## Issue Summary
Two critical bugs were affecting the inspection module's draft functionality:

1. **Draft Loading Bug**: When a draft inspection was saved and reopened, ALL days appeared as completed with all items marked as "OK", even when only some days were actually completed.

2. **Save Failure Bug**: After loading a draft, attempting to save or submit it would sometimes result in a "Failed to save inspection" error.

## Root Cause

### Primary Issue
The bug was in the `saveInspection` function in `app/(dashboard)/inspections/new/page.tsx` at line 529:

```typescript
// OLD CODE (BUGGY)
status: checkboxStates[key] || 'ok',  // ❌ Defaults to 'ok' if not set
```

When saving a draft, the code would iterate through ALL possible items (14 items × 7 days = 98 items) and save each one to the database. If a checkbox state wasn't explicitly set by the user, it would default to `'ok'`.

This meant:
- User completes Monday only → 98 items saved (14 Monday + 84 other days all as 'ok')
- User opens draft → Loads all 98 items with 'ok' status
- UI shows all days completed ✓✓✓

### Database Constraint
The database schema enforces that the `status` field is `NOT NULL`:

```sql
status TEXT CHECK (status IN ('ok', 'attention', 'na')) NOT NULL
```

This means we MUST provide a status value when inserting. The original code chose to default everything to `'ok'`, which caused the bug.

## The Fix

Changed the logic to **only save items that have been explicitly set by the user**:

```typescript
// NEW CODE (FIXED)
// Only save items that have been explicitly set by the user
if (checkboxStates[key]) {
  items.push({
    inspection_id: inspection.id,
    item_number: itemNumber,
    item_description: item,
    day_of_week: dayOfWeek,
    status: checkboxStates[key],  // ✅ Only saved if explicitly set
  });
}
```

### How It Works Now

**Before Fix:**
1. User completes Monday → Saves 98 items (14 Monday + 84 other days as 'ok')
2. User opens draft → Loads 98 items
3. UI shows all days completed ❌

**After Fix:**
1. User completes Monday → Saves 14 items (Monday only) ✅
2. User opens draft → Loads 14 items
3. UI shows only Monday completed ✅
4. User adds Tuesday → Now has 28 items in state
5. User saves → Saves 28 items ✅

## Files Changed

1. **`app/(dashboard)/inspections/new/page.tsx`**
   - Modified `saveInspection` function (2 locations)
   - Lines 428-464: Offline queue preparation
   - Lines 516-541: Online save logic

## Testing

Created comprehensive test script: `scripts/test-inspection-draft.ts`

### Test Coverage
1. ✅ Create draft with partial data (Monday only)
2. ✅ Verify only Monday items saved
3. ✅ Add Tuesday items
4. ✅ Verify both Monday and Tuesday exist
5. ✅ Edit existing items
6. ✅ Verify edits persist
7. ✅ Submit inspection
8. ✅ Verify submission status

### Test Results
```
Total Tests: 10
✅ Passed: 10
❌ Failed: 0
Success Rate: 100.0%
```

## Verification Steps

To manually verify the fix:

1. **Create a draft with partial data:**
   ```
   - Go to Inspections → New Inspection
   - Select a vehicle
   - Complete Monday only
   - Click "Save Draft"
   ```

2. **Verify draft loads correctly:**
   ```
   - Return to Inspections
   - Click on the draft
   - Verify only Monday shows as completed
   - Verify other days show as empty/incomplete
   ```

3. **Add more data and save:**
   ```
   - Complete Tuesday
   - Click "Save Draft"
   - Reload the page
   - Verify both Monday and Tuesday show correctly
   ```

4. **Submit the inspection:**
   ```
   - Complete remaining days as needed
   - Click "Submit Inspection"
   - Verify no errors
   - Verify submission succeeds
   ```

## Impact

- **Users can now save partial inspections** without the system incorrectly marking everything as complete
- **Draft inspections load with accurate data** showing only what was actually completed
- **Re-saving drafts works reliably** without "Failed to save" errors
- **Better user experience** as progress is accurately represented

## Related Code

- Inspection types: `types/inspection.ts`
- Database schema: `supabase/schema.sql` (line 78-86)
- View inspection page: `app/(dashboard)/inspections/[id]/page.tsx`

## Notes

- The fix does NOT require database migrations
- Existing draft inspections with incorrect data will remain as-is, but new saves will be correct
- The offline functionality was also updated with the same fix
- No changes to the database schema were required

