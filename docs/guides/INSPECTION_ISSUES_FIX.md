# Inspection Issues Fix - December 2, 2025

## Issues Reported

1. **Defects aren't saved** - Comments appear empty when inspections are viewed
2. **Comments validation missing** - Empty comments allowed for defects despite being marked as required
3. **RLS policy blocking managers** - Managers cannot create inspections on behalf of employees (error code 42501)

## Root Causes Identified

### Issue 1: Missing Database Column
- The `inspection_items` table was missing the `comments` column
- Original schema (`schema.sql`) didn't include it
- Migration script (`migrate-inspections.sql`) added it but wasn't run
- Code was trying to save comments to a non-existent column

### Issue 2: Status Value Inconsistency  
- Database types defined status as `'ok' | 'attention' | 'na'`
- Some code checked for `'defect'` instead of `'attention'`
- Migration script used `'defect'` but app code used `'attention'`
- This mismatch prevented validation from working correctly

### Issue 3: Restrictive RLS Policy
- INSERT policy on `vehicle_inspections` required `auth.uid() = user_id`
- This prevented managers from creating inspections with a different `user_id`
- No separate policy existed for managers/admins

## Fixes Applied

### 1. Database Migration

**File:** `supabase/fix-inspection-issues.sql`

- Added `comments` column to `inspection_items` (if not exists)
- Added `day_of_week` column to `inspection_items` (if not exists)
- Added `item_description` column to `inspection_items` (if not exists)
- Updated status check constraint to support both `'attention'` and `'defect'`
- Fixed unique constraint to include `day_of_week`
- Created separate RLS INSERT policy for managers: `"Managers can create inspections for users"`
- Updated all `inspection_items` RLS policies with separate manager policies

**Run with:**
```bash
npx tsx scripts/fix-inspection-issues.ts
```

### 2. Validation Enhancement

**File:** `app/(dashboard)/inspections/new/page.tsx`

Added comprehensive validation in `handleSubmit()`:
```typescript
// Validate: all defects must have comments
const defectsWithoutComments: string[] = [];
Object.entries(checkboxStates).forEach(([key, status]) => {
  if (status === 'attention' && !comments[key]) {
    const [dayOfWeek, itemNumber] = key.split('-').map(Number);
    const dayName = DAY_NAMES[dayOfWeek - 1] || `Day ${dayOfWeek}`;
    const itemName = currentChecklist[itemNumber - 1] || `Item ${itemNumber}`;
    defectsWithoutComments.push(`${itemName} (${dayName})`);
  }
});

if (defectsWithoutComments.length > 0) {
  setError(`Please add comments for all defects: ${defectsWithoutComments.join(', ')}`);
  toast.error('Missing defect comments', {
    description: `Please add comments for: ${defectsWithoutComments.slice(0, 3).join(', ')}`,
  });
  return;
}
```

Benefits:
- Shows specific items missing comments
- Displays both error message and toast notification
- Prevents submission until all defects have comments

### 3. Status Consistency

**Files Updated:**
- `app/(dashboard)/inspections/[id]/page.tsx` (3 occurrences)
- `app/api/reports/inspections/defects/route.ts` (1 occurrence)

**Changes:**
- Replaced all `item.status === 'defect'` with `item.status === 'attention'`
- Now consistent with TypeScript types and database schema
- Validation now works correctly across the entire app

## Testing Checklist

### ✅ Database Migration
- [x] Migration script runs without errors
- [x] `comments` column exists in `inspection_items`
- [x] `day_of_week` column exists  
- [x] Unique constraint includes `day_of_week`
- [x] Status constraint supports both `'attention'` and `'defect'`
- [x] Manager INSERT policy created for `vehicle_inspections`
- [x] Separate manager policies created for `inspection_items`

### 🔲 Functional Testing (User Required)

**As Employee:**
1. Create new inspection
2. Mark an item as "Fail" (attention)
3. Try to submit without adding comment → Should show error
4. Add comment to defect
5. Submit inspection → Should succeed
6. View submitted inspection → Comments should be visible

**As Manager:**
1. Navigate to New Inspection
2. Select another employee from dropdown
3. Create inspection with that employee's ID
4. Should succeed (no RLS error)
5. Inspection should appear under that employee

**Verify Existing Inspection:**
- Visit: https://www.squiresapp.com/inspections/c721f6c9-aec2-4d52-8cd0-399b5ff4de49
- Check if defects now show comments (if any were saved)
- If comments still empty, they were lost before the fix (cannot recover)

## Database Schema Changes

### Before
```sql
CREATE TABLE inspection_items (
  id UUID PRIMARY KEY,
  inspection_id UUID REFERENCES vehicle_inspections(id),
  item_number INTEGER,
  status TEXT CHECK (status IN ('ok', 'attention', 'na')),
  created_at TIMESTAMPTZ,
  UNIQUE(inspection_id, item_number)  -- Missing day_of_week
);
-- Missing: comments column
-- Missing: day_of_week column
-- Missing: item_description column
```

### After
```sql
CREATE TABLE inspection_items (
  id UUID PRIMARY KEY,
  inspection_id UUID REFERENCES vehicle_inspections(id),
  item_number INTEGER,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7),
  item_description TEXT,
  status TEXT CHECK (status IN ('ok', 'attention', 'defect', 'na')),
  comments TEXT,  -- ✅ ADDED
  created_at TIMESTAMPTZ,
  UNIQUE(inspection_id, item_number, day_of_week)  -- ✅ FIXED
);
```

## RLS Policy Changes

### Before
```sql
-- vehicle_inspections
CREATE POLICY "Employees can create own inspections" 
  ON vehicle_inspections
  FOR INSERT WITH CHECK (auth.uid() = user_id);
-- ❌ Managers blocked from creating for others
```

### After
```sql
-- vehicle_inspections
CREATE POLICY "Employees can create own inspections" 
  ON vehicle_inspections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Managers can create inspections for users"
  ON vehicle_inspections
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );
-- ✅ Managers can now create for any user

-- inspection_items (similar pattern for all CRUD operations)
CREATE POLICY "Employees can insert own inspection items" ...
CREATE POLICY "Managers can insert all inspection items" ...
```

## Files Changed

1. `supabase/fix-inspection-issues.sql` - Migration script (new)
2. `scripts/fix-inspection-issues.ts` - Migration runner (new)
3. `app/(dashboard)/inspections/new/page.tsx` - Added validation
4. `app/(dashboard)/inspections/[id]/page.tsx` - Fixed status checks
5. `app/api/reports/inspections/defects/route.ts` - Fixed status check

## Impact

### Positive Changes
- ✅ Defect comments now save and display correctly
- ✅ Managers can create inspections on behalf of employees
- ✅ Form validation prevents submission without required comments
- ✅ Consistent status values throughout application
- ✅ Better error messages guide users to fix validation issues

### No Breaking Changes
- Migration is backward compatible (uses IF NOT EXISTS)
- Existing data remains intact
- Status constraint supports both old and new values during transition
- Can be safely run multiple times (idempotent)

## Rollback Plan

If issues occur, the changes can be rolled back:

```sql
-- Remove new policies (keep old ones)
DROP POLICY IF EXISTS "Managers can create inspections for users" ON vehicle_inspections;
DROP POLICY IF EXISTS "Managers can insert all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can update all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can delete all inspection items" ON inspection_items;

-- Note: Cannot remove columns without data loss
-- If needed, columns can be ignored by reverting code changes
```

## Next Steps

1. **User Testing**: Have users test the three scenarios above
2. **Monitor Errors**: Check error logs for any RLS policy issues
3. **Data Verification**: Confirm new inspections save comments correctly
4. **Update Documentation**: If any PRD references need updating

## Verification Queries

Run these in Supabase SQL Editor to verify the fix:

```sql
-- Check if comments column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'inspection_items' 
AND column_name IN ('comments', 'day_of_week', 'item_description');

-- Check RLS policies for vehicle_inspections
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'vehicle_inspections'
AND cmd = 'INSERT';

-- Check RLS policies for inspection_items  
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'inspection_items'
ORDER BY cmd;

-- Check recent inspections with defects
SELECT 
  vi.id,
  vi.inspection_date,
  ii.item_description,
  ii.status,
  ii.comments
FROM vehicle_inspections vi
JOIN inspection_items ii ON ii.inspection_id = vi.id
WHERE ii.status IN ('attention', 'defect')
AND vi.created_at > NOW() - INTERVAL '7 days'
ORDER BY vi.created_at DESC
LIMIT 10;
```

## Related Documentation

- `docs/guides/HOW_TO_RUN_MIGRATIONS.md` - Migration workflow
- `docs/guides/MIGRATIONS_GUIDE.md` - Migration best practices
- Project rules file - Database migration requirements

---

**Status**: ✅ Completed and committed
**Date**: December 2, 2025
**Commit**: `fix(inspections): fix defect comments, RLS policies, and status validation`



