# Authentication & User Management Troubleshooting

## Table of Contents
1. [Password Change Issues](#password-change-issues)
2. [Login Problems](#login-problems)
3. [Profile Update Failures](#profile-update-failures)
4. [RLS Policy Debugging](#rls-policy-debugging)

---

## Password Change Issues

### New Users Cannot Change Password

**Symptoms**:
- User sees "Failed to change password" error
- Browser console shows: `infinite recursion detected in policy for relation "profiles"`
- User stuck on `/change-password` page

**Root Cause**:
RLS policy on profiles table was querying the same table within the policy, causing infinite recursion.

**Solution Applied**:
✅ Fixed with security definer function (2026-01-27)

**Verification**:
```sql
-- Check function exists
SELECT proname, prosecdef 
FROM pg_proc 
WHERE proname = 'is_user_manager_or_admin';

-- Should return: is_user_manager_or_admin | t
```

**Manual Fix** (if needed):
```bash
npx tsx scripts/run-profiles-update-fix-migration.ts
```

**Related Files**:
- `supabase/migrations/20260127_fix_profiles_update_policy_v3.sql`
- `docs/bug-fixes-2026-01-27-password-change.md`

---

## Login Problems

### User Cannot Log In

**Check**:
1. Verify user exists in `auth.users`
2. Check if email is confirmed
3. Verify profile exists in `profiles` table
4. Check `must_change_password` flag

**SQL Checks**:
```sql
-- Check user status
SELECT 
  u.email,
  u.email_confirmed_at,
  p.must_change_password,
  p.full_name,
  r.name as role
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
LEFT JOIN roles r ON r.id = p.role_id
WHERE u.email = 'user@example.com';
```

### User Stuck in Password Change Loop

**Cause**: `must_change_password` flag not being cleared

**Fix**:
```sql
UPDATE profiles 
SET must_change_password = false 
WHERE id = 'user-uuid-here';
```

---

## Profile Update Failures

### User Cannot Update Own Profile

**Check RLS Policies**:
```sql
SELECT 
  schemaname,
  tablename,
  policyname,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'profiles';
```

**Required Policy**:
- Name: "Users can update own profile"
- Should allow: `auth.uid() = id`
- Admin override: Uses `is_user_manager_or_admin()` function

### Admin Cannot Update User Profiles

**Check**:
1. Verify admin role has `is_manager_admin = true`
2. Check security definer function exists
3. Test with direct SQL

**SQL Test**:
```sql
-- Test function
SELECT is_user_manager_or_admin('admin-user-id');
-- Should return: t (true)

-- Check role
SELECT r.name, r.is_manager_admin
FROM profiles p
JOIN roles r ON r.id = p.role_id
WHERE p.id = 'admin-user-id';
```

---

## RLS Policy Debugging

### Infinite Recursion Errors

**Error**: `infinite recursion detected in policy for relation "X"`

**Cause**: Policy queries the same table it's protecting

**Solution Pattern**:
```sql
-- BAD (causes recursion)
CREATE POLICY "example"
  ON table_name
  USING (
    EXISTS (SELECT 1 FROM table_name WHERE ...) -- ❌ Recursion!
  );

-- GOOD (uses security definer)
CREATE FUNCTION check_permission(user_id UUID)
RETURNS BOOLEAN
SECURITY DEFINER
STABLE;

CREATE POLICY "example"
  ON table_name
  USING (
    check_permission(auth.uid()) -- ✅ No recursion
  );
```

### RLS Policy Not Working

**Debug Steps**:
1. Check if RLS is enabled:
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'profiles';
```

2. List all policies:
```sql
SELECT * FROM pg_policies WHERE tablename = 'profiles';
```

3. Test policy with specific user:
```sql
-- Set role to test as specific user
SET ROLE authenticated;
SET request.jwt.claims.sub = 'user-uuid-here';

-- Try query
SELECT * FROM profiles WHERE id = 'user-uuid-here';
```

### Performance Issues with RLS

**Check for Unoptimized Auth Calls**:
```sql
SELECT 
  schemaname,
  tablename,
  policyname
FROM pg_policies
WHERE 
  -- Look for unoptimized patterns
  qual LIKE '%auth.uid()%' 
  AND qual NOT LIKE '%select auth.uid()%';
```

**Optimization**:
- Use `(select auth.uid())` not `auth.uid()` directly
- Mark functions as `STABLE` when possible
- Add indexes on frequently checked columns

---

## Common Migration Issues

### Migration Failed to Apply

**Check**:
```bash
# View migration logs
npx tsx scripts/run-profiles-update-fix-migration.ts 2>&1 | tee migration.log
```

**Common Errors**:

1. **"already exists"**
   - Policy/function already exists
   - Safe to ignore if already fixed
   - Or drop and recreate

2. **"permission denied"**
   - Check database connection string
   - Ensure using service role (not anon key)
   - Verify `.env.local` has `POSTGRES_URL_NON_POOLING`

3. **"relation does not exist"**
   - Table/column missing
   - Check if earlier migrations need to run first
   - Verify database schema

---

## Verification Queries

### Check All Auth-Related Functions
```sql
SELECT 
  proname as function_name,
  prosecdef as is_security_definer,
  provolatile as volatility
FROM pg_proc
WHERE proname IN (
  'is_user_manager_or_admin',
  'user_has_permission',
  'get_user_permissions'
);
```

### Check All Profiles Policies
```sql
SELECT 
  policyname,
  cmd,
  qual IS NOT NULL as has_using,
  with_check IS NOT NULL as has_with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;
```

### Verify User Can Update Profile
```sql
-- As the user (should succeed)
UPDATE profiles 
SET must_change_password = false 
WHERE id = auth.uid();

-- Check result
SELECT must_change_password FROM profiles WHERE id = auth.uid();
```

---

## Getting Help

### Log Collection
```sql
-- Get recent errors
SELECT 
  created_at,
  message,
  details,
  user_id
FROM error_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 20;
```

### Files to Check
- Browser console (F12) for client-side errors
- Network tab for API response errors
- `docs/bug-fixes-2026-01-27-password-change.md` for password issues
- `docs/guides/HOW_TO_RUN_MIGRATIONS.md` for migration help

### Support Resources
- Migration guides: `docs/guides/`
- Bug fixes: `docs/bug-fixes-*.md`
- Implementation docs: `docs/features/`

---

## Prevention

### Before Creating RLS Policies

1. **Never query the same table in its own policy**
   - Use security definer functions instead
   - Or join to different tables

2. **Always test with real users**
   - Don't just test as admin
   - Test permission boundaries

3. **Optimize auth function calls**
   - Wrap in SELECT: `(select auth.uid())`
   - Mark functions as STABLE when appropriate

4. **Document complex policies**
   - Explain why each clause exists
   - Note any security assumptions

### Best Practices

- Run migrations in test environment first
- Keep security definer functions simple
- Set search_path on all SECURITY DEFINER functions
- Grant minimal permissions to functions
- Use STABLE over VOLATILE when possible
