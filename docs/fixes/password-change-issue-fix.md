# Password Change Issue - Fix Applied ✅

## Issue Reported
New users could not change their temporary password on first login. They were getting "Failed to change password" error message.

## Root Cause
The Row Level Security (RLS) policy `"Users can update own profile"` on the `profiles` table had an incorrectly configured `WITH CHECK` clause that only allowed admins and managers to update profiles, even though the `USING` clause allowed users to target their own profile.

### The Broken Policy (from migration 20260122)
```sql
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id)  -- ✓ Users can target their own profile
  WITH CHECK (
    -- ❌ But only admins/managers could save changes!
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = ANY (ARRAY['admin', 'manager'])
    )
  );
```

## The Fix (v3 - Correct Version)

### Challenge: Infinite Recursion
The initial fix attempt caused infinite recursion because querying the `profiles` table within a `profiles` RLS policy creates a loop:
- User tries to update profiles table
- Policy checks profiles table
- That check triggers the same policy
- Loop continues infinitely

### Solution: Security Definer Function
Created a `SECURITY DEFINER` function that bypasses RLS to safely check permissions:

```sql
-- Function runs with elevated privileges, bypassing RLS
CREATE OR REPLACE FUNCTION public.is_user_manager_or_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  is_manager BOOLEAN;
BEGIN
  SELECT COALESCE(r.is_manager_admin, FALSE) INTO is_manager
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  WHERE p.id = user_id;
  
  RETURN COALESCE(is_manager, FALSE);
END;
$$;

-- Policy uses the function (no recursion!)
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = id
    OR is_user_manager_or_admin((select auth.uid()))
  )
  WITH CHECK (
    (select auth.uid()) = id
    OR is_user_manager_or_admin((select auth.uid()))
  );
```

## Files Changed
1. `supabase/migrations/20260127_fix_profiles_update_policy.sql` - Initial fix (caused recursion)
2. `supabase/migrations/20260127_fix_profiles_update_policy_v2.sql` - Second attempt (still had recursion)
3. `supabase/migrations/20260127_fix_profiles_update_policy_v3.sql` - Final working fix
4. `scripts/run-profiles-update-fix-migration.ts` - Migration runner script

## Migrations Applied
✅ v1 applied - caused infinite recursion
✅ v3 applied - working correctly (2026-01-27)

## Technical Details
- `SECURITY DEFINER`: Function runs with creator's privileges, bypassing RLS
- `STABLE`: Function result doesn't change during transaction (optimization)
- `SET search_path`: Security hardening to prevent search_path hijacking
- `GRANT EXECUTE TO authenticated`: Only authenticated users can call function

## Impact
- ✅ New users can now change their temporary password on first login
- ✅ Password reset flow works correctly
- ✅ All users can update their own profiles
- ✅ Admins and managers can still update any profile
- ✅ Security maintained: users cannot update other users' profiles
- ✅ No infinite recursion errors

## Testing
New users should now be able to:
1. Log in with temporary password
2. Be redirected to /change-password
3. Successfully change their password (no recursion error)
4. Be redirected to dashboard

## Commits
- `be7d328` - Initial fix (broken - recursion)
- `5a1e4dc` - Documentation
- `c3acd27` - Correct fix using security definer function ✅
- Branch: `main`
- Pushed to GitHub: Yes ✅
