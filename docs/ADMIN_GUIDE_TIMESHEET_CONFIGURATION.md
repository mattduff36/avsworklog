# Admin Guide: Timesheet Type Configuration
**For:** Administrators & System Managers  
**Date:** December 17, 2025

---

## Overview

As an administrator, you can configure which timesheet format each job role uses. This allows different employee types (Civils, Plant, etc.) to use specialized timesheets tailored to their work.

---

## Quick Start

### Configuring Timesheet Types

1. Navigate to **Admin → Users** (`/admin/users`)
2. Click the **"Roles & Permissions"** tab
3. Find the role you want to configure
4. Click **"Edit"** button
5. Find the **"Timesheet Type"** dropdown
6. Select the appropriate type
7. Click **"Save Changes"**

Done! All employees with that role will now use the selected timesheet type.

---

## Available Timesheet Types

### **Civils Timesheet (Default)** ✅ Available Now

**Best for:** Civil engineering employees, general construction work

**Features:**
- Daily time tracking (Start/Finish)
- Job number entry (NNNN-LL format)
- "Working in Yard" option (no job number required)
- "Did Not Work" option
- Automatic bank holiday detection
- Automatic night shift detection (>9.5h starting after 3PM)
- Automatic lunch deduction (>6.5 hours)
- Notes/remarks per day
- Vehicle registration tracking
- Week ending validation (must be Sunday)
- Duplicate prevention

**When to use:**
- General employees
- Civil engineering roles
- Default for all roles unless specified

---

### **Plant Timesheet** 🚧 Coming Soon

**Best for:** Plant operators, heavy machinery operators

**Features:** *To be defined when implemented*

**Status:** Framework ready, component not yet built

**To implement:** Contact developer with requirements

---

## When to Change Timesheet Types

### **Common Scenarios:**

**Scenario 1: Adding New Employee Type**
- New department joins (e.g., Plant operators)
- Create new role: "Employee - Plant"
- Set timesheet type to "Plant" (when available)
- Assign employees to this role

**Scenario 2: Correcting Wrong Assignment**
- Employee complains about wrong form
- Check their role in Admin → Users
- Edit the role → change timesheet type
- Employee's next NEW timesheet will use correct type
- Existing drafts continue with original type

**Scenario 3: Splitting Existing Role**
- Role has mixed employee types
- Create new role (e.g., "Employee - Civils" and "Employee - Plant")
- Set different timesheet types
- Move users to correct roles

---

## Important Rules

### ⚠️ Things to Know:

1. **Role, Not User:**  
   You assign timesheet types to ROLES, not individual users.  
   All users with that role get the same timesheet type.

2. **New Timesheets Only:**  
   Changing a role's timesheet type affects future timesheets only.  
   Existing drafts continue with their original type.

3. **Fallback Behavior:**  
   If a timesheet type isn't implemented yet (e.g., Plant),  
   users see a warning and get the Civils timesheet instead.

4. **Manager Override:**  
   Managers CANNOT override timesheet type.  
   When creating for employees, system uses EMPLOYEE'S type.

5. **Cannot Disable:**  
   All roles must have a timesheet type.  
   Default is 'civils' if not specified.

---

## Step-by-Step: Configure a Role

### Example: Setting up Plant Operators

**Goal:** Create a role for Plant employees to use Plant timesheets (when available)

**Steps:**

1. **Go to Admin Panel**
   - URL: `/admin/users`
   - Click "Roles & Permissions" tab

2. **Create New Role**
   - Click "Add New Role" button
   - Fill in:
     - **Role Name:** `employee-plant`
     - **Display Name:** `Employee - Plant`
     - **Description:** `Plant operators and heavy machinery operators`
     - **Timesheet Type:** Select "Plant Timesheet"
     - **Manager/Admin:** OFF (unless they are)
   - Click "Create Role"

3. **Configure Permissions**
   - Role is created
   - Click "Permissions" on the new role
   - Enable: Timesheets, Inspections, RAMS (as needed)
   - Save permissions

4. **Assign Users**
   - Go to "Users" tab
   - Edit a user
   - Change their role to "Employee - Plant"
   - Save

5. **Verify**
   - Login as that user
   - Go to `/timesheets/new`
   - Should see Plant timesheet (or fallback warning if not implemented)

---

## Changing Existing Roles

### Example: Update "Employee - Civils" role

**Steps:**

1. **Navigate to Roles**
   - Admin → Users → Roles & Permissions tab

2. **Find the Role**
   - Locate "Employee - Civils" in the table

3. **Edit Role**
   - Click "Edit" button
   - Scroll to "Timesheet Type" dropdown
   - Currently shows: "Civils Timesheet (Default)"

4. **Change Type** (if needed)
   - Select different type
   - Read the description
   - Click "Save Changes"

5. **Communicate to Users**
   - Email affected employees
   - Explain the change
   - Provide training if needed

---

## Troubleshooting

### **Problem: User sees wrong timesheet**

**Solution:**
1. Check user's role: Admin → Users → find user
2. Check that role: Roles tab → find role → Edit
3. Verify timesheet type is correct
4. If correct but still wrong:
   - User may have cached old role
   - Ask them to log out and log back in
   - Or clear browser cache

### **Problem: Timesheet type won't save**

**Solution:**
1. Check browser console for errors
2. Verify you're admin (check top-right badge)
3. Try refreshing page and editing again
4. If persists, check database directly:
   ```sql
   SELECT id, name, timesheet_type FROM roles WHERE name = 'role-name';
   ```

### **Problem: "Coming soon" warning for Plant**

**This is expected behavior!**

Plant timesheet component isn't built yet. Users will see:
- Warning banner explaining situation
- Fallback to Civils timesheet
- Can still work normally

**To fix:** Developer needs to build PlantTimesheet component.

### **Problem: Old timesheets show errors**

**Likely cause:** Database migration didn't run

**Solution:**
1. Check database: `SELECT timesheet_type FROM timesheets LIMIT 5;`
2. Should show 'civils' for all
3. If column missing, run migration:
   ```bash
   npx tsx scripts/migrations/run-timesheet-types-migration.ts
   ```

---

## Best Practices

### ✅ DO:
- Test timesheet type changes with one user first
- Communicate changes to employees before rolling out
- Use descriptive role names (`employee-plant`, not just `plant`)
- Set timesheet type when creating new roles
- Document which roles use which timesheets

### ❌ DON'T:
- Change timesheet types frequently (confuses users)
- Create roles without setting timesheet type (will default to civils)
- Forget to enable timesheet permission for new roles
- Mix employee types in one role

---

## Adding New Timesheet Types (Future)

### When Plant Timesheet is Ready:

**As Admin:**
1. Developer will implement PlantTimesheet component
2. You'll be notified
3. Edit roles that need Plant timesheet
4. Change dropdown to "Plant Timesheet"
5. Users automatically get new form

**No code deployment needed on your part!**

---

## Support & Questions

### Common Questions:

**Q: Can one user have multiple timesheet types?**  
A: No. Each user has one role, each role has one timesheet type.

**Q: Can I create custom timesheet types?**  
A: Not via UI. Developer must build the component first.

**Q: What if I set wrong type?**  
A: Just edit the role and change it. Future timesheets use new type.

**Q: Do existing submitted timesheets change?**  
A: No. Only future NEW timesheets are affected.

**Q: Can managers have different timesheet than employees?**  
A: Yes! Managers can have their own role with different type.

---

## Summary

**Key Points:**
- Configure timesheet types per ROLE (not per user)
- Changes affect future timesheets only
- Fallback to Civils if type not available
- Easy to change anytime
- Communicate changes to users

**Support:**
- Technical issues: Contact developer
- User training: Use testing checklist
- Questions: Refer to this guide

---

*Last Updated: December 17, 2025*
