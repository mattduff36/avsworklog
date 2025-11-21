# RBAC System Testing Guide

## Pre-Testing Setup

### 1. Verify Database Migration
```sql
-- Check roles table exists and has data
SELECT * FROM roles ORDER BY is_super_admin DESC, is_manager_admin DESC;

-- Check role_permissions table
SELECT r.name, rp.module_name, rp.enabled 
FROM roles r 
LEFT JOIN role_permissions rp ON r.id = rp.role_id 
ORDER BY r.name, rp.module_name;

-- Check profiles have role_id
SELECT id, full_name, role, role_id, is_super_admin 
FROM profiles 
LIMIT 10;
```

### 2. Create Test Users
Create test users with different roles:
1. **Test Employee (Civils)** - Regular employee with limited access
2. **Test Employee (Transport)** - Employee with different permissions
3. **Test Manager** - Manager with full access
4. **Test Admin** - Admin (not super admin)

## Testing Checklist

### Part 1: Role Management UI ✅

#### Test 1.1: View Roles
- [ ] Login as Admin (`admin@mpdee.co.uk`)
- [ ] Navigate to Admin → Users
- [ ] Click "Roles" tab
- [ ] Verify all roles are listed
- [ ] Verify user counts are correct
- [ ] Verify permission counts show correctly
- [ ] Verify super admin badge shows for Admin role
- [ ] Verify manager/admin badges show correctly

#### Test 1.2: Create New Role
- [ ] Click "Add Role" button
- [ ] Enter role name: `employee-test`
- [ ] Enter display name: `Employee - Test Department`
- [ ] Enter description: `Test department role`
- [ ] Leave "Manager/Admin Role" OFF
- [ ] Click "Create Role"
- [ ] Verify role appears in list
- [ ] Verify default permissions are set (employee modules enabled)

#### Test 1.3: Edit Role
- [ ] Click edit icon on `employee-test` role
- [ ] Change display name to: `Employee - Test Dept`
- [ ] Update description
- [ ] Click "Save Changes"
- [ ] Verify changes appear in list

#### Test 1.4: Manage Permissions
- [ ] Click lock icon on `employee-test` role
- [ ] Verify all 10 modules are listed with descriptions
- [ ] Disable "Inspections" module
- [ ] Enable "Reports" module
- [ ] Click "Save Permissions"
- [ ] Verify success message
- [ ] Re-open permissions dialog
- [ ] Verify changes persisted

#### Test 1.5: Delete Role
- [ ] Try to delete a role with assigned users
- [ ] Verify error message prevents deletion
- [ ] Try to delete `employee-test` role (no users)
- [ ] Verify success message
- [ ] Verify role removed from list

#### Test 1.6: Super Admin Protection
- [ ] Try to edit super admin role
- [ ] Verify edit button is disabled
- [ ] Try to delete super admin role
- [ ] Verify delete button is disabled
- [ ] Try to manage super admin permissions
- [ ] Verify permissions button is disabled

### Part 2: Dashboard Permission Filtering ✅

#### Test 2.1: Employee with Limited Access
- [ ] Create employee with only "Timesheets" and "Absence" enabled
- [ ] Login as that employee
- [ ] Navigate to Dashboard
- [ ] Verify ONLY Timesheets and Absence cards show
- [ ] Verify Inspections card is hidden
- [ ] Verify RAMS card is hidden
- [ ] Verify no error messages

#### Test 2.2: Employee with Full Access
- [ ] Create employee with all modules enabled
- [ ] Login as that employee
- [ ] Navigate to Dashboard
- [ ] Verify all employee cards show
- [ ] Verify no admin cards show (Users, Vehicles)

#### Test 2.3: Manager Full Access
- [ ] Login as Manager
- [ ] Navigate to Dashboard
- [ ] Verify all cards show (including admin cards)
- [ ] Verify no permission restrictions

### Part 3: User Dropdown Filtering ✅

#### Test 3.1: Timesheets Dropdown
- [ ] Login as Manager
- [ ] Navigate to Timesheets → Create New
- [ ] Open "For Employee" dropdown
- [ ] Verify only employees with "Timesheets" permission show
- [ ] Disable "Timesheets" for an employee
- [ ] Refresh dropdown
- [ ] Verify that employee no longer appears

#### Test 3.2: Inspections Dropdown
- [ ] Navigate to Inspections → Create New
- [ ] Open employee dropdown
- [ ] Verify only employees with "Inspections" permission show
- [ ] Test with employee who has inspections disabled
- [ ] Verify they don't appear in list

#### Test 3.3: RAMS Assignment
- [ ] Navigate to RAMS → Manage
- [ ] Open a RAMS document
- [ ] Click "Assign RAMS Document"
- [ ] Verify only employees with "RAMS" permission show
- [ ] Test with employee who has RAMS disabled
- [ ] Verify they don't appear in assignment modal

### Part 4: Page-Level Protection ⚠️

#### Test 4.1: Timesheets Page Protection
- [ ] Create employee with "Timesheets" disabled
- [ ] Login as that employee
- [ ] Try to navigate to `/timesheets`
- [ ] Verify immediate redirect to dashboard
- [ ] Verify error toast: "You don't have access to timesheets"
- [ ] Verify no flash of unauthorized content

#### Test 4.2: Direct URL Access
- [ ] While logged in as employee with "RAMS" disabled
- [ ] Manually enter URL: `/rams` in browser
- [ ] Verify redirect to dashboard
- [ ] Verify error message
- [ ] Try `/rams/manage`
- [ ] Verify same behavior

#### Test 4.3: Manager Bypass
- [ ] Login as Manager
- [ ] Navigate to any module URL
- [ ] Verify no redirects
- [ ] Verify full access

### Part 5: Assignment Prevention ✅

#### Test 5.1: Cannot Assign Tasks to Restricted Users
- [ ] Disable "Timesheets" for Employee A
- [ ] Login as Manager
- [ ] Try to create timesheet for Employee A
- [ ] Verify Employee A doesn't appear in dropdown
- [ ] Enable "Timesheets" for Employee A
- [ ] Verify Employee A now appears

#### Test 5.2: Existing Assignments
- [ ] Assign a timesheet to Employee B
- [ ] Disable "Timesheets" for Employee B
- [ ] Verify Employee B can still view their existing timesheet
- [ ] Verify Manager cannot create NEW timesheet for Employee B

### Part 6: Super Admin Protection 🔒

#### Test 6.1: Password Reset Protection
- [ ] Login as regular Admin (not super admin)
- [ ] Navigate to Admin → Users
- [ ] Find `admin@mpdee.co.uk` (super admin)
- [ ] Try to reset password
- [ ] Verify action is blocked or doesn't work
- [ ] Verify super admin can still login

#### Test 6.2: Profile Modification
- [ ] As regular Admin, try to edit super admin profile
- [ ] Verify fields are disabled or save fails
- [ ] As regular Admin, try to delete super admin
- [ ] Verify action is blocked

#### Test 6.3: Role Change
- [ ] As regular Admin, try to change super admin's role
- [ ] Verify action is blocked
- [ ] Verify `is_super_admin` flag cannot be changed

### Part 7: Edge Cases & Error Handling

#### Test 7.1: No Permissions
- [ ] Create employee with ALL modules disabled
- [ ] Login as that employee
- [ ] Navigate to Dashboard
- [ ] Verify only welcome header shows
- [ ] Verify no cards displayed
- [ ] Verify no errors

#### Test 7.2: Role Deletion with Users
- [ ] Create role "test-role"
- [ ] Assign user to "test-role"
- [ ] Try to delete "test-role"
- [ ] Verify error: "Cannot delete role: X user(s) are assigned"
- [ ] Remove user assignment
- [ ] Verify deletion now succeeds

#### Test 7.3: Concurrent Access
- [ ] Login as Employee on Browser 1
- [ ] Login as Admin on Browser 2
- [ ] As Admin, disable "Timesheets" for Employee
- [ ] As Employee, navigate to Timesheets page
- [ ] Verify permission check catches the change
- [ ] Verify redirect occurs

#### Test 7.4: Session Timeout
- [ ] Login as Employee
- [ ] Wait for session to expire
- [ ] Try to access protected page
- [ ] Verify redirect to login
- [ ] Verify no permission errors before auth check

## Common Issues & Solutions

### Issue 1: "Could not find the table" error
**Solution:** Database schema cache issue. Wait a few minutes or restart Supabase.

### Issue 2: All cards hidden on dashboard
**Solution:** Check user's role has permissions set. Run permission query to verify.

### Issue 3: Dropdown still shows restricted users
**Solution:** Clear browser cache or hard refresh (Ctrl+Shift+R).

### Issue 4: Permission check hook causes infinite loop
**Solution:** Check `useEffect` dependencies in hook implementation.

### Issue 5: Super admin can be modified
**Solution:** Verify RLS policies are active. Check `is_super_admin` flag is set.

## Database Verification Queries

```sql
-- Check user permissions
SELECT 
  p.full_name,
  r.name as role_name,
  rp.module_name,
  rp.enabled
FROM profiles p
JOIN roles r ON p.role_id = r.id
LEFT JOIN role_permissions rp ON r.id = rp.role_id
WHERE p.id = 'USER_ID_HERE'
ORDER BY rp.module_name;

-- Check role permission counts
SELECT 
  r.name,
  COUNT(rp.id) as total_permissions,
  SUM(CASE WHEN rp.enabled THEN 1 ELSE 0 END) as enabled_permissions
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
GROUP BY r.id, r.name
ORDER BY r.name;

-- Find users with specific permission
SELECT 
  p.id,
  p.full_name,
  p.role,
  r.name as role_name
FROM profiles p
JOIN roles r ON p.role_id = r.id
JOIN role_permissions rp ON r.id = rp.role_id
WHERE rp.module_name = 'timesheets'
  AND rp.enabled = true
ORDER BY p.full_name;

-- Check super admin
SELECT id, full_name, role, is_super_admin 
FROM profiles 
WHERE is_super_admin = true;
```

## Success Criteria

### Must Pass:
- ✅ All role CRUD operations work
- ✅ Permissions can be updated
- ✅ Dashboard filters cards by permission
- ✅ Dropdowns filter users by permission
- ⚠️ Page protection redirects unauthorized users
- 🔒 Super admin cannot be modified

### Should Pass:
- Role deletion prevents if users assigned
- Permission checks handle loading states
- No flash of unauthorized content
- Error messages are user-friendly

### Nice to Have:
- Navigation links hidden based on permissions
- Backend API validation
- Audit logs for permission changes

## Test Environments
- **Development:** Test freely with dummy data
- **Staging:** Test with production-like data
- **Production:** Test super admin protection ONLY

## Rollback Plan
If issues arise:
1. Restore database from backup (`backups/full_database_backup_*.sql`)
2. Revert Git commits to before RBAC implementation
3. Contact development team with error logs

## Reporting Issues
When reporting issues, include:
1. User role and permissions
2. Steps to reproduce
3. Expected vs actual behavior
4. Browser console errors
5. Database query results (if applicable)

