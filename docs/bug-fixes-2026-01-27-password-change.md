# Bug Fixes Summary - 2026-01-27

## Critical Fix: Password Change for New Users

### Issue
New users were unable to change their temporary password on first login, receiving "Failed to change password" error.

### Impact
- **Severity**: Critical (blocks new user onboarding)
- **Affected Users**: All new users and password resets
- **Status**: ✅ RESOLVED

### Root Cause
Row Level Security (RLS) policy on `profiles` table had flawed `WITH CHECK` clause:
1. Original policy only allowed admins/managers in `WITH CHECK`
2. First fix attempt caused infinite recursion by querying profiles within profiles policy
3. Database error: `infinite recursion detected in policy for relation "profiles"`

### Solution
Implemented a `SECURITY DEFINER` function pattern:

```sql
-- Function bypasses RLS to safely check permissions
CREATE FUNCTION is_user_manager_or_admin(user_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp;

-- Policy uses function (no recursion!)
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (
    auth.uid() = id OR 
    is_user_manager_or_admin(auth.uid())
  );
```

### Technical Details

**Why SECURITY DEFINER?**
- RLS policies cannot query the table they're protecting (causes recursion)
- SECURITY DEFINER runs with elevated privileges, bypassing RLS
- Allows safe permission checking without triggering recursion

**Security Hardening**:
- `SET search_path`: Prevents search_path hijacking
- `STABLE`: Function result won't change during transaction
- `GRANT EXECUTE TO authenticated`: Restricted access
- Function only reads data, never modifies

### Files Changed
- `supabase/migrations/20260127_fix_profiles_update_policy_v3.sql` - Final working migration
- `scripts/run-profiles-update-fix-migration.ts` - Migration runner
- `docs/fixes/password-change-issue-fix.md` - Detailed documentation
- `docs/fixes/password-change-issue-quick-reference.md` - Quick reference

### Migration History
1. **v1** (`be7d328`) - Initial fix, caused infinite recursion ❌
2. **v2** - Second attempt, still had recursion ❌
3. **v3** (`c3acd27`) - Security definer function pattern ✅

### Testing Checklist
- [x] New user can access /change-password page
- [x] Password validation works correctly
- [x] Password change succeeds without errors
- [x] User is redirected to dashboard
- [x] must_change_password flag is cleared
- [x] No infinite recursion errors in logs
- [x] Admins can still update any profile
- [x] Users cannot update other users' profiles

### Verification Commands

**Check function exists**:
```sql
SELECT proname, prosecdef 
FROM pg_proc 
WHERE proname = 'is_user_manager_or_admin';
```

**Check policy**:
```sql
SELECT * FROM pg_policies 
WHERE tablename = 'profiles' 
AND policyname = 'Users can update own profile';
```

**Test as user**:
```sql
-- Should succeed for own profile
UPDATE profiles 
SET must_change_password = false 
WHERE id = auth.uid();
```

### Performance Impact
- ✅ Function marked as `STABLE` (can be optimized/cached)
- ✅ Simple query with indexed columns (role_id)
- ✅ No performance degradation observed

### Related Systems
- Authentication flow (`/change-password`)
- User profile management
- Password reset functionality
- Admin user management

### Deployment
- **Date**: 2026-01-27
- **Environment**: Production
- **Migration**: Automated via script
- **Downtime**: None
- **Rollback Plan**: Drop function and restore previous policy

### Monitoring
Post-deployment checks:
- ✅ No new error logs related to profiles
- ✅ Password change page accessible
- ✅ No infinite recursion errors
- ✅ Profile updates working

### Future Improvements
Consider creating similar helper functions for other RLS policies that may need cross-table permission checks:
- `is_user_super_admin(user_id UUID)`
- `user_can_manage_vehicles(user_id UUID)`
- `user_can_approve_timesheets(user_id UUID)`

### References
- Full documentation: `docs/fixes/password-change-issue-fix.md`
- Quick reference: `docs/fixes/password-change-issue-quick-reference.md`
- Migration guide: `docs/guides/HOW_TO_RUN_MIGRATIONS.md`
- Security definer pattern: PostgreSQL docs on SECURITY DEFINER functions

---

## Summary Statistics
- **Total Commits**: 4
- **Files Changed**: 6
- **Time to Resolution**: ~2 hours
- **Migration Attempts**: 3 (final successful)
- **Status**: ✅ Production Ready
