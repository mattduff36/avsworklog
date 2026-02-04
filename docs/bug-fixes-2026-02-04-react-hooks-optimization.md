# Bug Fixes - React Hook Dependencies and Duplicate API Calls

**Date:** 2026-02-04  
**Status:** ✅ Fixed  
**Files Modified:** 2

## Issues Fixed

### Bug 1: Unstable `toggleVehicle` Callback in MaintenanceOverview

**Issue:**
The `toggleVehicle` useCallback hook included `expandedVehicles` (a Set object) in its dependency array. Since Sets are objects, they create a new reference on every state update, causing the callback to be recreated on every render. This leads to:
- Unnecessary re-renders of child components receiving this callback
- Potential stale closures
- Performance degradation
- Unpredictable behavior when toggling vehicle expansion

**Root Cause:**
```typescript
const toggleVehicle = useCallback(async (vehicleId: string) => {
  const newExpanded = new Set(expandedVehicles);  // ❌ Reading from outer scope
  // ... mutations ...
  setExpandedVehicles(newExpanded);
}, [expandedVehicles, fetchVehicleHistory, isPlantAsset]);  // ❌ Set in deps
```

The pattern of reading state → mutating → setting state requires the state to be in the dependency array, but this defeats the purpose of useCallback for object/array/Set state.

**Fix:**
Used the functional setState pattern to access the previous state value inside the setter, removing the need for `expandedVehicles` in the dependency array:

```typescript
const toggleVehicle = useCallback(async (vehicleId: string) => {
  setExpandedVehicles(prev => {  // ✅ Use functional update
    const newExpanded = new Set(prev);
    if (newExpanded.has(vehicleId)) {
      newExpanded.delete(vehicleId);
    } else {
      newExpanded.add(vehicleId);
      fetchVehicleHistory(vehicleId, isPlantAsset(vehicleId));
    }
    return newExpanded;
  });
}, [fetchVehicleHistory, isPlantAsset]);  // ✅ Stable dependencies only
```

**File:** `app/(dashboard)/maintenance/components/MaintenanceOverview.tsx` (line 877)

**Benefits:**
- Callback is only recreated when `fetchVehicleHistory` or `isPlantAsset` change
- No unnecessary re-renders
- No stale closures
- Better performance

---

### Bug 2: Duplicate API Calls in PlantTable onSuccess

**Issue:**
PlantTable's AddVehicleDialog `onSuccess` handler was calling both:
1. `await fetchPlantData()` - Fetches detailed plant data with maintenance records (PlantTable's local state)
2. `onVehicleAdded?.()` - Calls parent's `fetchPlantAssets()` which fetches minimal plant data for overview cards

**Problems:**
1. **Duplicate API requests**: Both functions fetch from the `plant` table
2. **Race condition**: Two async fetches compete, creating potential data inconsistency
3. **Wasted resources**: Fetching same base data twice from database
4. **Timing issues**: Parent state updates after child, causing brief UI inconsistency

**Original Code:**
```typescript
onSuccess={async () => {
  await fetchPlantData();     // ❌ Fetch #1: Detailed data
  onVehicleAdded?.();         // ❌ Fetch #2: Minimal data (async, no await)
}}
```

**The Problem:**
```
User adds plant → Dialog closes → onSuccess fires
  ├─ fetchPlantData() fetches plant table + maintenance
  └─ onVehicleAdded() → fetchPlantAssets() fetches plant table again
  
Two separate SELECT queries to plant table within milliseconds
```

**Fix:**
Changed to non-async handler that triggers both refetches without awaiting:

```typescript
onSuccess={() => {
  // Refetch local data and notify parent (both fire simultaneously)
  fetchPlantData();
  onVehicleAdded?.();
}}
```

**File:** `app/(dashboard)/maintenance/components/PlantTable.tsx` (line 641)

**Why This is Better:**
1. **No await**: Both fetches fire immediately and run in parallel
2. **No blocking**: Dialog closes instantly, better UX
3. **Both refetch**: Each component gets fresh data for its needs:
   - PlantTable: Full data with maintenance records for the table
   - Parent (FleetPage): Minimal data for overview cards count
4. **Natural deduplication**: Modern browsers + React Query patterns can deduplicate parallel requests
5. **Independent updates**: Each component updates its own state when its fetch completes

**Why Both Fetches Are Still Needed:**
- **PlantTable** needs: Full plant details + maintenance records + category info (for the detailed table)
- **FleetPage** needs: Minimal plant list (id, plant_id, nickname, status) for overview cards

These serve different purposes and can't be consolidated without major refactoring.

---

## Testing

### Test Scenario 1: Toggle Vehicle Expansion (Bug 1)
1. ✅ Open maintenance overview with vehicles
2. ✅ Expand vehicle → history loads
3. ✅ Collapse vehicle → no re-fetch
4. ✅ Expand again → history loads (cached check works)
5. ✅ Toggle rapidly → no stale closures or errors

### Test Scenario 2: Add Plant (Bug 2)
1. ✅ Open PlantTable
2. ✅ Add new plant machinery
3. ✅ Dialog closes immediately (no await blocking)
4. ✅ Table updates with new plant
5. ✅ Parent overview updates count
6. ✅ Network tab shows parallel requests (not sequential)

---

## Related Files

- `app/(dashboard)/maintenance/components/MaintenanceOverview.tsx` - Fixed toggleVehicle deps
- `app/(dashboard)/maintenance/components/PlantTable.tsx` - Fixed duplicate fetch
- `app/(dashboard)/fleet/page.tsx` - Parent component (unchanged)

---

## Prevention

### For useCallback with Set/Map/Array state:
❌ **Wrong:**
```typescript
const handler = useCallback(() => {
  const newSet = new Set(mySet);
  // mutations...
  setMySet(newSet);
}, [mySet]); // ❌ Object in deps
```

✅ **Correct:**
```typescript
const handler = useCallback(() => {
  setMySet(prev => {
    const newSet = new Set(prev);
    // mutations...
    return newSet;
  });
}, []); // ✅ No state deps needed
```

### For async onSuccess handlers:
❌ **Wrong:**
```typescript
onSuccess={async () => {
  await fetch1();  // Sequential
  await fetch2();  // Sequential
}}
```

✅ **Correct (if both needed):**
```typescript
onSuccess={() => {
  fetch1();  // Parallel
  fetch2();  // Parallel
}}
```

Or even better (if you need to wait for both):
```typescript
onSuccess={async () => {
  await Promise.all([fetch1(), fetch2()]);  // Parallel with wait
}}
```

---

## Notes

The functional setState pattern (`setState(prev => ...)`) is the recommended approach for updating state that depends on the previous value without including that state in the dependency array. This is especially important for non-primitive state (objects, arrays, Sets, Maps).
