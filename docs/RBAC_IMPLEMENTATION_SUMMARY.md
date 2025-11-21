# Role-Based Access Control (RBAC) Implementation Summary

## Overview
Comprehensive RBAC system has been implemented to control user access to different modules based on their job role.

## What's Been Implemented

### Phase 1: Database Schema ✅
- **New Tables:**
  - `roles` - Stores job roles (admin, manager, employee-civils, etc.)
  - `role_permissions` - Stores which modules each role can access
  
- **Schema Changes:**
  - Added `role_id` foreign key to `profiles` table (references new `roles` table)
  - Added `is_super_admin` boolean to `profiles` for super admin protection
  - Preserved existing `role` text column for backward compatibility
  
- **Migrations:**
  - Full database backup created before migration
  - Existing roles migrated to new structure with preserved permissions
  - Super admin configured for `admin@mpdee.co.uk`
  - RLS policies added to protect super admin account

### Phase 2: Backend APIs & Types ✅
- **TypeScript Types** (`types/roles.ts`):
  - Role, RolePermission, RoleWithPermissions interfaces
  - ModuleName type covering all 10 modules
  - Module display names and descriptions
  - API request/response types
  
- **Utility Functions** (`lib/utils/permissions.ts`):
  - `userHasPermission()` - Check if user can access module
  - `getUserPermissions()` - Get all user permissions
  - `isManagerOrAdmin()` - Check manager/admin status
  - `isSuperAdmin()` - Check super admin status
  - `getUsersWithPermission()` - Filter users by module access
  - `validateUserAssignment()` - Validate assignment permissions
  
- **API Endpoints:**
  - `GET /api/admin/roles` - List all roles
  - `POST /api/admin/roles` - Create new role
  - `GET /api/admin/roles/[id]` - Get role details
  - `PATCH /api/admin/roles/[id]` - Update role
  - `DELETE /api/admin/roles/[id]` - Delete role
  - `PUT /api/admin/roles/[id]/permissions` - Update permissions

### Phase 3: Frontend UI ✅
- **Role Management Interface** (`components/admin/RoleManagement.tsx`):
  - View all roles with user counts and permission counts
  - Add new roles with name, display name, and description
  - Edit role details
  - Delete roles (with safety checks)
  - Manage permissions with toggle switches
  - Visual indicators for super admin and manager/admin roles
  - Protection: Cannot modify/delete super admin or manager/admin roles
  
- **Admin Users Page Updates:**
  - Added "Roles" tab alongside "Users" tab
  - Tab navigation with clean UI
  - Integrated Role Management component
  
- **UI Components Created:**
  - Switch component for permission toggles
  - Permission matrix with module descriptions

### Phase 4: Permission Enforcement ✅
- **Dashboard Cards** (`app/(dashboard)/dashboard/page.tsx`):
  - Fetch user permissions on mount
  - Filter dashboard cards based on module access
  - Managers and admins see all cards
  - Employees only see cards they have permission for
  
- **User Dropdowns Filtered:**
  - **Timesheets** (`app/(dashboard)/timesheets/new/page.tsx`):
    - Only shows employees with 'timesheets' permission
  - **Inspections** (`app/(dashboard)/inspections/new/page.tsx`):
    - Only shows employees with 'inspections' permission
  - **RAMS Assignment** (`components/rams/AssignEmployeesModal.tsx`):
    - Only shows employees with 'rams' permission
    
- **Page Protection:**
  - Created `usePermissionCheck` hook for page-level protection
  - Applied to timesheets page as example
  - Shows loading spinner while checking permissions
  - Auto-redirects to dashboard with error toast if unauthorized
  - Prevents flash of unauthorized content

## Modules Covered
The RBAC system controls access to these 10 modules:
1. **Timesheets** - Weekly time tracking
2. **Inspections** - Vehicle inspections
3. **RAMS** - Risk Assessment & Method Statements
4. **Absence** - Absence & Leave requests
5. **Toolbox Talks** - Receiving toolbox talk messages
6. **Approvals** - Manager/admin approval interface
7. **Actions** - Manager/admin action tracking
8. **Reports** - Manager/admin reports
9. **Admin Users** - Admin user management
10. **Admin Vehicles** - Admin vehicle management

## Default Permissions
- **New Roles:** Employee-facing modules (timesheets, inspections, RAMS, absence, toolbox-talks) enabled by default
- **Manager/Admin Roles:** Always have full access to all modules
- **Super Admin:** Cannot be modified or locked out (`admin@mpdee.co.uk`)

## Super Admin Protection
- Only `admin@mpdee.co.uk` is marked as super admin
- Super admin profile cannot be edited or deleted
- Super admin password cannot be changed/reset by other admins
- RLS policies prevent modification of super admin flag

## What Still Needs To Be Done

### 1. Apply Permission Checks to Remaining Pages
The `usePermissionCheck` hook needs to be applied to:
- `/inspections/page.tsx` - Check 'inspections' permission
- `/rams/page.tsx` - Check 'rams' permission
- `/absence/page.tsx` - Check 'absence' permission
- `/approvals/page.tsx` - Check 'approvals' permission
- `/actions/page.tsx` - Check 'actions' permission
- `/reports/page.tsx` - Check 'reports' permission
- `/admin/users/page.tsx` - Check 'admin-users' permission
- `/admin/vehicles/page.tsx` - Check 'admin-vehicles' permission

**Pattern:**
```typescript
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';

export default function YourPage() {
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('module-name');
  
  if (permissionLoading) {
    return <LoadingSpinner />;
  }
  
  if (!hasPermission) {
    return null; // Hook handles redirect
  }
  
  // Rest of component...
}
```

### 2. Navigation Filtering (Optional)
Currently, navigation links are visible to all users. Consider:
- Hiding nav links based on permissions
- Apply in `components/layout/Navbar.tsx` and `components/layout/SidebarNav.tsx`
- Use `getUserPermissions()` to check access

### 3. Backend API Validation (Optional but Recommended)
Add permission checks to API routes:
- Check if assigned user has permission before creating timesheet/inspection/RAMS
- Example: Check if user has 'timesheets' permission before creating timesheet for them
- Use `userHasPermission()` and `validateUserAssignment()` utilities

### 4. Update User Role Selection
When creating/editing users in `/admin/users`:
- Instead of hardcoded role dropdown, fetch from `roles` table
- Use new role structure (role_id instead of role text)
- This allows custom roles to be used

### 5. Testing
See `RBAC_TESTING_GUIDE.md` for comprehensive testing steps

## Key Files Modified

### Database
- `supabase/create-roles-and-permissions.sql` - Migration script
- `supabase/fix-super-admin.sql` - Super admin fix
- `scripts/run-roles-migration.ts` - Migration runner
- `scripts/backup-database.ts` - Backup script

### Types & Utils
- `types/roles.ts` - Type definitions
- `lib/utils/permissions.ts` - Permission utilities
- `lib/hooks/usePermissionCheck.ts` - Page protection hook

### Backend
- `app/api/admin/roles/route.ts` - List/create roles
- `app/api/admin/roles/[id]/route.ts` - Get/update/delete role
- `app/api/admin/roles/[id]/permissions/route.ts` - Update permissions

### Frontend
- `components/admin/RoleManagement.tsx` - Role management UI
- `components/ui/switch.tsx` - Toggle switch component
- `app/(dashboard)/admin/users/page.tsx` - Added roles tab
- `app/(dashboard)/dashboard/page.tsx` - Permission-filtered cards
- `app/(dashboard)/timesheets/page.tsx` - Permission check example
- `app/(dashboard)/timesheets/new/page.tsx` - Filtered dropdown
- `app/(dashboard)/inspections/new/page.tsx` - Filtered dropdown
- `components/rams/AssignEmployeesModal.tsx` - Filtered employees

## Important Notes

1. **Managers and Admins:** Always have full access regardless of role permissions
2. **Super Admin:** Only `admin@mpdee.co.uk` - cannot be locked out
3. **Backward Compatibility:** Old `role` text column preserved but not actively used
4. **Default Access:** New roles default to employee-facing modules enabled
5. **Deletion Protection:** Cannot delete roles with assigned users
6. **Visitor Signatures:** RAMS visitor signatures bypass permission system

## Testing Priority

### Critical Tests:
1. ✅ Super admin cannot be modified by other admins
2. ✅ Roles can be created/edited/deleted
3. ✅ Permissions can be updated
4. ✅ Dashboard shows only permitted cards for employees
5. ✅ Employee dropdowns only show users with access
6. ⚠️ Permission checks redirect unauthorized access

### Medium Priority:
7. ⚠️ Navigation hides links user doesn't have access to
8. ⚠️ API routes validate permissions before assignments
9. ⚠️ All protected pages use permission check hook

### Low Priority:
10. User role dropdown uses new role structure
11. Audit existing users have correct permissions

## Migration Notes
- Database backup created: `backups/full_database_backup_[timestamp].sql`
- Migration is reversible (can re-run if needed)
- All existing user roles preserved with current permissions
- No data loss occurred during migration

## Security Considerations
- RLS policies protect super admin profile
- Frontend permission checks prevent UI access
- Backend validation (when implemented) will prevent API bypass
- Managers/admins trusted with full system access
- Super admin email should never be changed without code update

## Support
For issues or questions:
1. Check `docs/RBAC_TESTING_GUIDE.md` for testing procedures
2. Review `lib/utils/permissions.ts` for permission logic
3. Check database migrations for schema details
4. Verify RLS policies are active on production database

