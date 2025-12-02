# User Role Change Procedure

## Issue: User Can't See Updated Permissions After Role Change

When a user's role is changed in the admin panel (e.g., from Employee to Admin/Manager), they may not immediately see the new permissions due to **session caching**.

## Root Cause

The `useAuth` hook fetches the user's profile and role when they log in:

```typescript
// lib/hooks/useAuth.ts
const fetchProfile = async (userId: string) => {
  const { data } = await supabase
    .from('profiles')
    .select(`
      *,
      role:roles(
        name,
        display_name,
        is_manager_admin,
        is_super_admin
      )
    `)
    .eq('id', userId)
    .single();
  
  setProfile(data);
};
```

This profile data is **cached in the React state** and **Supabase session** until the user logs out. Even if you change their role in the database, the cached session still has the old role information.

## Solution: Force Session Refresh

### Method 1: User Action (Recommended)

**Ask the user to:**
1. **Log out completely** (click Sign Out)
2. **Clear browser cache/cookies** (optional but recommended)
3. **Log back in**

Their session will fetch the fresh profile with the updated role.

### Method 2: Admin Force Logout (If Available)

If you have admin tools to invalidate sessions, use them. Otherwise, ask the user to follow Method 1.

### Method 3: Script-Based Session Refresh

You can create a "Refresh Permissions" button that forces a profile refetch:

```typescript
// Example component
const RefreshPermissionsButton = () => {
  const supabase = createClient();
  const { user } = useAuth();
  
  const handleRefresh = async () => {
    // Force sign out
    await supabase.auth.signOut();
    // Redirect to login
    router.push('/login');
  };
  
  return (
    <Button onClick={handleRefresh}>
      Refresh Permissions
    </Button>
  );
};
```

## Diagnostic Script

Run this to check a user's current role configuration:

```bash
npx tsx scripts/diagnose-user-permissions.ts
```

This will show:
- All available roles
- The user's current role assignment
- Whether permissions are correctly configured
- Any issues that need fixing

## Example: Andy Hill Case

**Symptoms:**
- Can see the "View inspections for: All Employees" dropdown (shows frontend recognizes admin role)
- Cannot see the list of everyone's inspections (cached session has old employee role)

**Diagnosis:**
```bash
$ npx tsx scripts/diagnose-user-permissions.ts

✅ User has role_id: 42a7082d-1d49-49c8-abb2-547b0ea5e011
   Role name: admin
   Display name: Administrator
✅ Role has is_manager_admin = true
   → User SHOULD be able to see all inspections
```

**Solution:**
Andy needed to log out and log back in to refresh his session.

## Prevention: Design Considerations

### Option 1: Auto-Detect Role Changes

Add a periodic check that compares cached role vs. database role:

```typescript
// In useAuth hook
useEffect(() => {
  const interval = setInterval(async () => {
    if (user) {
      const { data } = await supabase
        .from('profiles')
        .select('role_id')
        .eq('id', user.id)
        .single();
      
      if (data && data.role_id !== profile?.role_id) {
        // Role changed - force re-fetch
        fetchProfile(user.id);
      }
    }
  }, 60000); // Check every minute
  
  return () => clearInterval(interval);
}, [user, profile]);
```

### Option 2: Realtime Subscription

Subscribe to profile changes:

```typescript
useEffect(() => {
  if (!user) return;
  
  const channel = supabase
    .channel('profile_changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.id}`,
      },
      (payload) => {
        // Profile changed - force re-fetch
        fetchProfile(user.id);
      }
    )
    .subscribe();
  
  return () => {
    supabase.removeChannel(channel);
  };
}, [user]);
```

### Option 3: Show Warning Banner

When admin changes a user's role, show a banner:

```typescript
toast.warning('Role Updated', {
  description: 'User must log out and back in to see new permissions.',
  duration: 10000,
});
```

## Checklist: Changing User Roles

When changing a user's role as an admin:

- [ ] Update the user's `role_id` in the `profiles` table
- [ ] Verify the role has correct permissions (`is_manager_admin`, etc.)
- [ ] Notify the user they need to log out/in
- [ ] Run diagnostic script to confirm configuration
- [ ] Test with the actual user after they log back in

## Related Files

- `lib/hooks/useAuth.ts` - Authentication and profile fetching
- `scripts/diagnose-user-permissions.ts` - Diagnostic tool
- `app/(dashboard)/inspections/page.tsx` - Uses `isManager` flag

## Common Issues

### Issue: "I changed the role but user still can't see data"

**Check:**
1. Has the user logged out and back in?
2. Is browser cache cleared?
3. Run diagnostic script to verify database configuration
4. Check if role has correct `is_manager_admin` flag

### Issue: "User sees dropdown but no data"

**This is the session cache issue!**
- Frontend component partially updated (shows dropdown)
- But query still uses cached `isManager = false`
- Solution: Log out and back in

### Issue: "Admin role doesn't have manager permissions"

**Fix:**
```sql
UPDATE roles 
SET is_manager_admin = true 
WHERE name = 'admin';
```

Then user must log out/in to fetch updated role.

---

**Last Updated:** December 2, 2025  
**Related Issue:** Andy Hill - andy@avsquires.co.uk

