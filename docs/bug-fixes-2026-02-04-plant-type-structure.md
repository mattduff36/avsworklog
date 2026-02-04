# Bug Fixes: Plant Maintenance Type Structure and Auto-Fetch

**Date:** 2026-02-04  
**Issues:** Incomplete type structure and incorrect field mapping in plant maintenance  
**Status:** ✅ Fixed

## Problems Fixed

### Bug 1: Incomplete Status Fields in Plant Objects ❌→✅

**Location:** `PlantOverview.tsx:79-95` and `MaintenanceOverview.tsx:244-253`

**Problem:**
PlantOverview created objects with only `loler_status` but missing:
- `tax_status`
- `mot_status`
- `service_status`
- `cambelt_status`
- `first_aid_status`

MaintenanceOverview's auto-fetch logic checked all these fields:

```typescript
// MaintenanceOverview auto-fetch filter
const vehiclesWithAlerts = vehicles.filter(v => {
  return v.tax_status?.status === 'overdue' || ... ||
         v.loler_status?.status === 'overdue' || ...;
});
```

**Impact:**
Plant assets without LOLER alerts would fail the filter check because all other status fields were `undefined`, causing them to be skipped from auto-fetch even if they had maintenance requirements.

**Fix:**

1. **PlantOverview - Added explicit null status fields:**
```typescript
return {
  vehicle_id: plant.id,
  plant_id: plant.plant_id, // Fixed in Bug 2
  is_plant: true,
  // ... other fields ...
  loler_status,
  // Explicitly set other statuses to null for plant assets
  tax_status: null,
  mot_status: null,
  service_status: null,
  cambelt_status: null,
  first_aid_status: null,
  overdue_count: alertCounts.overdue,
  due_soon_count: alertCounts.due_soon,
};
```

2. **MaintenanceOverview - Improved filter logic:**
```typescript
const vehiclesWithAlerts = vehicles.filter(v => {
  // Check alert counts first (works for both vehicles and plant)
  if (v.overdue_count > 0 || v.due_soon_count > 0) {
    return true;
  }
  
  // Fallback: Check individual status fields (for compatibility)
  return v.tax_status?.status === 'overdue' || ... ;
});
```

**Benefits:**
- ✅ Plant assets with any alerts are now auto-fetched
- ✅ More efficient (checks counts before individual fields)
- ✅ Works for both vehicles and plant assets
- ✅ Future-proof for hours-based service alerts

---

### Bug 2: Wrong `plant_id` Field Mapping ❌→✅

**Location:** `PlantOverview.tsx:82` and `PlantTable.tsx:134`

**Problem:**
Both components set `plant_id` to the database UUID instead of the human-readable identifier:

```typescript
// BEFORE (incorrect)
return {
  plant_id: plant.id, // ❌ UUID: "12345-67890-abcdef"
  // Should be the human-readable ID like "P001"
};
```

**Semantic Contract Violation:**
- `plant.id` = Database UUID (internal use)
- `plant.plant_id` = Human-readable identifier (P001, P002, etc.)
- Top-level `plant_id` should be the display identifier, not the UUID

**Impact:**
- Code expecting `plant_id` to be human-readable would get UUIDs
- Display logic could show UUIDs instead of "P001"
- Violates naming conventions (UUID fields should be named `id` or `*_id`, not `plant_id`)

**Fix:**

**PlantOverview.tsx:**
```typescript
// AFTER (correct)
return {
  vehicle_id: plant.id,           // UUID for API routing
  plant_id: plant.plant_id,       // ✅ Human-readable identifier
  is_plant: true,
  vehicle: {
    ...plant,                     // Spread includes both id and plant_id
    id: plant.id
  },
  // ...
};
```

**PlantTable.tsx:**
```typescript
// AFTER (correct)
return {
  plant_id: plant.plant_id,       // ✅ Human-readable identifier (P001)
  plant: plant as PlantAsset,
  // ...
};
```

**Benefits:**
- ✅ `plant_id` now contains human-readable identifier
- ✅ Matches semantic expectations
- ✅ Consistent with naming conventions
- ✅ Nested `plant.id` still accessible for UUID when needed

---

## Data Structure

### After Fix - Correct Structure

```typescript
// PlantOverview output
{
  vehicle_id: "uuid-123-456",        // UUID for API calls
  plant_id: "P001",                  // Human-readable for display ✅
  is_plant: true,
  vehicle: {
    id: "uuid-123-456",              // UUID
    plant_id: "P001",                // Human-readable ✅
    nickname: "Excavator 1",
    // ... other fields from spread
  },
  loler_status: { status: 'due_soon', days_until: 15 },
  tax_status: null,                  // Explicit null ✅
  mot_status: null,
  service_status: null,
  cambelt_status: null,
  first_aid_status: null,
  overdue_count: 0,
  due_soon_count: 1,
}
```

### PlantTable Structure

```typescript
{
  plant_id: "P001",                  // Human-readable ✅
  plant: {
    id: "uuid-123-456",              // UUID
    plant_id: "P001",                // Human-readable
    nickname: "Excavator 1",
  },
  current_hours: 1250,
  next_service_hours: 1500,
}
```

---

## Changes Made

### 1. PlantOverview.tsx
- Line 82: Changed `plant_id: plant.id` → `plant_id: plant.plant_id`
- Lines 92-96: Added explicit null status fields
- Updated type definition with comments

### 2. MaintenanceOverview.tsx
- Lines 245-253: Improved filter to check alert counts first
- Added fallback to individual status checks for compatibility

### 3. PlantTable.tsx
- Line 134: Changed `plant_id: plant.id` → `plant_id: plant.plant_id`
- Updated type definition with comment

---

## Verification

### Test Coverage
Created `tests/unit/plant-maintenance-type-structure-fixes.test.ts` with:
- ✅ Validates all status fields are present in plant objects
- ✅ Tests auto-fetch filter logic with alert counts
- ✅ Verifies plant_id uses human-readable identifier
- ✅ Tests consistency between PlantOverview and PlantTable
- ✅ Validates UUID preservation in nested objects

### Test Results
```bash
✓ tests/unit/plant-maintenance-type-structure-fixes.test.ts (8 tests) 8ms
```

---

## Impact

### Before Fixes

**Bug 1:**
- ❌ Plant assets without LOLER alerts skipped from auto-fetch
- ❌ Filter logic didn't work properly for plant assets
- ❌ Incomplete type structure could cause issues

**Bug 2:**
- ❌ `plant_id` contained UUID instead of human-readable ID
- ❌ Violated semantic contract
- ❌ Could cause display issues if code relied on top-level `plant_id`

### After Fixes

**Bug 1:**
- ✅ All plant assets with alerts are auto-fetched
- ✅ Filter checks alert counts (more efficient)
- ✅ Complete type structure prevents future bugs
- ✅ Works for both vehicles and plant assets

**Bug 2:**
- ✅ `plant_id` contains human-readable identifier (P001)
- ✅ Matches naming conventions
- ✅ Consistent across all components
- ✅ UUID still accessible via `vehicle_id` and nested fields

---

## Example: Before vs After

### Bug 1 Example

**Before:**
```typescript
// Plant without LOLER alert
const plant = {
  loler_status: { status: 'ok' },
  overdue_count: 1, // Has other alerts
  // Missing: tax_status, mot_status, etc.
};

// Filter check
v.tax_status?.status === 'overdue' // undefined === 'overdue' → false
// ... all checks return false ...
// ❌ Plant is skipped from auto-fetch
```

**After:**
```typescript
// Plant without LOLER alert
const plant = {
  loler_status: { status: 'ok' },
  tax_status: null,
  mot_status: null,
  // ... all statuses explicitly set
  overdue_count: 1,
  due_soon_count: 0,
};

// Filter check
if (v.overdue_count > 0 || v.due_soon_count > 0) {
  return true; // ✅ Caught by first check!
}
```

### Bug 2 Example

**Before:**
```typescript
plant_id: "uuid-12345-67890" // ❌ UUID instead of "P001"
```

**After:**
```typescript
plant_id: "P001" // ✅ Human-readable identifier
```

---

## Related Files

**Components:**
- `app/(dashboard)/maintenance/components/PlantOverview.tsx`
- `app/(dashboard)/maintenance/components/MaintenanceOverview.tsx`
- `app/(dashboard)/maintenance/components/PlantTable.tsx`

**Tests:**
- `tests/unit/plant-maintenance-type-structure-fixes.test.ts`

---

## Prevention

1. **Always set all expected fields**: Even if null, explicitly set fields that filter logic checks
2. **Use semantic field names**: `*_id` for UUIDs, descriptive names for display IDs
3. **Document field purposes**: Comment whether field is UUID or human-readable
4. **Check alert counts first**: More efficient and works across asset types
5. **Test with missing fields**: Ensure logic handles undefined vs null correctly
