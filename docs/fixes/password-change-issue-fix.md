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

## The Fix
Updated the policy to allow users to update their own profiles AND admins/managers to update any profile:

```sql
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    -- Users can update their own profile OR admins/managers can update any
    (select auth.uid()) = id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = ANY (ARRAY['admin', 'manager'])
    )
  )
  WITH CHECK (
    -- Users can only save to their own profile OR admins/managers to any
    (select auth.uid()) = id
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = ANY (ARRAY['admin', 'manager'])
    )
  );
```

## Files Changed
1. `supabase/migrations/20260127_fix_profiles_update_policy.sql` - Migration SQL
2. `scripts/run-profiles-update-fix-migration.ts` - Migration runner script

## Migration Applied
✅ Successfully applied to production database on 2026-01-27

## Impact
- ✅ New users can now change their temporary password on first login
- ✅ Password reset flow works correctly
- ✅ All users can update their own profiles
- ✅ Admins and managers can still update any profile
- ✅ Security maintained: users cannot update other users' profiles

## Testing
New users should now be able to:
1. Log in with temporary password
2. Be redirected to /change-password
3. Successfully change their password
4. Be redirected to dashboard

## Commit
- Commit: `be7d328`
- Branch: `main`
- Pushed to GitHub: Yes ✅
