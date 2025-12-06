# 🔒 Fix for Inspection Items 42501 RLS Errors

## Quick Summary

**Problem**: Managers getting "42501 RLS policy violation" errors when saving inspection items

**Root Cause**: RLS policies checking deprecated `profiles.role` column instead of current `roles` table

**Solution**: Migration ready to run that updates policies to use `roles.is_manager_admin`

**Status**: ✅ Fix ready | 📝 Migration created | ⏳ Awaiting deployment

---

## What Was Wrong

The `inspection_items` table had INSERT policies that checked:
```sql
WHERE profiles.role IN ('manager', 'admin')  -- ❌ DEPRECATED COLUMN (NULL)
```

But the system migrated to use:
```sql
WHERE r.is_manager_admin = true  -- ✅ CURRENT STRUCTURE
JOIN profiles.role_id → roles.id
```

Result: When managers tried to create inspection items, both policies failed → **42501 error**

---

## Files Created

### 1. Migration File
📄 **`supabase/migrations/20251206_fix_inspection_items_rls.sql`**
- Drops all old/broken policies on `inspection_items`
- Creates 8 new policies using correct `roles` table structure
- Includes verification queries

### 2. Migration Script  
📄 **`scripts/run-inspection-items-rls-fix.ts`**
- Automated script to run the migration
- Includes detailed logging and verification
- Tests that policies were created correctly

### 3. Investigation Report
📄 **`INSPECTION_ITEMS_RLS_INVESTIGATION.md`**
- Comprehensive analysis of the issue
- Technical details and timeline
- Prevention guidelines for future

---

## How to Run the Fix

### Option 1: Using Automated Script (Recommended)

```bash
# From workspace root
npx tsx scripts/run-inspection-items-rls-fix.ts
```

**Requirements:**
- `.env.local` must have `POSTGRES_URL_NON_POOLING` or `POSTGRES_URL`
- Database connection string with appropriate permissions

**What it does:**
- Connects to database
- Runs the migration SQL
- Verifies policies were created (should see 8 policies)
- Provides testing recommendations

### Option 2: Manual (Supabase Dashboard)

If you don't have local database access:

1. Go to Supabase Dashboard → SQL Editor
2. Open: `supabase/migrations/20251206_fix_inspection_items_rls.sql`
3. Copy and paste the SQL
4. Click "Run"
5. Verify: Should see "8 rows" in policies table

---

## Verification Steps

After running the migration:

### 1. Check Policies Created
```sql
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'inspection_items'
ORDER BY policyname;
```

**Expected output**: 8 policies
- 2 SELECT (employee own, manager all)
- 2 INSERT (employee own, manager all)
- 2 UPDATE (employee own, manager all)
- 2 DELETE (employee own, manager all)

### 2. Test Manager Flow
1. Log in as Nathan (or any manager)
2. Go to `/inspections/new`
3. Select another employee in dropdown
4. Fill out and submit inspection
5. **Should succeed without 42501 errors** ✅

### 3. Test Employee Flow
1. Log in as regular employee
2. Create and submit own inspection
3. **Should work as before** ✅ (no regression)

### 4. Check Error Logs
1. Visit `/debug` page (SuperAdmin only)
2. Look at Error Log tab
3. **Should be no new 42501 errors for `inspection_items`** ✅
4. Can clear old errors using "Clear All" button

---

## What Changed

### Before (Broken)
```sql
-- Manager policy checking deprecated column
CREATE POLICY "Managers can insert all inspection items" ON inspection_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('manager', 'admin')  -- ❌ NULL column
    )
  );
```

**Result**: Policy fails because `profiles.role` is NULL

### After (Fixed)
```sql
-- Manager policy using roles table
CREATE POLICY "Managers can insert all inspection items" ON inspection_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() 
      AND r.is_manager_admin = true  -- ✅ Maintained field
    )
  );
```

**Result**: Policy succeeds because `roles.is_manager_admin` is properly set

---

## Impact

### Users Affected
- ✅ **Managers**: Can now create inspections for employees
- ✅ **Employees**: No change (continue to create own inspections)
- ✅ **All users**: No more 42501 errors on inspection items

### Error Rate
- **Before**: Multiple 42501 errors per day (logged in `/debug`)
- **After**: Should drop to zero for `inspection_items`

---

## Prevention

To avoid this in the future:

### ✅ DO:
- Always use `profiles.role_id → roles.is_manager_admin`
- Reference `fix-rls-to-use-roles-table.sql` as template
- Test with both manager and employee accounts
- Check error logs after deployment

### ❌ DON'T:
- Never use `profiles.role` text column (deprecated)
- Don't check `role IN ('manager', 'admin')` in policies
- Avoid creating conflicting migrations

---

## Related Issues

These files also use the old pattern and may need similar fixes:

1. `supabase/fix-timesheet-rls.sql` (7 occurrences)
2. `supabase/create-actions-table.sql` (4 occurrences)
3. `supabase/enable-audit-log-access.sql` (1 occurrence)

**Recommendation**: Audit and update these in a future maintenance window.

---

## Documentation

For more details, see:
- 📚 **`INSPECTION_ITEMS_RLS_INVESTIGATION.md`** - Full analysis
- 📖 **`docs/guides/HOW_TO_RUN_MIGRATIONS.md`** - Migration guide
- 🔍 **`supabase/fix-rls-to-use-roles-table.sql`** - Correct pattern template

---

## Questions?

- **Where are the errors?** → `/debug` page → Error Log tab
- **Who can run migrations?** → Anyone with database admin access
- **Is this safe to deploy?** → Yes, low risk (policies are more permissive for managers, which is intended)
- **Will it affect employees?** → No, employee policies unchanged
- **Need to rollback?** → Keep old `fix-inspection-issues.sql` for reference

---

**Status**: ✅ Ready for deployment  
**Priority**: High (blocking managers from creating inspections)  
**Risk**: Low (well-tested pattern, consistent with other tables)  
**Next Steps**: Run migration and verify in production

---

*Migration created: December 6, 2025*  
*Issue: 42501 RLS violations on `inspection_items` table*  
*Resolution: Update policies to use `roles` table structure*
