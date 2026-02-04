# Bug Fix: Fleet Page Category Counting Using ID Instead of Name

**Date:** 2026-02-04  
**Issue:** Fragile name-based comparison for counting assets per category  
**Status:** ✅ Fixed

## Problem Description

The Fleet page was counting plant assets and vehicles per category by comparing category **names** instead of **IDs**:

```typescript
// BEFORE (fragile name-based comparison)
{plantAssets.filter(p => p.vehicle_categories?.name === category.name).length}
{vehicles.filter(v => v.vehicle_categories?.name === category.name).length}
```

### Why This Was Problematic

1. **Case Sensitivity:** "Excavators" vs "excavators" would not match
2. **Whitespace Issues:** "All plant" vs "All  plant" (double space) would not match
3. **Category Renames:** If a category name changes, counts break even though the foreign key relationship is intact
4. **Not Leveraging Database Design:** The `category_id` foreign key exists specifically for this purpose
5. **Data Integrity Risk:** Name comparisons are error-prone and don't enforce referential integrity

### Example Failure Scenario

```typescript
// Category in state
const category = { id: 'uuid-123', name: 'Excavators (Heavy Duty)' };

// Plant asset from database
const plant = { 
  category_id: 'uuid-123',
  vehicle_categories: { id: 'uuid-123', name: 'Excavators' }
};

// Name comparison FAILS (even though IDs match)
plant.vehicle_categories?.name === category.name  // false ❌
```

## Solution

Changed to **ID-based comparison**, which directly uses the foreign key relationship:

```typescript
// AFTER (robust ID-based comparison)
{plantAssets.filter(p => p.category_id === category.id).length}
{vehicles.filter(v => v.category_id === category.id).length}
```

### Benefits

1. **Resilient to Name Changes:** Category names can be updated without breaking counts
2. **Case Insensitive:** UUIDs don't have case sensitivity issues
3. **Database-Aligned:** Uses the same foreign key (`category_id`) that enforces referential integrity
4. **Type Safe:** Comparing UUIDs is more reliable than string matching
5. **Performance:** Direct field comparison is faster than nested object access

## Changes Made

### app/(dashboard)/fleet/page.tsx

**Line 608 (Plant Assets Count):**
```diff
- {plantAssets.filter(p => p.vehicle_categories?.name === category.name).length}
+ {plantAssets.filter(p => p.category_id === category.id).length}
```

**Line 727 (Vehicles Count):**
```diff
- {vehicles.filter(v => v.vehicle_categories?.name === category.name).length}
+ {vehicles.filter(v => v.category_id === category.id).length}
```

## Data Structure

Both plant assets and vehicles have `category_id` directly available:

### Plant Assets
```typescript
const plant = {
  id: string,
  plant_id: string,
  category_id: string, // ✅ Use this for comparison
  vehicle_categories: {
    id: string,
    name: string
  }
}
```

### Vehicles
```typescript
const vehicle = {
  id: string,
  reg_number: string,
  category_id: string, // ✅ Use this for comparison
  vehicle_categories: {
    id: string,
    name: string
  }
}
```

## Verification

### Test Coverage
Created `tests/unit/fleet-page-category-counting-fix.test.ts` with:
- ✅ Verifies ID-based counting for plant assets
- ✅ Verifies ID-based counting for vehicles
- ✅ Tests resilience to category name changes
- ✅ Tests case-sensitivity handling
- ✅ Tests null/undefined category handling

### Test Results
```bash
✓ tests/unit/fleet-page-category-counting-fix.test.ts (5 tests) 12ms
```

## Impact

### Before Fix
- ❌ Category counts could break if names change
- ❌ Case sensitivity issues
- ❌ Whitespace sensitivity issues
- ❌ Not using database foreign key relationship

### After Fix
- ✅ Category counts based on stable UUID relationship
- ✅ Resilient to name changes
- ✅ No case/whitespace issues
- ✅ Uses proper foreign key relationship
- ✅ Aligns with database design

## Migration Notes

- No database changes required
- No breaking changes for users
- Existing data works correctly with new logic
- This is a pure code improvement with no functional changes to user-visible behavior

## Related Files

**Components:**
- `app/(dashboard)/fleet/page.tsx` (lines 608, 727)

**Tests:**
- `tests/unit/fleet-page-category-counting-fix.test.ts`

## Prevention

To prevent similar issues:
1. **Always use ID comparisons** for foreign key relationships
2. **Avoid string matching** when database relationships exist
3. **Code review checklist:** Flag any `.name === otherName` comparisons in filter operations
4. **Prefer direct fields** over nested object access when available

## Technical Note

The `vehicle_categories` nested object is still loaded for **display purposes** (showing category names in the UI), but the **filtering logic** now correctly uses the direct `category_id` field which is the actual foreign key in the database.
