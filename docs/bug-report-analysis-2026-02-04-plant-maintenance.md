# Bug Report Analysis: Plant Maintenance Issues

**Date:** 2026-02-04  
**Status:** Bug 1 INVALID / Bug 2 FIXED ✅

## Bug 1: Alleged Missing plant_id Column (INVALID)

### Reported Issue
> PlantOverview queries `vehicle_maintenance` table for records with `plant_id` not null, then tries to match maintenance data using `m.plant_id === plant.id`. However, the `vehicle_maintenance` table likely doesn't have a `plant_id` column—it only has `vehicle_id`. EditPlantRecordDialog attempts to write to this non-existent column, which will cause database errors.

### Analysis Result: **INVALID**

The `plant_id` column **DOES EXIST** in the `vehicle_maintenance` table.

**Evidence:**

1. **Migration File:** `supabase/migrations/20260202_create_plant_table.sql` Lines 116-127:
   ```sql
   -- Add plant_id to vehicle_maintenance
   ALTER TABLE vehicle_maintenance
   ADD COLUMN plant_id UUID NULL REFERENCES plant(id) ON DELETE CASCADE;
   
   CREATE INDEX idx_vehicle_maintenance_plant_id ON vehicle_maintenance(plant_id) WHERE plant_id IS NOT NULL;
   
   -- Note: vehicle_maintenance always requires either vehicle_id or plant_id
   ALTER TABLE vehicle_maintenance
   ADD CONSTRAINT check_maintenance_asset CHECK (
     (vehicle_id IS NOT NULL AND plant_id IS NULL) OR
     (vehicle_id IS NULL AND plant_id IS NOT NULL)
   );
   ```

2. **Code is Correct:**
   - `PlantOverview.tsx` line 72: `.not('plant_id', 'is', null)` ✅
   - `PlantOverview.tsx` line 78: `m.plant_id === plant.id` ✅
   - `EditPlantRecordDialog.tsx` line 234: `plant_id: plant.id` ✅
   - `EditPlantRecordDialog.tsx` line 267: `plant_id: plant.id` ✅

3. **Schema Design:**
   - The `vehicle_maintenance` table supports BOTH vehicles and plant
   - Uses `vehicle_id` for vehicles, `plant_id` for plant
   - Check constraint ensures exactly one is set (never both, never neither)

### Conclusion
**No action required.** The code is working as designed. The `plant_id` column exists and is being used correctly.

---

## Bug 2: Async Callback Timing Issue (VALID & FIXED)

### Reported Issue
> `onVehicleAdded` callback is invoked immediately after calling `fetchPlantData()` without waiting for the async operation to complete. Since `fetchPlantData()` is asynchronous and updates state, the callback fires before plant data is actually fetched and state is updated. This causes the parent component to attempt refreshes and recalculations with stale data.

### Analysis Result: **VALID** ✅

### Problem

**PlantTable.tsx** Lines 639-643:
```typescript
onSuccess={() => {
  fetchPlantData();      // ❌ Async function, not awaited
  onVehicleAdded?.();    // ❌ Fires immediately with stale data
}}
```

**Issue:**
1. `fetchPlantData()` is an async function that fetches from database and updates state
2. It's called without `await`, so execution continues immediately
3. `onVehicleAdded()` callback fires before data is fetched
4. Parent component (fleet page) receives callback with stale data
5. Parent attempts to refresh/recalculate using old plant asset count

**Impact:**
- Category counts on fleet page don't update immediately
- User sees stale data until manual refresh
- Race condition: callback data doesn't match actual database state

### Fix Applied

**PlantTable.tsx** Lines 639-644 (Updated):
```typescript
onSuccess={async () => {              // ✅ Make callback async
  await fetchPlantData();              // ✅ Wait for fetch to complete
  onVehicleAdded?.();                  // ✅ Callback fires with fresh data
}}
```

**Why This Works:**
1. Callback is now async, allowing use of `await`
2. `fetchPlantData()` completes fully before continuing
3. State is updated with new plant data
4. `onVehicleAdded()` fires with fresh, synchronized data
5. Parent component gets callback after data is ready

### Changes Made

**File:** `app/(dashboard)/maintenance/components/PlantTable.tsx`  
**Lines:** 639-644

**Before:**
```typescript
onSuccess={() => {
  fetchPlantData();
  onVehicleAdded?.();
}}
```

**After:**
```typescript
onSuccess={async () => {
  await fetchPlantData();
  onVehicleAdded?.();
}}
```

### Verification

**Data Flow After Fix:**

1. User adds plant asset via `AddVehicleDialog`
2. Dialog's `onSuccess` callback fires
3. `fetchPlantData()` runs and **waits** for:
   - Database query to complete
   - State update (`setActivePlantAssets`)
4. `onVehicleAdded()` fires with synchronized state
5. Parent component (fleet page) refreshes with correct data

**Before:**
```
Add Plant → onSuccess → fetchPlantData() (starts) → onVehicleAdded() (stale) → fetchPlantData() (finishes)
           ❌ Callback fires before data is ready
```

**After:**
```
Add Plant → onSuccess → fetchPlantData() (completes) → onVehicleAdded() (fresh) ✅
           ✅ Callback fires after data is ready
```

### Related Code

**PlantTable.fetchPlantData** (Lines 103-157):
```typescript
const fetchPlantData = useCallback(async () => {
  setLoading(true);
  try {
    // ... fetch from database
    const { data: plantData, error: plantError } = await supabase
      .from('plant')
      // ... query
    
    // ... process data
    setActivePlantAssets(combined); // ✅ State update
  } catch (error) {
    // ... error handling
  } finally {
    setLoading(false);
  }
}, [supabase]);
```

This function is async and updates state, so it must complete before dependent operations.

### Impact

**Before Fix:**
- ❌ Parent component receives callback before plant data is fetched
- ❌ Category counts show stale values
- ❌ Race condition between fetch and callback
- ❌ User may need to manually refresh to see correct counts

**After Fix:**
- ✅ Parent component receives callback after plant data is fetched
- ✅ Category counts update immediately
- ✅ No race condition - data synchronized
- ✅ User sees correct counts immediately

---

## Summary

| Bug | Status | Action Taken |
|-----|--------|--------------|
| **Bug 1:** Missing plant_id column | ❌ INVALID | None - column exists, code correct |
| **Bug 2:** Async callback timing | ✅ VALID & FIXED | Added `async`/`await` to synchronize |

### Files Changed
- ✅ `app/(dashboard)/maintenance/components/PlantTable.tsx` (Lines 639-644)

### Files Verified (No Changes Needed)
- ✅ `app/(dashboard)/maintenance/components/PlantOverview.tsx`
- ✅ `app/(dashboard)/maintenance/components/EditPlantRecordDialog.tsx`
- ✅ `supabase/migrations/20260202_create_plant_table.sql`

### Related Fixes
This fix complements **Bug 11** (Plant Asset State Desynchronization), which added the `onVehicleAdded` callback mechanism. Now that callback fires with properly synchronized data.

---

## Technical Notes

### Async/Await Pattern

**Anti-pattern (before):**
```typescript
onSuccess={() => {
  asyncFunction();  // ❌ Fire and forget
  callback();       // ❌ Fires too early
}}
```

**Correct pattern (after):**
```typescript
onSuccess={async () => {
  await asyncFunction();  // ✅ Wait for completion
  callback();             // ✅ Fires after data ready
}}
```

### Why This Matters

React state updates are asynchronous. When `setActivePlantAssets()` is called inside `fetchPlantData()`:
1. The state update is scheduled
2. Re-render is queued
3. Function returns before re-render happens

By using `await`, we ensure:
1. Database query completes
2. State update is scheduled
3. **Then** callback fires
4. Parent component receives notification with synchronized state

This prevents race conditions and ensures data consistency across components.
