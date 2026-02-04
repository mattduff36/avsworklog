# Bug Fix: Plant History API 404 Errors

**Date:** 2026-02-04  
**Issue:** Plant UUIDs being passed to vehicle history endpoint causing 404 errors  
**Status:** ✅ Fixed

## Problem Description

The `PlantOverview` component was creating maintenance objects with plant UUIDs stored in the `vehicle_id` field and passing them to `MaintenanceOverview`. When `MaintenanceOverview` detected LOLER alerts on these plant assets (lines 345-360), it would attempt to auto-fetch maintenance history by calling `fetchVehicleHistory()` with the plant UUID.

However, `fetchVehicleHistory()` was hardcoded to call `/api/maintenance/history/{vehicleId}`, which queries the **vehicles** table, not the **plant** table. This caused 404 errors when plant UUIDs were passed to the vehicle history endpoint.

### Root Cause

```typescript
// PlantOverview.tsx (BEFORE FIX)
return {
  vehicle_id: plant.id,  // Plant UUID in vehicle_id field
  plant_id: plant.id,
  vehicle: { ...plant },
  // ... no way to distinguish this is plant, not vehicle
};

// MaintenanceOverview.tsx (BEFORE FIX)
const fetchVehicleHistory = async (vehicleId: string) => {
  // Always calls vehicle endpoint, even for plant UUIDs
  const response = await fetch(`/api/maintenance/history/${vehicleId}`);
  // ❌ 404 error when vehicleId is actually a plant UUID
};
```

## Solution

Added an `is_plant` flag to distinguish plant assets from vehicles, and updated `MaintenanceOverview` to route API requests to the correct endpoint based on this flag.

### Changes Made

#### 1. PlantOverview.tsx
```typescript
type PlantMaintenanceWithStatus = {
  vehicle_id: string;
  plant_id: string;
  is_plant?: boolean; // NEW: Flag to indicate plant machinery
  // ...
};

// In data transformation
return {
  vehicle_id: plant.id,
  plant_id: plant.id,
  is_plant: true, // NEW: Set flag for plant assets
  vehicle: { ...plant },
  // ...
};
```

#### 2. MaintenanceOverview.tsx

**Updated History Fetching Function:**
```typescript
const fetchVehicleHistory = useCallback(
  async (vehicleId: string, isPlant: boolean = false, force: boolean = false) => {
    // Route to correct endpoint based on asset type
    const endpoint = isPlant 
      ? `/api/maintenance/history/plant/${vehicleId}`  // ✅ Plant endpoint
      : `/api/maintenance/history/${vehicleId}`;       // ✅ Vehicle endpoint
    
    const response = await fetch(endpoint);
    // Now routes correctly!
  }, 
  [vehicleHistory]
);
```

**Added Helper Function:**
```typescript
// Helper to determine if a vehicle ID corresponds to a plant asset
const isPlantAsset = useCallback((vehicleId: string) => {
  const vehicle = vehicles.find(v => (v.vehicle_id || v.id) === vehicleId);
  return vehicle && 'is_plant' in vehicle && vehicle.is_plant === true;
}, [vehicles]);
```

**Updated All Calls:**
- Auto-fetch on mount: Checks `is_plant` flag inline
- Task action handlers: Use `isPlantAsset()` helper
- Toggle expansion: Use `isPlantAsset()` helper

## Verification

### Test Coverage
Created `tests/unit/plant-overview-history-fix.test.ts` with:
- ✅ Verifies `is_plant` flag is set in plant objects
- ✅ Validates correct endpoint routing for plant assets
- ✅ Validates correct endpoint routing for vehicles
- ✅ Tests `isPlantAsset` identification logic

### Test Results
```bash
✓ tests/unit/plant-overview-history-fix.test.ts (4 tests) 5ms
```

## API Endpoints

### Plant History Endpoint
**Path:** `/api/maintenance/history/plant/[plantId]`  
**Returns:**
- Plant maintenance history records
- Workshop tasks linked to plant
- Plant asset details
- Maintenance data (current_hours, service_hours)

### Vehicle History Endpoint  
**Path:** `/api/maintenance/history/[vehicleId]`  
**Returns:**
- Vehicle maintenance history records
- Workshop tasks linked to vehicle
- Vehicle details
- Maintenance data (mileage, service dates)

## Impact

### Before Fix
- ❌ 404 errors when viewing plant maintenance alerts
- ❌ History data not loading for plant assets with LOLER alerts
- ❌ Workshop tasks not visible for plant assets

### After Fix
- ✅ Plant assets route to correct API endpoint
- ✅ History data loads successfully for plant assets
- ✅ Workshop tasks display correctly
- ✅ No breaking changes for vehicle assets

## Related Files

**Components:**
- `app/(dashboard)/maintenance/components/PlantOverview.tsx`
- `app/(dashboard)/maintenance/components/MaintenanceOverview.tsx`

**API Routes:**
- `app/api/maintenance/history/[vehicleId]/route.ts` (vehicles)
- `app/api/maintenance/history/plant/[plantId]/route.ts` (plant)

**Tests:**
- `tests/unit/plant-overview-history-fix.test.ts`

## Prevention

To prevent similar issues in the future:

1. **Type Safety:** The `is_plant` flag is now part of the type definition
2. **Test Coverage:** Unit tests verify correct routing behavior
3. **Documentation:** This document explains the routing logic
4. **Helper Function:** `isPlantAsset()` provides a single source of truth

## Notes

- The fix is backward compatible - vehicles without `is_plant` flag default to vehicle endpoint
- No database changes required
- No impact on existing vehicle maintenance functionality
- Plant assets now have full feature parity with vehicles for maintenance tracking
