# Supabase RLS Performance Optimization - Applied

**Date:** 2026-01-22  
**Status:** ✅ COMPLETED

## Issue Resolved

Fixed the **auth_rls_initplan** performance warning from Supabase linter on the `profiles` table.

### Original Issue

Supabase reported that the `profiles` table had an RLS policy "Authenticated users can view all profiles" that was re-evaluating `auth.role()` for each row, causing poor performance at scale.

## Solution Applied

### Migrations Created and Run

1. **`20260121_optimize_rls_performance.sql`** - Bulk optimization of 121 RLS policies across 33 tables
2. **`20260122_fix_profiles_rls_optimization.sql`** - Cleaned up double-wrapped SELECT statements
3. **`20260122_fix_auth_role_optimization.sql`** - Wrapped `auth.role()` in SELECT subquery

### Final Policy State

All three policies on the `profiles` table now use optimized auth function calls:

```sql
-- Policy 1: Authenticated users can view all profiles
USING (( SELECT auth.role() AS role) = 'authenticated'::text)
✅ OPTIMIZED - auth.role() wrapped in SELECT

-- Policy 2: Users can view own profile  
USING (( SELECT auth.uid() AS uid) = id)
✅ OPTIMIZED - auth.uid() wrapped in SELECT

-- Policy 3: Users can update own profile
USING (( SELECT auth.uid() AS uid) = id)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM profiles
    WHERE profiles.id = ( SELECT auth.uid() AS uid)
      AND profiles.role = ANY (ARRAY['admin', 'manager'])
  )
)
✅ OPTIMIZED - All auth.uid() calls wrapped in SELECT
```

## Performance Impact

**Before:**
- Auth functions evaluated ONCE PER ROW for each query result
- Significant overhead for queries returning multiple profiles

**After:**
- Auth functions evaluated ONCE PER QUERY
- Subquery is executed once and cached for the entire result set
- Expected significant performance improvement for multi-row queries

## Verification

Run the inspection script to verify:
```bash
npx tsx scripts/inspect-profiles-rls.ts
```

Expected: All policies show `SELECT auth.<function>()` wrapped in parentheses.

## Next Steps

1. ✅ **DONE** - Auth RLS optimization applied to profiles table
2. Monitor application performance (should see faster profile queries)
3. Check Supabase linter dashboard - the `auth_rls_initplan` warning should be cleared
4. (Optional) Address the 154 "multiple permissive policies" warnings as a future optimization

## Remaining Linter Warnings

The Supabase linter also reported:
- **154 warnings** for "Multiple Permissive Policies" - multiple RLS policies on same table/role/action
- **1 warning** for "Duplicate Index" - one index should be dropped

These are lower priority and can be addressed later if/when performance issues are observed.

## Related Scripts

- `scripts/run-rls-performance-migration.ts` - Bulk RLS optimization runner
- `scripts/run-fix-profiles-rls.ts` - Profiles-specific fix
- `scripts/run-fix-auth-role.ts` - Auth.role() optimization
- `scripts/inspect-profiles-rls.ts` - Verification tool
