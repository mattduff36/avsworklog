# Timesheet RLS Policy Fix

## Problem
When managers/admins try to edit and submit timesheets on behalf of employees, they encounter a "Permission denied" error. This is because the Row Level Security (RLS) policies don't allow managers to delete and insert timesheet entries.

## Solution
Run the SQL migration file `fix-timesheet-rls.sql` in your Supabase SQL Editor to update the RLS policies.

## Steps to Apply the Fix

1. Open your Supabase project dashboard
2. Navigate to the SQL Editor
3. Open the file `supabase/fix-timesheet-rls.sql`
4. Copy and paste the entire SQL script into the SQL Editor
5. Click "Run" to execute the script
6. Verify the policies were created successfully (you should see "Timesheet RLS policies fixed successfully!")

## What This Fix Does

The migration:
- Updates timesheet RLS policies to allow managers/admins to create, update, and manage timesheets for any employee
- Adds DELETE policies for timesheet_entries so managers can delete entries when updating timesheets
- Adds INSERT policies for timesheet_entries so managers can insert entries when creating/updating timesheets
- Allows users to update their own rejected timesheets (in addition to drafts)

## After Applying the Fix

Once the migration is applied, managers and admins will be able to:
- Edit draft timesheets for any employee
- Submit timesheets on behalf of employees
- Update timesheet entries without permission errors

