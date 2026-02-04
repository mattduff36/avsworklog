# Bug Fixes: Plant Maintenance Components

**Date:** 2026-02-04  
**Issues:** Multiple bugs in plant maintenance data fetching and state management  
**Status:** ✅ Fixed

## Problems Fixed

### Bug 2: Incorrect `isPlantAsset` Logic ❌→✅

**Location:** `MaintenanceOverview.tsx:239`

**Problem:**
```typescript
// BEFORE (incorrect)
const vehicle = vehicles.find(v => (v.vehicle_id || v.id) === vehicleId);
```

The logic used `||` (OR) operator which returns the first truthy value. This means:
- If `v.vehicle_id` exists, it compares `v.vehicle_id === vehicleId`
- If `v.vehicle_id` is falsy, it uses `v.id` as the comparison value (not comparing it!)

This breaks when `vehicle_id` exists but doesn't match, because it never checks `id`.

**Fix:**
```typescript
// AFTER (correct)
const vehicle = vehicles.find(v => v.vehicle_id === vehicleId || v.id === vehicleId);
```

Now properly checks both fields with separate comparisons.

---

### Bug 3: Missing Dependencies in `toggleVehicle` ❌→✅

**Location:** `MaintenanceOverview.tsx:849-858`

**Problem:**
```typescript
// BEFORE
const toggleVehicle = async (vehicleId: string, vehicle?: VehicleMaintenanceWithStatus) => {
  // ... uses isPlantAsset(vehicleId)
  fetchVehicleHistory(vehicleId, isPlantAsset(vehicleId));
};
```

`toggleVehicle` uses `isPlantAsset` but wasn't memoized with `useCallback`, causing:
- Stale closures over `isPlantAsset`
- Always uses old version of `isPlantAsset`
- Doesn't reflect changes to `vehicles` array

**Fix:**
```typescript
// AFTER
const toggleVehicle = useCallback(async (vehicleId: string, vehicle?: VehicleMaintenanceWithStatus) => {
  // ... 
  fetchVehicleHistory(vehicleId, isPlantAsset(vehicleId));
}, [expandedVehicles, fetchVehicleHistory, isPlantAsset]);
```

Now properly memoized with all dependencies.

---

### Bug 4: PlantOverview Empty Dependency Array ❌→✅

**Location:** `PlantOverview.tsx:43-45`

**Problem:**
```typescript
// BEFORE
useEffect(() => {
  fetchPlantAssets();
}, []); // Empty dependency array

const fetchPlantAssets = async () => {
  // Fetch logic...
};
```

Issues:
- Effect runs only once on mount
- No way to refetch when data changes
- `fetchPlantAssets` recreated on every render but effect never re-runs

**Fix:**
```typescript
// AFTER
const fetchPlantAssets = useCallback(async () => {
  // Fetch logic...
}, [supabase]);

useEffect(() => {
  fetchPlantAssets();
}, [fetchPlantAssets]);
```

Benefits:
- `fetchPlantAssets` memoized with `supabase` dependency
- Effect re-runs when `fetchPlantAssets` reference changes
- Stable function reference prevents unnecessary re-fetches

---

### Bug 5: PlantTable Empty Dependency Array ❌→✅

**Location:** `PlantTable.tsx:102-106`

**Problem:**
Same as Bug 4 - empty dependency array causes data to fetch only once:

```typescript
// BEFORE
useEffect(() => {
  fetchPlantData();
}, []);

const fetchPlantData = async () => {
  // Fetch logic...
};
```

**Fix:**
```typescript
// AFTER
const fetchPlantData = useCallback(async () => {
  // Fetch logic...
}, [supabase]);

useEffect(() => {
  fetchPlantData();
}, [fetchPlantData]);
```

Same benefits as Bug 4 fix.

---

## Impact

### Before Fixes
- ❌ `isPlantAsset` failed to identify plants with only `id` field
- ❌ `toggleVehicle` used stale plant detection logic
- ❌ PlantOverview never refetched data after initial mount
- ❌ PlantTable never refetched data after initial mount
- ❌ Inconsistent behavior between components

### After Fixes
- ✅ `isPlantAsset` correctly checks both `vehicle_id` and `id`
- ✅ `toggleVehicle` always uses current plant detection logic
- ✅ PlantOverview refetches when Supabase client changes
- ✅ PlantTable refetches when Supabase client changes
- ✅ Consistent behavior across all components

## Technical Details

### useCallback Pattern

The fix uses React's `useCallback` to memoize fetch functions:

```typescript
const fetchData = useCallback(async () => {
  // Fetch logic that depends on supabase
}, [supabase]); // Dependency: refetch when supabase changes

useEffect(() => {
  fetchData();
}, [fetchData]); // Dependency: run when fetchData reference changes
```

**Why this works:**
1. `fetchData` is memoized - same reference unless `supabase` changes
2. `useEffect` depends on `fetchData` - re-runs when reference changes
3. When `supabase` changes → new `fetchData` → effect re-runs
4. Stable `supabase` → same `fetchData` → effect doesn't re-run

### Boolean Logic Fix

```typescript
// Wrong: (a || b) === c
// This evaluates to: (a === c) if a is truthy, otherwise b
(v.vehicle_id || v.id) === vehicleId

// Correct: (a === c) || (b === c)
// This properly checks both conditions
v.vehicle_id === vehicleId || v.id === vehicleId
```

## Verification

### Test Coverage
Created `tests/unit/plant-maintenance-component-fixes.test.ts` with:
- ✅ Tests for `isPlantAsset` logic with various scenarios
- ✅ Validates `useCallback` dependency arrays
- ✅ Tests fetch behavior with changing dependencies
- ✅ Validates plant endpoint data structure

### Test Results
```bash
✓ tests/unit/plant-maintenance-component-fixes.test.ts (11 tests) 10ms
```

## Related Files

**Components:**
- `app/(dashboard)/maintenance/components/MaintenanceOverview.tsx`
- `app/(dashboard)/maintenance/components/PlantOverview.tsx`
- `app/(dashboard)/maintenance/components/PlantTable.tsx`

**Tests:**
- `tests/unit/plant-maintenance-component-fixes.test.ts`

## Prevention

To prevent similar issues:

1. **Always use proper boolean logic**: Use `a === x || b === x` not `(a || b) === x`
2. **Memoize functions with useCallback**: When functions depend on props/state
3. **Include all dependencies**: ESLint exhaustive-deps rule helps catch these
4. **Test edge cases**: Empty arrays, undefined values, etc.
5. **Document dependency requirements**: Comment why each dependency is needed

## Notes

- Bug 1 (endpoint exists) was a false positive - the endpoint is properly implemented
- These fixes improve reliability without changing user-visible behavior
- The `useCallback` pattern enables future enhancements like polling or real-time subscriptions
- All changes are backward compatible
