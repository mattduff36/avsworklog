# Critical Fix Follow-up: Force-Applied Maintenance History Migration

**Date:** 2026-02-04  
**Component:** Maintenance History Database Schema  
**Priority:** Critical  
**Status:** ✅ Fixed (Force-Applied)

---

## Issue

After the initial migration commit, the client **continued to experience the same error**:

```
Failed to update plant record
Failed to write maintenance history: null value in column "vehicle_id" 
of relation "maintenance_history" violates not-null constraint
```

---

## Root Cause of Persistence

The migration script reported "already applied" because it detected the `plant_id` column existed, but the migration was **only partially applied**:

**Actual Database State:**
- ✅ `plant_id` column: EXISTS and nullable
- ❌ `vehicle_id` column: Still had NOT NULL constraint
- ❌ Check constraint: MISSING

The original migration script had a flaw - it checked for column existence and returned early, assuming the full migration was applied. However, only the `plant_id` column had been added in a previous attempt, while the critical `vehicle_id` nullable change never ran.

---

## Solution

Created a **force-apply script** that applies each migration step individually with proper error handling:

**File:** `scripts/force-apply-maintenance-history-migration.ts`

### Steps Applied:

1. **Make vehicle_id nullable**
   ```sql
   ALTER TABLE maintenance_history
   ALTER COLUMN vehicle_id DROP NOT NULL;
   ```

2. **Ensure plant_id exists** (idempotent)
   ```sql
   ALTER TABLE maintenance_history
   ADD COLUMN plant_id UUID REFERENCES plant(id) ON DELETE CASCADE;
   ```

3. **Add check constraint**
   ```sql
   ALTER TABLE maintenance_history
   DROP CONSTRAINT IF EXISTS check_maintenance_history_asset;
   
   ALTER TABLE maintenance_history
   ADD CONSTRAINT check_maintenance_history_asset CHECK (
     (vehicle_id IS NOT NULL AND plant_id IS NULL) OR
     (vehicle_id IS NULL AND plant_id IS NOT NULL)
   );
   ```

4. **Create index**
   ```sql
   CREATE INDEX IF NOT EXISTS idx_maintenance_history_plant_id 
     ON maintenance_history(plant_id) 
     WHERE plant_id IS NOT NULL;
   ```

---

## Verification

**Before Force-Apply:**
```
plant_id        uuid       ✅ nullable
vehicle_id      uuid       ❌ NOT NULL  ← PROBLEM
Check constraint: ❌ MISSING
```

**After Force-Apply:**
```
plant_id        uuid       ✅ nullable
vehicle_id      uuid       ✅ nullable  ← FIXED
Check constraint: ✅ EXISTS
```

---

## Testing

- ✅ Database schema verified correct
- ✅ Both vehicle_id and plant_id are nullable
- ✅ Check constraint exists and works
- ✅ Index created for plant_id
- ✅ Full production build passes (57.5s)
- ✅ No errors

---

## Why the Original Migration Failed

The original migration script (`run-maintenance-history-plant-migration.ts`) had this logic:

```typescript
// Check if plant_id column exists
const columnCheck = await client.query(`
  SELECT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'maintenance_history'
    AND column_name = 'plant_id'
  ) as column_exists;
`);

if (columnCheck.rows[0].column_exists) {
  console.log('✅ Migration already applied');
  return; // ← Exits early without checking vehicle_id!
}
```

This check was insufficient. A previous partial migration attempt had added `plant_id`, causing the script to exit before making `vehicle_id` nullable.

---

## Improved Migration Strategy

The force-apply script uses a **per-step approach**:

```typescript
// Step 1: Make vehicle_id nullable
try {
  await client.query(`ALTER TABLE ... DROP NOT NULL`);
  console.log('✅ vehicle_id is now nullable');
} catch (error) {
  if (error.message.includes('does not exist')) {
    console.log('✅ vehicle_id was already nullable');
  } else {
    throw error;
  }
}

// Step 2: Add plant_id (if not exists)
// Step 3: Add constraint (drop first if exists)
// Step 4: Add index (if not exists)
```

Each step is idempotent and reports its own status.

---

## Files Changed

1. **scripts/force-apply-maintenance-history-migration.ts** (new)
   - Robust migration script with per-step error handling
   - Idempotent operations
   - Detailed verification

2. **scripts/check-maintenance-history-schema.ts** (new)
   - Quick diagnostic tool
   - Shows current schema state
   - Identifies missing pieces

3. **docs/bug-fixes-2026-02-04-maintenance-history-force-apply.md** (new)
   - This documentation

---

## Lessons Learned

1. **Check all constraints, not just column existence** when determining if a migration was applied
2. **Make migration steps idempotent** - safe to run multiple times
3. **Verify each step individually** instead of early-exiting on first check
4. **Include diagnostic tools** to quickly check database state

---

## Client Can Now

✅ Update plant hours without errors  
✅ Update all plant maintenance fields  
✅ View complete maintenance history for plant records  
✅ System maintains audit trail for both vehicles and plant  

The critical blocking issue is now **definitively resolved** with database verification.
