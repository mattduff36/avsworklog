# Bug Fixes: Plant Table History Routing, AddVehicleDialog Props, and Category Filtering

**Date:** 2026-02-04  
**Issues:** Plant history routing with wrong ID type, missing assetType prop, incorrect category filtering  
**Status:** ✅ Fixed

## Problems Fixed

### Bug 1: Plant History Routing with Human-Readable ID Instead of UUID ❌→✅

**Location:** `PlantTable.tsx:413, 605`

**Problem:**
PlantTable called `handleViewHistory(asset.plant_id)`, passing the human-readable identifier (e.g., "P001") instead of the database UUID. The history page route expects the UUID to query the plant table with `.eq('id', plantId)`.

**Code Before:**
```typescript
// Line 413
onClick={() => handleViewHistory(asset.plant_id)} // ❌ Passes "P001"

// Line 605
handleViewHistory(asset.plant_id); // ❌ Passes "P001"

// History page expects UUID
.eq('id', unwrappedParams.plantId) // Expects UUID, gets "P001"
```

**Impact:**
- ❌ 404 errors when clicking plant records
- ❌ History page fails to load plant data
- ❌ Query returns no results (no plant with id="P001")

**Fix:**
```typescript
// AFTER (correct)
onClick={() => handleViewHistory(asset.plant?.id || '')} // ✅ Passes UUID

handleViewHistory(asset.plant?.id || ''); // ✅ Passes UUID
```

**Data Structure:**
```typescript
const asset = {
  plant_id: 'P001',              // Human-readable (for display)
  plant: {
    id: 'uuid-12345-67890',      // ✅ UUID (for routing)
    plant_id: 'P001',             // Human-readable
    nickname: 'Excavator 1',
  },
};

// Route construction
const route = `/fleet/plant/${asset.plant.id}/history`;
// → /fleet/plant/uuid-12345-67890/history ✅
```

---

### Bug 2: AddVehicleDialog Missing assetType Prop ❌→✅

**Location:** `PlantTable.tsx:636-643`, `AddVehicleDialog.tsx:414-415`

**Problem:**
AddVehicleDialog requires an `assetType` prop to filter categories correctly (line 414-415), but PlantTable wasn't passing this prop. Without it, the category dropdown filtered based on `undefined`, resulting in an empty or incorrect category list.

**Code Before:**
```typescript
// PlantTable.tsx
<AddVehicleDialog
  open={addVehicleDialogOpen}
  onOpenChange={setAddVehicleDialogOpen}
  // ❌ Missing assetType prop
  onSuccess={() => {
    fetchPlantData();
  }}
/>

// AddVehicleDialog.tsx - Filter logic
const appliesTo = (category as any).applies_to || ['vehicle'];
return appliesTo.includes(assetType); // assetType is undefined!
```

**Impact:**
- ❌ Category dropdown shows wrong categories
- ❌ Could show empty category list
- ❌ Prevents users from adding plant assets
- ❌ Users might accidentally select vehicle categories for plant

**Fix:**

**1. PlantTable.tsx:**
```typescript
<AddVehicleDialog
  open={addVehicleDialogOpen}
  onOpenChange={setAddVehicleDialogOpen}
  assetType="plant" // ✅ Now provided
  onSuccess={() => {
    fetchPlantData();
  }}
/>
```

**2. AddVehicleDialog.tsx - Updated interface and props:**
```typescript
interface AddVehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  assetType?: AssetType; // ✅ Added prop
}

export function AddVehicleDialog({
  open,
  onOpenChange,
  onSuccess,
  assetType: initialAssetType = 'vehicle', // ✅ Default to 'vehicle'
}: AddVehicleDialogProps) {
  const [assetType, setAssetType] = useState<AssetType>(initialAssetType); // ✅ Use prop
```

**Benefits:**
- ✅ Category dropdown shows only plant-applicable categories
- ✅ Prevents incorrect category selection
- ✅ Works for both vehicle and plant dialogs
- ✅ Backward compatible (defaults to 'vehicle')

---

### Bug 3: Fleet Page Category Filtering Using Incorrect Logic ❌→✅

**Location:** `fleet/page.tsx:699-701`

**Problem:**
Vehicle categories section filtered by checking which plants use categories, then excluding those categories. This was incorrect because categories can apply to **both** vehicles and plants (`applies_to: ['vehicle', 'plant']`). Such shared categories would be incorrectly hidden from the vehicle section if any plant used them.

**Code Before:**
```typescript
// BEFORE (incorrect)
// Dynamically exclude categories used by plant assets
const plantCategoryIds = new Set(plantAssets.map(p => p.category_id).filter(Boolean));
const vehicleCategories = categories.filter(c => !plantCategoryIds.has(c.id));
// ❌ Hides shared categories if plant uses them
```

**Example of Bug:**
```typescript
const categories = [
  { id: '1', name: 'Car', applies_to: ['vehicle'] },
  { id: '2', name: 'Road Sweeper', applies_to: ['vehicle', 'plant'] }, // Shared
];

const plantAssets = [
  { category_id: '2' }, // Plant uses "Road Sweeper"
];

// Incorrect logic excludes "Road Sweeper" from vehicle section
// ❌ Users can't see vehicles in "Road Sweeper" category
```

**Impact:**
- ❌ Shared categories hidden from vehicle section
- ❌ Incorrect category counts
- ❌ Users can't view vehicles in shared categories
- ❌ Violates data model (categories can apply to multiple asset types)

**Fix:**
```typescript
// AFTER (correct)
// Filter categories that apply to vehicles (not plant-only categories)
const vehicleCategories = categories.filter(c => {
  const appliesTo = (c as any).applies_to || ['vehicle'];
  return appliesTo.includes('vehicle'); // ✅ Check applies_to field
});
```

**Benefits:**
- ✅ Shared categories appear in both vehicle and plant sections
- ✅ Respects `applies_to` field from database
- ✅ Correct category separation
- ✅ Accurate category counts

---

## Changes Made

### 1. PlantTable.tsx
- **Line 413**: Changed `handleViewHistory(asset.plant_id)` → `handleViewHistory(asset.plant?.id || '')`
- **Line 605**: Changed `handleViewHistory(asset.plant_id)` → `handleViewHistory(asset.plant?.id || '')`
- **Line 638**: Added `assetType="plant"` prop to AddVehicleDialog

### 2. AddVehicleDialog.tsx
- **Interface**: Added `assetType?: AssetType` prop
- **Props**: Added `assetType: initialAssetType = 'vehicle'` with default
- **State**: Changed initialization to use `initialAssetType`

### 3. fleet/page.tsx
- **Line 699-701**: Replaced plant usage check with `applies_to` field check

---

## Data Flow Examples

### Bug 1 Fix: History Routing

**Before:**
```
PlantTable → handleViewHistory("P001") → Route: /fleet/plant/P001/history
                                         → History page: .eq('id', 'P001')
                                         → ❌ No results (no plant with id="P001")
```

**After:**
```
PlantTable → handleViewHistory("uuid-123") → Route: /fleet/plant/uuid-123/history
                                            → History page: .eq('id', 'uuid-123')
                                            → ✅ Finds plant record
```

### Bug 2 Fix: Category Filtering

**Before:**
```
PlantTable → AddVehicleDialog (no assetType) → assetType = undefined
                                              → Filter: undefined.includes('plant')
                                              → ❌ No categories shown
```

**After:**
```
PlantTable → AddVehicleDialog (assetType="plant") → assetType = 'plant'
                                                   → Filter: ['plant'].includes('plant')
                                                   → ✅ Shows plant categories
```

### Bug 3 Fix: Category Section Logic

**Before:**
```
Plant uses category ID '2'
→ Exclude category '2' from vehicle section
→ ❌ "Road Sweeper" (shared) hidden from vehicles
```

**After:**
```
Category '2' has applies_to: ['vehicle', 'plant']
→ Check if 'vehicle' in applies_to
→ ✅ "Road Sweeper" shown in vehicle section
```

---

## Verification

### Test Coverage
Created `tests/unit/plant-table-fleet-page-fixes.test.ts` with:
- ✅ UUID routing instead of human-readable ID
- ✅ Graceful handling of missing plant object
- ✅ History page query compatibility
- ✅ AddVehicleDialog assetType prop acceptance
- ✅ Category filtering based on assetType
- ✅ Fleet page applies_to field filtering
- ✅ Shared categories appearing in both sections
- ✅ Integration tests for complete workflows

### Test Results
```bash
✓ tests/unit/plant-table-fleet-page-fixes.test.ts (15 tests) 13ms
```

---

## Impact

### Before Fixes

**Bug 1:**
- ❌ Clicking plant records in PlantTable resulted in 404 errors
- ❌ History page couldn't load plant data

**Bug 2:**
- ❌ Adding plant assets showed wrong/empty category list
- ❌ Users blocked from creating plant records

**Bug 3:**
- ❌ Shared categories hidden from vehicle section
- ❌ Incorrect data model implementation

### After Fixes

**Bug 1:**
- ✅ Plant history loads correctly with UUID routing
- ✅ Click-through works from PlantTable to history page
- ✅ Graceful handling of missing data

**Bug 2:**
- ✅ Plant dialog shows only plant-applicable categories
- ✅ Vehicle dialog shows only vehicle-applicable categories
- ✅ Backward compatible with existing code

**Bug 3:**
- ✅ Categories correctly separated by `applies_to` field
- ✅ Shared categories appear in both sections
- ✅ Accurate category counts and filtering

---

## Type Safety

### Plant Asset Structure
```typescript
type PlantMaintenanceWithStatus = {
  plant_id: string;      // Human-readable: "P001"
  plant: PlantAsset;     // Contains id (UUID) and plant_id (readable)
  current_hours: number | null;
  next_service_hours: number | null;
};

type PlantAsset = {
  id: string;            // UUID for database queries
  plant_id: string;      // Human-readable for display
  nickname: string | null;
  // ... other fields
};
```

### Category Structure
```typescript
type Category = {
  id: string;
  name: string;
  applies_to?: ('vehicle' | 'plant' | 'tool')[]; // Defaults to ['vehicle']
};
```

---

## Prevention

1. **Always use UUID for routing**: Display IDs are for UI, UUIDs for queries
2. **Pass required props**: Ensure dialog components receive all necessary data
3. **Use database fields for logic**: Don't infer from usage patterns, check schema fields
4. **Test data flow**: Verify data passes correctly through component boundaries
5. **Document field purposes**: Comment whether fields are for display or queries

---

## Related Files

**Components:**
- `app/(dashboard)/maintenance/components/PlantTable.tsx`
- `app/(dashboard)/maintenance/components/AddVehicleDialog.tsx`
- `app/(dashboard)/fleet/page.tsx`

**Pages:**
- `app/(dashboard)/fleet/plant/[plantId]/history/page.tsx`

**Tests:**
- `tests/unit/plant-table-fleet-page-fixes.test.ts`

---

## Example: Correct Usage

### Routing with UUID
```typescript
// ✅ CORRECT
const handleViewHistory = (plantId: string) => {
  router.push(`/fleet/plant/${plantId}/history`);
};

// Call with UUID
handleViewHistory(asset.plant?.id || ''); // UUID

// History page queries with UUID
.eq('id', unwrappedParams.plantId) // Matches!
```

### Category Filtering
```typescript
// ✅ CORRECT: Filter by applies_to
const vehicleCategories = categories.filter(c => {
  const appliesTo = c.applies_to || ['vehicle'];
  return appliesTo.includes('vehicle');
});

const plantCategories = categories.filter(c => {
  const appliesTo = c.applies_to || ['vehicle'];
  return appliesTo.includes('plant');
});
```

### Dialog Props
```typescript
// ✅ CORRECT: Pass assetType
<AddVehicleDialog
  open={open}
  onOpenChange={setOpen}
  assetType="plant"  // Explicitly set
  onSuccess={handleSuccess}
/>
```
