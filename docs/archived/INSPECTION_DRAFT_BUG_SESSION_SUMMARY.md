# Inspection Draft Bug - Debugging Session Summary
**Date:** November 27, 2025  
**Status:** 🔴 IN PROGRESS - Issue still present

---

## 📋 Table of Contents
1. [Original Problem](#original-problem)
2. [Issues Identified](#issues-identified)
3. [Fixes Applied](#fixes-applied)
4. [Current Status](#current-status)
5. [Technical Details](#technical-details)
6. [Test Results](#test-results)
7. [Next Steps](#next-steps)
8. [Code Changes Reference](#code-changes-reference)

---

## 🐛 Original Problem

### User Report
A user reported **three critical bugs** in the inspection module:

1. **Draft Loading Bug**: When a draft inspection was saved and reopened, ALL days appeared as completed with all items marked as "OK", even when only some days were actually completed.

2. **Save Failure Bug**: After loading a draft, attempting to save or submit it resulted in "Failed to save inspection" error messages (two errors: one at top, one at bottom).

3. **Data Corruption**: 14 draft inspections in the database had 1,288 corrupted items showing everything as complete when it wasn't.

### User Workflow
The user is experiencing errors when:
1. Creating a draft inspection (e.g., Monday only)
2. Saving it as draft
3. Reopening the draft
4. Adding more data (e.g., Tuesday)
5. Trying to save again → **ERROR**

---

## 🔍 Issues Identified

### Issue #1: Default to 'ok' Bug ✅ FIXED
**Location:** `app/(dashboard)/inspections/new/page.tsx` line 529

**Problem:** When saving a draft, code defaulted all unset items to `'ok'`:
```typescript
status: checkboxStates[key] || 'ok',  // ❌ Bad - defaults to 'ok'
```

**Impact:** 
- User completes Monday only → System saves 98 items (14 Monday + 84 other days all as 'ok')
- User opens draft → Shows all 98 items as complete
- Database gets corrupted with false data

**Fix Applied:**
```typescript
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

**Status:** ✅ **FIXED AND TESTED**

---

### Issue #2: Re-save from [id] Page ✅ FIXED
**Location:** `app/(dashboard)/inspections/[id]/page.tsx` lines 105-165

**Problem:** The `handleSave` function only updated existing items with IDs. New items added during editing weren't inserted.

**Fix Applied:** Changed to delete-and-reinsert pattern:
```typescript
// Delete all existing items
const { error: deleteError } = await supabase
  .from('inspection_items')
  .delete()
  .eq('inspection_id', inspection.id);

// Re-insert all items (handles both updates and new items)
const itemsToInsert: InspectionItemInsert[] = items
  .filter(item => item.status)
  .map(item => ({ /* ... */ }));

await supabase.from('inspection_items').insert(itemsToInsert);
```

**Status:** ✅ **FIXED AND TESTED**

---

### Issue #3: Corrupted Draft Data ✅ CLEANED
**Problem:** 14 draft inspections had 1,288 bogus items from the default-to-'ok' bug.

**Solution:** Created and ran cleanup script `scripts/cleanup-corrupted-draft-inspections.ts`

**Results:**
- Found: 14 draft inspections
- Deleted: 1,288 corrupted items
- All drafts reset to clean state

**Affected Vehicles:**
- TE57 VAN, FE24 TYO, MJ66 FLG, MF14 GCX, DY64 AVV
- KR73 EOF, NV16 AXC, KP65 CWJ, FE24 TYV, CN18 GHZ

**Status:** ✅ **COMPLETED**

---

### Issue #4: Duplicate Key Constraint Error 🔴 STILL BROKEN
**Location:** `app/(dashboard)/inspections/new/page.tsx` lines 495-550

**Error Message:**
```
Failed to save inspection items: duplicate key value violates unique constraint
"inspection_items_inspection_id_item_number_day_key"
```

**Constraint:** `UNIQUE(inspection_id, item_number, day_of_week)`

**Problem Analysis:**
When updating an existing draft via `/inspections/new?id=XXX`:
1. Code attempts to delete existing items
2. Code attempts to insert new items
3. Duplicate key error occurs → **Delete not completing before insert**

**Attempted Fixes:**
1. Added `.select()` to delete operation to ensure synchronous completion
2. Added detailed error logging
3. Created test script to reproduce issue

**Test Script Result:**
- Test passes in isolated environment ✅
- Still fails in production app 🔴

**Status:** 🔴 **STILL BROKEN - NEEDS FURTHER INVESTIGATION**

---

## 🔧 Fixes Applied

### 1. Fixed Default-to-OK Bug
**File:** `app/(dashboard)/inspections/new/page.tsx`
**Changes:**
- Lines 428-464: Offline queue preparation (only save set items)
- Lines 520-550: Online save logic (only save set items)

### 2. Fixed [id] Page Re-save
**File:** `app/(dashboard)/inspections/[id]/page.tsx`
**Changes:**
- Lines 105-165: Implemented delete-and-reinsert pattern

### 3. Added Error Logging
**File:** `app/(dashboard)/inspections/new/page.tsx`
**Changes:**
- Added console logging for debugging
- Better error messages with details
- Track item counts and deletion status

### 4. Enabled Comments Saving
**File:** `app/(dashboard)/inspections/new/page.tsx`
**Changes:**
- Uncommented `comments: comments[key] || null,` (line 538)

### 5. Created Cleanup Script
**File:** `scripts/cleanup-corrupted-draft-inspections.ts`
**Purpose:** Reset all corrupted draft inspections

### 6. Created Test Scripts
**Files:**
- `scripts/test-inspection-draft.ts` - Unit tests (10/10 pass ✅)
- `scripts/test-inspection-e2e.ts` - End-to-end tests (15/15 pass ✅)
- `scripts/test-draft-resave.ts` - Duplicate key test (passes in isolation ✅)

---

## 📊 Test Results

### Unit Tests
**File:** `scripts/test-inspection-draft.ts`
```
Total Tests: 10
✅ Passed: 10
❌ Failed: 0
Success Rate: 100.0%
```

### End-to-End Tests
**File:** `scripts/test-inspection-e2e.ts`
```
Total Tests: 15
✅ Passed: 15
❌ Failed: 0
Success Rate: 100.0%
```

**Coverage:**
- ✅ Create draft with partial data
- ✅ Load draft correctly
- ✅ Add more days to existing draft
- ✅ Re-save draft
- ✅ Verify data persistence
- ✅ Submit inspection

### Duplicate Key Test
**File:** `scripts/test-draft-resave.ts`
```
✅ SUCCESS! Re-save worked correctly!
   No duplicate key constraint error occurred.
   Total items: 28 (14 Monday + 14 Tuesday)
```

**BUT:** Test passes in isolation but fails in production app!

---

## 🎯 Current Status

### What Works ✅
1. Creating new draft inspections with partial data
2. Loading drafts shows correct data (only completed items)
3. Editing drafts from `/inspections/[id]` page
4. First save of a draft works correctly

### What's Broken 🔴
1. **Re-saving a draft from `/inspections/new?id=XXX` still gives duplicate key error**
2. User sees two error messages:
   - Top: "Failed to save inspection. Please check your internet connection and try again."
   - Bottom: "Failed to save inspection. Please try again or contact support if the problem persists."

### Why Tests Pass But App Fails 🤔
**Hypothesis:**
- Test scripts use service role key (bypasses RLS)
- App uses user authentication (subject to RLS policies)
- RLS policies might be interfering with delete operation
- Timing issue between delete and insert in browser environment

---

## 🔍 Technical Details

### Database Schema
**Table:** `inspection_items`
```sql
CREATE TABLE IF NOT EXISTS inspection_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES vehicle_inspections(id) ON DELETE CASCADE NOT NULL,
  item_number INTEGER CHECK (item_number BETWEEN 1 AND 26) NOT NULL,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7) NOT NULL,
  item_description TEXT NOT NULL,
  status TEXT CHECK (status IN ('ok', 'attention', 'na')) NOT NULL,
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(inspection_id, item_number, day_of_week)  -- ← This constraint is violated
);
```

### RLS Policies
Check these policies on `inspection_items`:
```sql
-- View policies
SELECT * FROM pg_policies WHERE tablename = 'inspection_items';
```

### Current Save Logic (new/page.tsx)
```typescript
// When existingInspectionId is set (editing a draft)

// 1. Update inspection record
await supabase
  .from('vehicle_inspections')
  .update(inspectionUpdate)
  .eq('id', existingInspectionId);

// 2. Delete existing items
const { data: deletedData, error: deleteError } = await supabase
  .from('inspection_items')
  .delete()
  .eq('inspection_id', existingInspectionId)
  .select();  // Added .select() to ensure completion

// 3. Insert all items (old + new)
await supabase
  .from('inspection_items')
  .insert(items);  // ← Fails with duplicate key
```

---

## 🚀 Next Steps

### Immediate Actions

1. **Check RLS Policies** ⚠️ HIGH PRIORITY
   ```sql
   -- In Supabase SQL Editor
   SELECT * FROM pg_policies WHERE tablename = 'inspection_items';
   ```
   - Verify delete policy allows users to delete their own items
   - Check if policies might be blocking deletes

2. **Add Transaction Wrapper**
   Consider wrapping delete+insert in a database function:
   ```sql
   CREATE OR REPLACE FUNCTION update_inspection_items(
     p_inspection_id UUID,
     p_items JSONB
   ) RETURNS void AS $$
   BEGIN
     DELETE FROM inspection_items WHERE inspection_id = p_inspection_id;
     INSERT INTO inspection_items SELECT * FROM jsonb_populate_recordset(null::inspection_items, p_items);
   END;
   $$ LANGUAGE plpgsql;
   ```

3. **Add Retry Logic**
   If delete hasn't completed, retry:
   ```typescript
   // Delete with verification
   await supabase.from('inspection_items').delete().eq('inspection_id', id);
   
   // Wait and verify deletion
   await new Promise(resolve => setTimeout(resolve, 100));
   const { count } = await supabase
     .from('inspection_items')
     .select('*', { count: 'exact', head: true })
     .eq('inspection_id', id);
   
   if (count > 0) {
     // Items still exist, retry or error
   }
   ```

4. **Alternative: Use Upsert**
   Instead of delete+insert, try upsert (might not work with composite unique key):
   ```typescript
   await supabase
     .from('inspection_items')
     .upsert(items, {
       onConflict: 'inspection_id,item_number,day_of_week'
     });
   ```

5. **Debug in Browser Console**
   Add more logging before delete and after delete:
   ```typescript
   // Before delete
   const { count: beforeCount } = await supabase
     .from('inspection_items')
     .select('*', { count: 'exact', head: true })
     .eq('inspection_id', id);
   console.log(`Items before delete: ${beforeCount}`);
   
   // After delete
   const { count: afterCount } = await supabase
     .from('inspection_items')
     .select('*', { count: 'exact', head: true })
     .eq('inspection_id', id);
   console.log(`Items after delete: ${afterCount}`);
   ```

### Investigation Areas

1. **RLS Policies**: Most likely culprit
2. **Cascade Deletes**: Check if CASCADE DELETE is working
3. **Timing/Race Conditions**: Browser async behavior
4. **User Permissions**: Verify user can delete their own items
5. **Supabase Client Cache**: May need to clear or refresh

---

## 📝 Code Changes Reference

### Commits Made
```
b7b16f9 test: add draft re-save test for duplicate key constraint
2166e85 fix(inspections): ensure items are deleted before re-inserting
4d3200f fix(inspections): improve error handling and enable comments saving
19b4529 test: add comprehensive end-to-end inspection workflow test
6d0ce77 fix(inspections): handle re-saving edited drafts and cleanup corrupted data
36ade56 docs: add inspection draft bug fix documentation
7e52e21 fix(inspections): prevent draft inspections from defaulting all items to OK
```

### Files Modified
1. `app/(dashboard)/inspections/new/page.tsx` - Main fixes
2. `app/(dashboard)/inspections/[id]/page.tsx` - Re-save fix
3. `scripts/cleanup-corrupted-draft-inspections.ts` - Data cleanup
4. `scripts/test-inspection-draft.ts` - Unit tests
5. `scripts/test-inspection-e2e.ts` - E2E tests
6. `scripts/test-draft-resave.ts` - Duplicate key test
7. `docs/guides/INSPECTION_DRAFT_BUG_FIX.md` - Documentation

### Key Code Locations

**Main save function:**
- File: `app/(dashboard)/inspections/new/page.tsx`
- Function: `saveInspection` (line 402)
- Update logic: Lines 472-506
- Delete operation: Lines 499-509
- Insert operation: Lines 520-550

**View page save function:**
- File: `app/(dashboard)/inspections/[id]/page.tsx`
- Function: `handleSave` (line 105)
- Delete+reinsert: Lines 125-154

---

## 🔎 Debugging Commands

### Check Current State
```bash
# Run tests to verify fixes
npx tsx scripts/test-inspection-draft.ts
npx tsx scripts/test-inspection-e2e.ts
npx tsx scripts/test-draft-resave.ts

# Check for corrupted data
npx tsx scripts/cleanup-corrupted-draft-inspections.ts
```

### Database Queries
```sql
-- Check draft inspections
SELECT id, status, inspection_date, inspection_end_date 
FROM vehicle_inspections 
WHERE status = 'draft';

-- Check items for a specific inspection
SELECT * FROM inspection_items 
WHERE inspection_id = 'YOUR_INSPECTION_ID'
ORDER BY day_of_week, item_number;

-- Check for duplicates
SELECT inspection_id, item_number, day_of_week, COUNT(*) 
FROM inspection_items 
GROUP BY inspection_id, item_number, day_of_week 
HAVING COUNT(*) > 1;
```

---

## 💡 Important Notes

1. **Do NOT revert to commit c349c1b** - The PWA changes were not the cause
2. **Users need to re-complete their draft inspections** - Data was corrupted and cleaned
3. **Test scripts all pass** - Issue is specific to browser/RLS environment
4. **Comments field is now working** - Was previously commented out
5. **Cleanup script is idempotent** - Can be run multiple times safely

---

## 📞 Contact & Handoff

### Current State
- ✅ 3 of 4 issues fixed
- 🔴 1 issue remaining: Duplicate key constraint on re-save
- 🧪 All tests pass in isolation
- 🔴 Fails in production app with user auth

### For Next Developer
1. Start by checking RLS policies on `inspection_items` table
2. Look at browser console for exact error sequence
3. Consider implementing database function for atomic delete+insert
4. Check if user has DELETE permission on their own items

### Questions to Answer
- Do RLS policies block the delete operation?
- Is there a timing issue between delete and insert?
- Could Supabase client be caching the old items?
- Should we use a different approach (upsert, stored procedure)?

---

**End of Session Summary**

