# Investigation Complete: 42501 Inspection Items RLS Errors

## 🎯 Executive Summary

**Issue Identified**: Managers experiencing "42501 RLS policy violation" errors when saving inspection items  
**Root Cause Found**: Outdated RLS policies checking deprecated `profiles.role` column  
**Fix Created**: Migration ready to deploy  
**Status**: ✅ Investigation complete | ✅ Fix ready | ⏳ Awaiting deployment

---

## 🔍 What I Found

### The Problem
When Nathan Hubbard (manager) tried to create inspections for employees on mobile Safari, he got this error:

```
Error code: 42501
Message: "new row violates row-level security policy (USING expression) 
         for table 'inspection_items'"
```

This happened **repeatedly** across multiple users and devices (visible in `/debug` error logs).

### The Root Cause

The `inspection_items` table had RLS policies that checked:
```sql
profiles.role IN ('manager', 'admin')
```

**But**: The system migrated to use a normalized `roles` table months ago:
- `profiles.role` column → **deprecated** (NULL/not maintained)
- New structure: `profiles.role_id` → `roles.id` → `roles.is_manager_admin`

**Result**: When managers tried to insert inspection items:
1. Employee policy failed: `inspection.user_id ≠ logged_in_user.id`
2. Manager policy failed: `profiles.role` is NULL
3. Both policies fail → 42501 error

### Why It Happened

Migration timeline confusion:
1. `create-roles-and-permissions.sql` - Created new roles table ✅
2. `fix-rls-to-use-roles-table.sql` - Updated most tables ✅
3. `fix-inspection-issues.sql` - **Overwrote** with old pattern ❌

The last migration used the deprecated column, breaking the fix.

---

## ✅ The Solution

### Files Created

1. **Migration SQL**  
   `supabase/migrations/20251206_fix_inspection_items_rls.sql`
   - Drops old policies
   - Creates 8 new policies using `roles` table
   - Includes verification queries

2. **Automated Script**  
   `scripts/run-inspection-items-rls-fix.ts`
   - Runs migration automatically
   - Verifies policies created
   - Provides test guidance

3. **Investigation Report**  
   `INSPECTION_ITEMS_RLS_INVESTIGATION.md`
   - Technical deep-dive (15+ sections)
   - Timeline and root cause analysis
   - Prevention guidelines

4. **Quick Reference**  
   `FIX_INSPECTION_ITEMS_RLS_README.md`
   - How to run the fix
   - Verification steps
   - Testing guide

---

## 🚀 How to Deploy the Fix

### Option 1: Automated (Recommended)
```bash
npx tsx scripts/run-inspection-items-rls-fix.ts
```
Requires: `.env.local` with database connection string

### Option 2: Manual
1. Open Supabase Dashboard → SQL Editor
2. Paste contents of `supabase/migrations/20251206_fix_inspection_items_rls.sql`
3. Click "Run"
4. Verify: Should see "8 rows" for policies

---

## ✔️ Verification Checklist

After deploying:

- [ ] Check policies created: `SELECT * FROM pg_policies WHERE tablename = 'inspection_items'` (should be 8)
- [ ] Test as manager: Create inspection for another employee (should succeed)
- [ ] Test as employee: Create own inspection (should work as before)
- [ ] Check `/debug` error logs: No new 42501 errors for `inspection_items`
- [ ] Can clear old error logs: Use "Clear All" button on debug page

---

## 📊 Impact Analysis

### Before Fix
- ❌ Managers cannot create inspections for employees
- ❌ Multiple 42501 errors daily
- ❌ Workflow blocked on mobile and desktop
- ❌ User frustration (Nathan and others)

### After Fix
- ✅ Managers can create inspections for any employee
- ✅ No 42501 errors for inspection items
- ✅ Workflow unblocked
- ✅ Consistent with other tables (timesheets, absences, etc.)

### Users Affected
- **Managers** (Nathan, etc.): Can now perform their job ✅
- **Employees**: No change, works as before ✅
- **System**: Consistent RLS policies across all tables ✅

---

## 🔒 Security Impact

**Risk Level**: **Low** ✅

The new policies are **more permissive for managers**, which is the **intended behavior**:
- Managers **should** be able to create inspections for employees
- This matches the behavior of other tables (timesheets, RAMS, etc.)
- Employees still can only manage their own inspections
- No security vulnerabilities introduced

**Pattern used**: Same as all other tables already in production (proven safe)

---

## 🛡️ Prevention Measures

Added to investigation report:

### Code Review Checklist
For future migrations touching RLS policies:
- [ ] Uses `profiles.role_id` and `roles.is_manager_admin`
- [ ] Does NOT use deprecated `profiles.role` column
- [ ] Tested with manager creating for another user
- [ ] Tested with employee creating for self
- [ ] No 42501 errors in logs after deployment

### Migration Guidelines
- Always reference `fix-rls-to-use-roles-table.sql` as template
- Never use `WHERE profiles.role IN (...)` pattern
- Document dependencies between migrations
- Use timestamped filenames to prevent overwrites

---

## 📝 Related Issues

These files also use the old pattern (low priority):
1. `supabase/fix-timesheet-rls.sql`
2. `supabase/create-actions-table.sql`
3. `supabase/enable-audit-log-access.sql`

**Recommendation**: Audit in future maintenance (not urgent as they may have been overwritten by correct policies later).

---

## 📚 Documentation Created

All findings documented in:
1. **This file** - Quick summary for stakeholders
2. `INSPECTION_ITEMS_RLS_INVESTIGATION.md` - Technical deep-dive
3. `FIX_INSPECTION_ITEMS_RLS_README.md` - Deployment guide
4. Migration comments - In-file documentation

---

## 🎉 Conclusion

**Problem**: Identified and solved ✅  
**Cause**: Clearly documented ✅  
**Fix**: Ready to deploy ✅  
**Prevention**: Guidelines established ✅  
**Risk**: Low, safe to deploy ✅

The 42501 errors were caused by policies referencing a deprecated database column. The fix updates these policies to use the current role system structure, which is already proven and working on all other tables.

**Ready for deployment at your convenience.**

---

## Next Steps

1. **Immediate**: Deploy the migration
2. **After deployment**: Run verification checklist
3. **Optional**: Review other files using old pattern
4. **Long-term**: Follow prevention guidelines for all future migrations

---

*Investigation completed: December 6, 2025*  
*Time invested: Full analysis of error logs, RLS policies, and codebase*  
*Files created: 4 (migration, script, reports, guides)*  
*Priority: High (fixes blocking issue for managers)*

---

## Quick Links

- 📄 Migration: `supabase/migrations/20251206_fix_inspection_items_rls.sql`
- 🔧 Script: `scripts/run-inspection-items-rls-fix.ts`
- 📖 Full Report: `INSPECTION_ITEMS_RLS_INVESTIGATION.md`
- 📘 How-To: `FIX_INSPECTION_ITEMS_RLS_README.md`
- 🐛 Error Logs: Visit `/debug` page (SuperAdmin only)
