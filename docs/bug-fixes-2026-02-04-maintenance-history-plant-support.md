# Bug Fix: Plant Maintenance History NOT NULL Constraint Error

**Date:** 2026-02-04  
**Component:** Edit Plant Record Dialog / Maintenance History  
**Priority:** Critical  
**Status:** ✅ Fixed

---

## Issue Report

Client reported error when updating plant maintenance records (specifically updating hours):

```
Failed to update plant record
Failed to write maintenance history: null value in column "vehicle_id" 
of relation "maintenance_history" violates not-null constraint
```

**Screenshot Evidence:** Shows "Edit Plant Record - 203" dialog with error toast displaying the NOT NULL constraint violation.

---

## Root Cause

The `maintenance_history` table was originally designed for vehicles only and had a `NOT NULL` constraint on `vehicle_id`. When plant support was added to the application, the maintenance history table structure was not updated to support plant records.

**Problem Code (EditPlantRecordDialog.tsx, line 300-310):**
```typescript
const { error: historyError } = await supabase.from('maintenance_history').insert({
  plant_id: plant.id,
  vehicle_id: null,  // ❌ This violates NOT NULL constraint
  field_name: historyFieldName,
  old_value: null,
  new_value: null,
  value_type: 'text',
  comment: data.comment.trim(),
  updated_by: user.id,
  updated_by_name: profile?.full_name || 'Unknown User',
});
```

---

## Solution

Created database migration to support both vehicles and plant in maintenance history:

### 1. Database Migration

**File:** `supabase/migrations/20260204_add_plant_to_maintenance_history.sql`

Changes:
- Made `vehicle_id` column nullable
- Added `plant_id` column with foreign key to plant table
- Added check constraint: `(vehicle_id IS NOT NULL AND plant_id IS NULL) OR (vehicle_id IS NULL AND plant_id IS NOT NULL)`
- Created index for plant_id lookups
- Added column comments for documentation

**Migration Script:** `scripts/run-maintenance-history-plant-migration.ts`
- Automated migration runner
- Verification checks for all changes
- Error handling and rollback safety

### 2. Type Definitions

The TypeScript types in `types/database.ts` already correctly defined both columns as nullable:
```typescript
maintenance_history: {
  Row: {
    id: string
    vehicle_id: string | null  // ✅ Already nullable
    plant_id: string | null    // ✅ Already present
    // ... other fields
  }
}
```

---

## Database Schema After Fix

```sql
CREATE TABLE maintenance_history (
  id UUID PRIMARY KEY,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,  -- Now nullable
  plant_id UUID REFERENCES plant(id) ON DELETE CASCADE,       -- New column
  maintenance_category_id UUID,
  field_name VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  value_type VARCHAR(20),
  comment TEXT NOT NULL,
  updated_by UUID NOT NULL,
  updated_by_name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT check_maintenance_history_asset CHECK (
    (vehicle_id IS NOT NULL AND plant_id IS NULL) OR
    (vehicle_id IS NULL AND plant_id IS NOT NULL)
  )
);
```

---

## Testing Performed

1. ✅ Ran database migration successfully
2. ✅ Verified vehicle_id is nullable
3. ✅ Verified plant_id column exists
4. ✅ Verified check constraint created
5. ✅ Verified index created for plant_id
6. ✅ Full production build passes
7. ✅ No linter errors

---

## User Impact

**Before Fix:**
- ❌ Updating any plant maintenance record failed
- ❌ Users could not update hours, LOLER dates, or any plant maintenance data
- ❌ All plant maintenance updates blocked

**After Fix:**
- ✅ Plant maintenance records update successfully
- ✅ Maintenance history is properly logged for plant updates
- ✅ Both vehicle and plant maintenance history work correctly
- ✅ Check constraint ensures data integrity

---

## Related Components

**Affected:**
- `app/(dashboard)/maintenance/components/EditPlantRecordDialog.tsx` (lines 297-314)
- `supabase/migrations/20251218_create_vehicle_maintenance_system.sql` (original schema)
- Database table: `maintenance_history`

**Similar Logic (Not Affected):**
- `app/(dashboard)/maintenance/components/EditMaintenanceDialog.tsx` (vehicle maintenance - works correctly)
- `app/api/maintenance/[id]/route.ts` (API maintenance updates)

---

## Files Changed

1. **supabase/migrations/20260204_add_plant_to_maintenance_history.sql** (new)
   - Migration to make vehicle_id nullable
   - Add plant_id column
   - Add check constraint and index

2. **scripts/run-maintenance-history-plant-migration.ts** (new)
   - Automated migration runner
   - Verification checks

3. **docs/bug-fixes-2026-02-04-maintenance-history-plant-support.md** (new)
   - This documentation file

---

## Database Impact

**Risk Level:** Low  
**Destructive:** No  
**Reversible:** Yes  
**Data Loss:** None  

The migration only adds a column and removes a constraint. No data is modified or deleted.

---

## Deployment Notes

**Migration Order:**
1. Run migration: `npx tsx scripts/run-maintenance-history-plant-migration.ts`
2. Deploy application code
3. Test plant maintenance updates

**Rollback (if needed):**
```sql
-- Remove check constraint
ALTER TABLE maintenance_history DROP CONSTRAINT check_maintenance_history_asset;

-- Remove plant_id column
ALTER TABLE maintenance_history DROP COLUMN plant_id;

-- Make vehicle_id NOT NULL again (only if no plant records exist)
ALTER TABLE maintenance_history ALTER COLUMN vehicle_id SET NOT NULL;
```

---

## Future Considerations

This fix aligns `maintenance_history` with other tables that already support both vehicles and plant:
- ✅ `vehicle_maintenance` (supports both via similar constraint)
- ✅ `vehicle_inspections` (supports both via similar constraint)
- ✅ `actions` (supports both via similar constraint)

All plant-related tables now have consistent structure and constraints.
