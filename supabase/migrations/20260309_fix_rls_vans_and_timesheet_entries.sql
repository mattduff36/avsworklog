-- Fix missing INSERT RLS policies for vans and timesheet_entries tables
-- These were defined in non-migration scripts but never applied through migrations.
-- See error patterns: "new row violates row-level security policy for table 'vans'"
-- and "new row violates row-level security policy for table 'timesheet_entries'"

-- ===== vans: allow any authenticated user to add a van from inspection forms =====
DROP POLICY IF EXISTS "Users can add vans" ON vans;
CREATE POLICY "Users can add vans" ON vans
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
  );

-- ===== timesheet_entries: allow users to insert their own entries =====
DROP POLICY IF EXISTS "Users can insert own timesheet entries" ON timesheet_entries;
CREATE POLICY "Users can insert own timesheet entries"
  ON timesheet_entries
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
      AND timesheets.user_id = auth.uid()
    )
  );

-- ===== timesheet_entries: allow managers/admins to insert entries for any user =====
DROP POLICY IF EXISTS "Managers can insert any timesheet entries" ON timesheet_entries;
CREATE POLICY "Managers can insert any timesheet entries"
  ON timesheet_entries
  FOR INSERT
  WITH CHECK (
    effective_is_manager_admin()
  );
