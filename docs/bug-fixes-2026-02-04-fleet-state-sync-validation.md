# Bug Fixes: Plant Asset State Synchronization and Category Validation

**Date:** 2026-02-04  
**Issues:** Plant asset count desynchronization and empty applies_to validation  
**Status:** ✅ Fixed

## Problems Fixed

### Bug 1: Plant Asset State Desynchronization ❌→✅

**Location:** `fleet/page.tsx:489`, `PlantTable.tsx:101-157`

**Problem:**
The fleet page maintained a separate `plantAssets` state for displaying category counts, while PlantTable independently fetched its own `activePlantAssets` state directly from Supabase. These two data sources didn't sync, causing category counts to become stale when plant assets were added through PlantTable.

**Data Flow (BEFORE):**
```
Fleet Page:
  └─ plantAssets state (for counts) ← Fetched once on mount

PlantTable (inside settings tab):
  └─ activePlantAssets state (for display) ← Fetched independently
  └─ AddVehicleDialog adds new plant
  └─ Calls fetchPlantData() (updates activePlantAssets only)
  └─ ❌ plantAssets in Fleet Page stays stale
  └─ ❌ Category counts don't update until tab closed/reopened
```

**Code Before:**
```typescript
// fleet/page.tsx:489
<PlantTable 
  searchQuery={searchQuery}
  onSearchChange={setSearchQuery}
  onVehicleAdded={() => {}} // ❌ Empty callback, no sync
/>

// Category counts based on stale plantAssets
const plantCount = plantAssets.filter(p => p.category_id === category.id).length;
// ❌ Won't reflect newly added plants
```

**Impact:**
- ❌ Category counts show wrong numbers after adding plants
- ❌ User must close and reopen settings tab to see correct counts
- ❌ Confusing UX - counts don't match reality
- ❌ Data inconsistency between UI components

**Fix:**
```typescript
// fleet/page.tsx:489
<PlantTable 
  searchQuery={searchQuery}
  onSearchChange={setSearchQuery}
  onVehicleAdded={fetchPlantAssets} // ✅ Sync callback
/>
```

**Data Flow (AFTER):**
```
Fleet Page:
  └─ plantAssets state (for counts)
  └─ fetchPlantAssets() function

PlantTable:
  └─ activePlantAssets state (for display)
  └─ AddVehicleDialog adds new plant
  └─ Calls fetchPlantData() (updates activePlantAssets)
  └─ Calls onVehicleAdded() callback
  └─ ✅ Triggers fetchPlantAssets() in Fleet Page
  └─ ✅ plantAssets updates
  └─ ✅ Category counts refresh automatically
```

**Benefits:**
- ✅ Category counts update immediately after adding plants
- ✅ No need to close/reopen settings tab
- ✅ Consistent data across all UI components
- ✅ Better UX with real-time updates

---

### Bug 2: Empty applies_to Array Validation ❌→✅

**Location:** `CategoryDialog.tsx:55`

**Problem:**
The Zod schema for `applies_to` allowed an empty array without validation. Users could uncheck both checkboxes to set `applies_to: []`, which passed validation and created a category that applies to no asset types.

**Code Before:**
```typescript
// CategoryDialog.tsx:55
applies_to: z.array(z.enum(['vehicle', 'plant'])).default(['vehicle']),
// ❌ No minimum length validation
```

**Impact:**
- ❌ Categories with `applies_to: []` can be created
- ❌ Breaks filtering logic throughout codebase
- ❌ Categories never display in any section
- ❌ Filter checks like `appliesTo.includes('vehicle')` always return false

**Example of Bug:**
```typescript
// User unchecks both checkboxes
const category = {
  name: 'Broken Category',
  applies_to: [], // ❌ Invalid but passes validation
};

// Filtering breaks
const vehicleCategories = categories.filter(c => {
  const appliesTo = c.applies_to || ['vehicle'];
  return appliesTo.includes('vehicle'); // false for []
});
// ❌ Category never appears anywhere
```

**Fix:**
```typescript
// CategoryDialog.tsx:55-57
applies_to: z.array(z.enum(['vehicle', 'plant']))
  .min(1, 'Category must apply to at least one asset type')
  .default(['vehicle']),
```

**Validation Behavior:**

| Input | Valid? | Result |
|-------|--------|--------|
| `[]` | ❌ No | Error: "Category must apply to at least one asset type" |
| `['vehicle']` | ✅ Yes | Vehicle-only category |
| `['plant']` | ✅ Yes | Plant-only category |
| `['vehicle', 'plant']` | ✅ Yes | Shared category |
| `undefined` | ✅ Yes | Defaults to `['vehicle']` |

**Benefits:**
- ✅ Prevents categories with no asset types
- ✅ Maintains filtering logic integrity
- ✅ Clear error message for users
- ✅ Enforces data model constraints

---

## Changes Made

### 1. fleet/page.tsx
- **Line 489**: Changed `onVehicleAdded={() => {}}` → `onVehicleAdded={fetchPlantAssets}`
- Connects PlantTable's add callback to Fleet Page's fetch function

### 2. CategoryDialog.tsx
- **Lines 55-57**: Added `.min(1, 'Category must apply to at least one asset type')` validation
- Prevents empty `applies_to` arrays

---

## Technical Details

### Bug 1: State Synchronization Pattern

**Problem Pattern: Duplicate State**
```typescript
// Component A (Fleet Page)
const [plantAssets, setPlantAssets] = useState([]);

// Component B (PlantTable - child of A)
const [activePlantAssets, setActivePlantAssets] = useState([]);

// ❌ Two independent states for same data
```

**Solution Pattern: Callback Synchronization**
```typescript
// Parent provides sync callback
<ChildComponent onDataChange={refreshParentData} />

// Child calls callback after mutations
const addData = async () => {
  await saveToDatabase();
  await fetchOwnData(); // Update child state
  onDataChange?.(); // Sync parent state
};
```

### Bug 2: Zod Validation Chain

**Before:**
```typescript
z.array(T).default(defaultValue)
// ✅ Validates array type
// ✅ Provides default
// ❌ No length validation
```

**After:**
```typescript
z.array(T)
  .min(1, 'Error message')  // ✅ Length validation
  .default(defaultValue)     // ✅ Default value
// ✅ Validates type, length, and provides default
```

---

## User Experience Impact

### Bug 1: Before vs After

**Before (Stale Counts):**
```
1. User opens Settings tab
2. Sees: "Excavator (2 plants)"
3. Clicks "Add Plant" button
4. Adds new excavator
5. Still sees: "Excavator (2 plants)" ❌
6. Must close and reopen tab
7. Now sees: "Excavator (3 plants)" ✅
```

**After (Live Updates):**
```
1. User opens Settings tab
2. Sees: "Excavator (2 plants)"
3. Clicks "Add Plant" button
4. Adds new excavator
5. Immediately sees: "Excavator (3 plants)" ✅
```

### Bug 2: Before vs After

**Before (No Validation):**
```
1. User creates "Test Category"
2. Unchecks "Vehicle" checkbox
3. Unchecks "Plant" checkbox
4. Clicks "Save"
5. Category saved with applies_to: [] ❌
6. Category never appears in any list
7. User confused about missing category
```

**After (With Validation):**
```
1. User creates "Test Category"
2. Unchecks "Vehicle" checkbox
3. Unchecks "Plant" checkbox
4. Clicks "Save"
5. Error: "Category must apply to at least one asset type" ✅
6. User must check at least one box
7. Category appears in appropriate list(s)
```

---

## Verification

### Test Coverage
Created `tests/unit/fleet-plant-state-sync-and-validation-fixes.test.ts` with:
- ✅ Plant asset state synchronization
- ✅ Callback function passing
- ✅ Category count updates
- ✅ Stale count prevention
- ✅ Empty applies_to rejection
- ✅ Valid applies_to acceptance (single and multiple)
- ✅ Default value behavior
- ✅ Error message verification
- ✅ Integration scenarios

### Test Results
```bash
✓ tests/unit/fleet-plant-state-sync-and-validation-fixes.test.ts (14 tests) 27ms
```

---

## Code Examples

### Example 1: Synchronized State

```typescript
// Parent component
const ParentPage = () => {
  const [data, setData] = useState([]);
  
  const fetchData = async () => {
    const result = await fetch('/api/data');
    setData(result);
  };
  
  return (
    <ChildTable onDataChange={fetchData} />
  );
};

// Child component
const ChildTable = ({ onDataChange }) => {
  const addItem = async () => {
    await createItem();
    await fetchOwnData(); // Update own state
    onDataChange?.(); // ✅ Sync parent state
  };
};
```

### Example 2: Validated Schema

```typescript
const categorySchema = z.object({
  name: z.string().min(1),
  applies_to: z.array(z.enum(['vehicle', 'plant']))
    .min(1, 'Category must apply to at least one asset type')
    .default(['vehicle']),
});

// Valid
categorySchema.parse({
  name: 'Car',
  applies_to: ['vehicle']
}); // ✅ Pass

// Invalid
categorySchema.parse({
  name: 'Broken',
  applies_to: []
}); // ❌ Error: "Category must apply to at least one asset type"
```

---

## Related Files

**Components:**
- `app/(dashboard)/fleet/page.tsx`
- `app/(dashboard)/maintenance/components/PlantTable.tsx`
- `app/(dashboard)/maintenance/components/CategoryDialog.tsx`

**Tests:**
- `tests/unit/fleet-plant-state-sync-and-validation-fixes.test.ts`

---

## Prevention Strategies

### Preventing State Desynchronization

1. **Use Callbacks**: Pass data refresh callbacks to child components
2. **Single Source of Truth**: Avoid duplicate state when possible
3. **State Lifting**: Consider lifting shared state to common ancestor
4. **React Query**: Use for automatic cache invalidation across components

### Preventing Invalid Data

1. **Validate Early**: Add validation at schema level, not just UI
2. **Minimum Constraints**: Use `.min()`, `.max()` for arrays and strings
3. **Clear Error Messages**: Explain what's required, not just what's wrong
4. **Test Edge Cases**: Test empty arrays, null, undefined, etc.

---

## Migration Notes

### For Existing Categories

Existing categories with `applies_to: []` (if any) will need manual correction:

```sql
-- Find categories with empty applies_to
SELECT id, name, applies_to 
FROM vehicle_categories 
WHERE array_length(applies_to, 1) IS NULL OR applies_to = '{}';

-- Fix by defaulting to vehicle
UPDATE vehicle_categories 
SET applies_to = ARRAY['vehicle']::text[]
WHERE array_length(applies_to, 1) IS NULL OR applies_to = '{}';
```

### For Component Integration

When integrating PlantTable or similar components:

```typescript
// ✅ DO: Pass sync callback
<DataTable onDataChange={refetchData} />

// ❌ DON'T: Use empty callback
<DataTable onDataChange={() => {}} />
```

---

## Performance Considerations

### Bug 1 Fix: fetchPlantAssets Callback

**Cost:** Low - Single additional fetch after mutation  
**Benefit:** High - Real-time UI consistency

**Alternative Considered:** React Query with automatic cache invalidation  
**Decision:** Simple callback sufficient for current needs

### Bug 2 Fix: Zod Validation

**Cost:** Negligible - Validation runs in microseconds  
**Benefit:** High - Prevents data integrity issues

---

## Summary

**Bug 1 Impact:**
- ✅ Category counts now update in real-time
- ✅ No need to close/reopen tabs
- ✅ Consistent data across components

**Bug 2 Impact:**
- ✅ No categories with empty applies_to
- ✅ Filtering logic works correctly
- ✅ Clear user feedback on validation

Both fixes improve **data integrity**, **user experience**, and **system reliability** with minimal code changes and no breaking changes.
