# Password Change Issue - Quick Reference

## Problem
New users couldn't change their temporary password on first login.

**Error**: `infinite recursion detected in policy for relation "profiles"`

## Root Cause
RLS policy on `profiles` table was querying the same table within the policy, causing infinite recursion.

## Solution
Created a `SECURITY DEFINER` function to bypass RLS and check permissions safely.

## What Was Applied

### 1. Security Definer Function
```sql
CREATE FUNCTION is_user_manager_or_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
```

**Purpose**: Checks if user is manager/admin WITHOUT triggering RLS recursion

**Key Features**:
- `SECURITY DEFINER`: Runs with elevated privileges (bypasses RLS)
- `STABLE`: Result doesn't change during transaction
- `SET search_path`: Security hardening

### 2. Updated RLS Policy
```sql
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (
    (select auth.uid()) = id                          -- Users: own profile
    OR is_user_manager_or_admin((select auth.uid()))  -- Managers: any profile
  )
  WITH CHECK (
    (select auth.uid()) = id
    OR is_user_manager_or_admin((select auth.uid()))
  );
```

## Files Involved
- `supabase/migrations/20260127_fix_profiles_update_policy_v3.sql`
- `scripts/run-profiles-update-fix-migration.ts`

## Migration Status
✅ Applied to production: 2026-01-27

## Testing
1. Log in as new user with temporary password
2. Navigate to `/change-password`
3. Enter new password
4. Submit form
5. Should succeed and redirect to dashboard

## Commands

### Run Migration
```bash
npx tsx scripts/run-profiles-update-fix-migration.ts
```

### Verify Function Exists
```sql
SELECT proname, prosecdef 
FROM pg_proc 
WHERE proname = 'is_user_manager_or_admin';
```

### Verify Policy
```sql
SELECT policyname, qual, with_check 
FROM pg_policies 
WHERE tablename = 'profiles' 
AND policyname = 'Users can update own profile';
```

## Why SECURITY DEFINER?
- RLS policies cannot query the same table they protect (causes recursion)
- SECURITY DEFINER functions run with creator's privileges, bypassing RLS
- This allows safe permission checks without triggering the policy recursively

## Security Notes
- Function has restricted search_path to prevent hijacking
- Only `authenticated` role can execute
- Function is `STABLE` (optimization + security)
- Only checks permissions, doesn't modify data

## Related Issues
- Initial fix attempt (v1): Caused infinite recursion
- Second attempt (v2): Still had recursion via JOIN
- Final fix (v3): Uses security definer function ✅

## Commits
- `be7d328` - Initial broken fix
- `c3acd27` - Working fix with security definer
- `75feb61` - Documentation update

## See Also
- Full details: `docs/fixes/password-change-issue-fix.md`
- Migration guide: `docs/guides/HOW_TO_RUN_MIGRATIONS.md`
