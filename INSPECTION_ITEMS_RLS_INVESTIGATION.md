# Investigation Report: Inspection Items RLS 42501 Errors

**Date:** December 6, 2025  
**Investigator:** Claude (Cursor AI Agent)  
**Issue:** Multiple 42501 RLS policy violations when saving inspection items

---

## Executive Summary

Users (particularly managers) are experiencing **42501 RLS policy violations** when attempting to save inspection items. The root cause is **outdated RLS policies** that reference a deprecated `profiles.role` text column instead of the current `roles` table structure.

**Impact:**
- Managers cannot create inspections on behalf of employees
- High error rate on `/inspections/new` page (multiple errors logged in production)
- User frustration and workflow blockage

**Resolution:**
- Created migration `20251206_fix_inspection_items_rls.sql`
- Updates all `inspection_items` RLS policies to use `roles` table
- Consistent with other tables already migrated

---

## Error Details

### Sample Error Log Entry

```
Type: Error
Component: Console Error
Device: Mobile
Browser: Safari/604.1

ERROR MESSAGE:
Error saving items: {
  "code": "42501",
  "details": null,
  "hint": null,
  "message": "new row violates row-level security policy (USING expression) for table \"inspection_items\""
}

TIMESTAMP: 06/12/2025, 15:17:48
USER: Nathan Hubbard (nathan@avsquires.co.uk)
PAGE URL: https://www.squiresapp.com/inspections/new?id=bfec3294-ee46-4679-b0ed-47ab330536fa
```

### PostgreSQL Error Code
- **42501**: `insufficient_privilege`
- Indicates RLS policy prevented the INSERT operation
- Specifically, the USING/WITH CHECK expression evaluated to FALSE

---

## Root Cause Analysis

### Timeline of the Issue

1. **Initial Setup**: System originally used `profiles.role` (TEXT column) to store user roles
   - Values: `'admin'`, `'manager'`, `'employee-civils'`, etc.
   - RLS policies checked: `profiles.role IN ('manager', 'admin')`

2. **Role System Migration**: System migrated to normalized roles table
   - File: `supabase/create-roles-and-permissions.sql`
   - New structure:
     ```sql
     profiles.role_id → roles.id
     roles.is_manager_admin (BOOLEAN)
     ```
   - `profiles.role` column deprecated

3. **Partial Policy Updates**: Most tables updated to use new roles structure
   - File: `supabase/fix-rls-to-use-roles-table.sql`
   - Updated: `vehicle_inspections`, `timesheets`, `absences`, etc.
   - **But NOT `inspection_items`**

4. **Conflicting Migration**: Later migration overwrote some policies
   - File: `supabase/fix-inspection-issues.sql` (lines 149-164)
   - Created INSERT policies checking deprecated `profiles.role` column
   - This overwrote the correct policies from step 3

### The Broken Policies

**Before Fix (from `fix-inspection-issues.sql`):**

```sql
-- This policy checks the DEPRECATED profiles.role column
CREATE POLICY "Managers can insert all inspection items" ON inspection_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')  -- ❌ DEPRECATED
    )
  );
```

**Why It Failed:**
1. When Nathan (a manager) tries to insert inspection items
2. Employee policy fails: `vi.user_id != auth.uid()` (inspection might be for another employee)
3. Manager policy fails: `profiles.role` is NULL (column is deprecated and not maintained)
4. Result: Both policies fail → 42501 error

### The Correct Approach

**After Fix (new migration):**

```sql
-- This policy uses the CURRENT roles table structure
CREATE POLICY "Managers can insert all inspection items" ON inspection_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true  -- ✅ CORRECT
    )
  );
```

**Why It Works:**
1. Checks the maintained `role_id` foreign key
2. Joins to `roles` table
3. Uses the `is_manager_admin` boolean flag
4. Consistent with all other tables in the system

---

## Technical Details

### Affected Code Locations

1. **Database Policies**:
   - `/workspace/supabase/migrations/20251206_fix_inspection_items_rls.sql` (NEW FIX)
   - `/workspace/supabase/fix-inspection-issues.sql` (OUTDATED)
   - `/workspace/supabase/fix-rls-to-use-roles-table.sql` (CORRECT PATTERN)

2. **Application Code**:
   - `/workspace/app/(dashboard)/inspections/new/page.tsx` (lines 596-619)
   - Function: `saveInspection()` - inserts inspection items using `.upsert()`

3. **Error Logging**:
   - `/workspace/app/(dashboard)/debug/page.tsx` (lines 291-337)
   - Function: `fetchErrorLogs()` - displays errors on debug page

### Database Schema Context

```sql
-- Profiles table (users)
profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  role TEXT,              -- ❌ DEPRECATED (but still exists for backward compatibility)
  role_id UUID,           -- ✅ CURRENT (FK to roles.id)
  ...
)

-- Roles table (normalized role system)
roles (
  id UUID PRIMARY KEY,
  name TEXT,              -- e.g., 'manager', 'employee-civils'
  display_name TEXT,
  is_super_admin BOOLEAN,
  is_manager_admin BOOLEAN,  -- ✅ KEY FIELD for permissions
  ...
)

-- Vehicle inspections (parent)
vehicle_inspections (
  id UUID PRIMARY KEY,
  user_id UUID,           -- The employee who performed/owns the inspection
  vehicle_id UUID,
  status TEXT,
  ...
)

-- Inspection items (child)
inspection_items (
  id UUID PRIMARY KEY,
  inspection_id UUID,     -- FK to vehicle_inspections.id
  item_number INTEGER,
  day_of_week INTEGER,
  status TEXT,
  comments TEXT,
  ...
)
```

### RLS Policy Logic Flow

**Scenario**: Manager Nathan creates an inspection for Employee John

1. **Create Inspection Record** (via `vehicle_inspections` table):
   ```sql
   INSERT INTO vehicle_inspections (user_id, vehicle_id, ...)
   VALUES ('john-uuid', 'vehicle-123', ...)  -- user_id = John, not Nathan
   ```
   - ✅ Passes: "Managers can create inspections for users" policy
   - Uses: `r.is_manager_admin = true` (correct)

2. **Create Inspection Items** (via `inspection_items` table):
   ```sql
   INSERT INTO inspection_items (inspection_id, item_number, ...)
   VALUES ('inspection-xyz', 1, ...)
   ```
   - ❌ BEFORE FIX: Failed both policies
     - Employee policy: `vi.user_id = auth.uid()` → `'john-uuid' = 'nathan-uuid'` → FALSE
     - Manager policy: `profiles.role IN ('manager', 'admin')` → NULL IN (...) → FALSE
   - ✅ AFTER FIX: Passes manager policy
     - Employee policy: Still FALSE (expected)
     - Manager policy: `r.is_manager_admin = true` → TRUE (Nathan is a manager)

---

## The Fix

### Migration Created

**File**: `/workspace/supabase/migrations/20251206_fix_inspection_items_rls.sql`

**Changes**:
1. Drops all existing (broken) policies on `inspection_items`
2. Creates 8 new policies using correct `roles` table structure:
   - 2 SELECT policies (employee own, manager all)
   - 2 INSERT policies (employee own, manager all)
   - 2 UPDATE policies (employee own drafts, manager all)
   - 2 DELETE policies (employee own drafts, manager all)

**Key Pattern** (repeated for all CRUD operations):
```sql
-- Managers can [OPERATION] all inspection items
CREATE POLICY "Managers can [OPERATION] all inspection items" ON inspection_items
  FOR [OPERATION] [USING/WITH CHECK] (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() AND r.is_manager_admin = true
    )
  );
```

### Running the Migration

**Prerequisites**:
- Database connection string in `.env.local`
- `POSTGRES_URL_NON_POOLING` environment variable set

**Command** (from workspace root):
```bash
npm run db:migrate supabase/migrations/20251206_fix_inspection_items_rls.sql
```

**Or manually** (if using psql):
```bash
psql $POSTGRES_URL_NON_POOLING -f supabase/migrations/20251206_fix_inspection_items_rls.sql
```

---

## Verification Steps

After running the migration:

1. **Check Policies Applied**:
   ```sql
   SELECT policyname, cmd 
   FROM pg_policies 
   WHERE tablename = 'inspection_items'
   ORDER BY policyname;
   ```
   
   Expected: 8 policies total
   - 2 for SELECT
   - 2 for INSERT
   - 2 for UPDATE
   - 2 for DELETE

2. **Test Manager Creating Inspection for Employee**:
   - Log in as Nathan (manager)
   - Navigate to `/inspections/new`
   - Select an employee (not yourself) in the employee selector
   - Create and submit an inspection
   - Should succeed without 42501 errors

3. **Monitor Error Logs**:
   - Visit `/debug` page
   - Check Error Log tab
   - Should see no new 42501 errors for `inspection_items`
   - Can clear old errors using "Clear All" button

4. **Test Employee Creating Own Inspection**:
   - Log in as a regular employee
   - Create and submit an inspection
   - Should work as before (no regression)

---

## Prevention

### Future Migration Guidelines

To prevent this issue in the future:

1. **Always Use Roles Table**: When creating RLS policies, always use:
   ```sql
   EXISTS (
     SELECT 1 FROM profiles p
     JOIN roles r ON p.role_id = r.id
     WHERE p.id = auth.uid() AND r.is_manager_admin = true
   )
   ```

2. **Never Use Deprecated Column**: Avoid:
   ```sql
   -- ❌ DON'T DO THIS
   WHERE profiles.role IN ('manager', 'admin')
   ```

3. **Reference Template**: Use `fix-rls-to-use-roles-table.sql` as the template for all RLS policies

4. **Check Migration Order**: Ensure migrations don't overwrite each other
   - Consider using timestamped migration filenames
   - Document dependencies between migrations

5. **Test After Each Migration**:
   - Create test scenarios for all user roles
   - Verify CRUD operations work for each role
   - Check error logs immediately after deployment

### Code Review Checklist

When reviewing migrations that touch RLS policies:

- [ ] Uses `profiles.role_id` and `roles.is_manager_admin`
- [ ] Does NOT use deprecated `profiles.role` text column
- [ ] Consistent with other table policies in system
- [ ] Tested with manager creating for another user
- [ ] Tested with employee creating for self
- [ ] No 42501 errors in logs after deployment

---

## Related Files

### SQL Migrations
- ✅ **NEW**: `supabase/migrations/20251206_fix_inspection_items_rls.sql` (THE FIX)
- ⚠️ **OUTDATED**: `supabase/fix-inspection-issues.sql` (contains broken policies)
- ✅ **TEMPLATE**: `supabase/fix-rls-to-use-roles-table.sql` (correct pattern)
- 📚 **CONTEXT**: `supabase/create-roles-and-permissions.sql` (role system setup)

### Application Code
- `app/(dashboard)/inspections/new/page.tsx` - inspection creation page
- `app/(dashboard)/debug/page.tsx` - error logging and display
- `lib/hooks/useAuth.ts` - authentication and role checking

### Documentation
- `docs/guides/HOW_TO_RUN_MIGRATIONS.md` - migration execution guide
- `docs/guides/MIGRATIONS_GUIDE.md` - database migration patterns

---

## Conclusion

The 42501 errors were caused by RLS policies referencing a deprecated database column. The fix updates these policies to use the current role system, allowing managers to create inspections on behalf of employees while maintaining proper security boundaries.

**Status**: ✅ Fix created and ready to deploy  
**Next Steps**: Run migration and verify in production  
**Risk Level**: Low (policies are more permissive for managers, which is intended behavior)

---

## Appendix: Other Tables Still Using Old Pattern

The following files still reference `profiles.role` directly and may need similar fixes in the future:

1. `supabase/fix-timesheet-rls.sql` (7 occurrences)
2. `supabase/create-actions-table.sql` (4 occurrences)
3. `supabase/enable-audit-log-access.sql` (1 occurrence)

**Recommendation**: Audit these files and update them to use the roles table structure for consistency and to prevent similar issues.
