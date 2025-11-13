# Reports System - Database Fixes

**Date:** October 24, 2025  
**Status:** ✅ Fixed

---

## Issues Found and Resolved

### 1. ❌ **Database Foreign Key Mismatch**

**Error:**
```
Could not find a relationship between 'timesheets' and 'profiles' in the schema cache
Searched for 'timesheets_employee_id_fkey' but not found
```

**Root Cause:**
The API routes were referencing a foreign key `timesheets_employee_id_fkey` that doesn't exist. The actual database schema uses `user_id` as the foreign key column name, not `employee_id`.

**Fix Applied:**
Updated all report API routes to use correct foreign key relationships:
- `timesheets_employee_id_fkey` → `timesheets_user_id_fkey`
- `vehicle_inspections_inspector_id_fkey` → `vehicle_inspections_user_id_fkey`

### 2. ❌ **Incorrect Column Names**

**Issues:**
- Referenced `employee_id` column in timesheets (doesn't exist)
- Referenced `registration_number` in vehicles (actual column is `reg_number`)
- Referenced `make_model` in vehicles (not in current schema)
- Referenced `start_time`, `finish_time`, `hours` (actual columns are `time_started`, `time_finished`, `daily_total`)

**Fix Applied:**
Updated all API route queries to match actual database schema:
- `employee_id` → `user_id` (for filtering)
- `registration_number` → `reg_number`
- `make_model` → removed/replaced with `vehicle_type`
- `start_time` → `time_started`
- `finish_time` → `time_finished`  
- `hours` → `daily_total`

### 3. ❌ **Day of Week Conversion**

**Issue:**
Code tried to use `day_of_week.substring(0, 3)` but `day_of_week` is an INTEGER (1-7), not a string.

**Fix Applied:**
Added day name lookup array:
```typescript
const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayName = dayNames[entry.day_of_week] || '';
const day = dayName.substring(0, 3); // Mon, Tue, etc.
```

### 4. ✅ **UI Cleanup**

**Removed:**
- "Report Usage Tips" section from Reports page (as requested)

---

## Files Modified

### API Routes Fixed (4 files)
✅ `app/api/reports/timesheets/summary/route.ts`
- Fixed foreign key reference
- Fixed column names in SELECT query
- Fixed column names in filter conditions
- Fixed day_of_week conversion logic

✅ `app/api/reports/timesheets/payroll/route.ts`
- Fixed foreign key reference
- Fixed filter column name

✅ `app/api/reports/inspections/compliance/route.ts`
- Fixed foreign key references (both vehicle and inspector)
- Fixed vehicle column names throughout

✅ `app/api/reports/inspections/defects/route.ts`
- Fixed foreign key references (both vehicle and inspector)
- Fixed vehicle column names throughout

### UI Updated (1 file)
✅ `app/(dashboard)/reports/page.tsx`
- Removed "Report Usage Tips" help section

---

## Testing Required

After these fixes, the following should now work:

### ✅ Test Timesheet Reports
```bash
# With dev server running
# Navigate to /reports
# Click "Excel" button for Timesheet Summary
# Should download without errors
```

### ✅ Test Payroll Report
```bash
# Navigate to /reports
# Click "Excel" button for Payroll Export
# Should download without errors
```

### ✅ Test Inspection Reports
```bash
# Navigate to /reports
# Click "Excel" button for Compliance Summary
# Click "Excel" button for Defects Log
# Both should download without errors
```

### ✅ Test Statistics API
```bash
# Statistics should load on page visit
# Numbers should appear in stat cards (not "--")
```

---

## Database Schema Alignment

### Verified Column Names

**timesheets table:**
- ✅ `user_id` (UUID) - foreign key to profiles
- ✅ `week_ending` (DATE)
- ✅ `status` (TEXT)
- ✅ `total_hours` (calculated field)

**timesheet_entries table:**
- ✅ `timesheet_id` (UUID)
- ✅ `day_of_week` (INTEGER 1-7)
- ✅ `time_started` (TIME)
- ✅ `time_finished` (TIME)
- ✅ `daily_total` (DECIMAL)
- ✅ `working_in_yard` (BOOLEAN)
- ✅ `did_not_work` (BOOLEAN)

**vehicle_inspections table:**
- ✅ `vehicle_id` (UUID) - foreign key to vehicles
- ✅ `user_id` (UUID) - foreign key to profiles
- ✅ `inspection_date` (DATE)
- ✅ `status` (TEXT)

**vehicles table:**
- ✅ `id` (UUID)
- ✅ `reg_number` (TEXT)
- ✅ `vehicle_type` (TEXT)

**profiles table:**
- ✅ `id` (UUID)
- ✅ `full_name` (TEXT)
- ✅ `employee_id` (TEXT)

---

## No Database Migration Needed

✅ **Good news:** No database changes required!

All issues were in the API route code, not in the database schema. The database schema is correct as-is. The API routes were simply using wrong column names and foreign key hints.

---

## Status

✅ **All Issues Fixed**  
✅ **No Database Migration Required**  
✅ **UI Cleaned Up**  
✅ **Ready for Testing**

---

## Next Steps

1. **Reload the dev server** (if running):
   ```bash
   # Press Ctrl+C to stop
   npm run dev
   ```

2. **Test in browser:**
   - Navigate to http://localhost:3000/reports
   - Log in as admin or manager
   - Verify statistics load
   - Try downloading each report

3. **Run automated tests:**
   ```bash
   npm run test:reports
   ```

4. **Deploy to production** once verified working locally

---

**All fixes complete!** 🎉

