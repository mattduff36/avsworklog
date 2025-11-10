-- Fix RLS policies for timesheets to allow managers to create timesheets for employees
-- This migration fixes permission issues for both employees and managers

-- Drop existing policies (handle both old and new policy names)
DROP POLICY IF EXISTS "Users can view own timesheets" ON timesheets;
DROP POLICY IF EXISTS "Employees can view own timesheets" ON timesheets;
DROP POLICY IF EXISTS "Users can create own timesheets" ON timesheets;
DROP POLICY IF EXISTS "Employees can create own timesheets" ON timesheets;
DROP POLICY IF EXISTS "Users can update own timesheets" ON timesheets;
DROP POLICY IF EXISTS "Employees can update own timesheets" ON timesheets;
DROP POLICY IF EXISTS "Managers can view all timesheets" ON timesheets;
DROP POLICY IF EXISTS "Managers can update all timesheets" ON timesheets;
DROP POLICY IF EXISTS "Managers can update timesheets for approval" ON timesheets;
DROP POLICY IF EXISTS "Managers can create timesheets for any user" ON timesheets;

-- Users can view their own timesheets
CREATE POLICY "Users can view own timesheets"
  ON timesheets
  FOR SELECT
  USING (user_id = auth.uid());

-- Managers and admins can view all timesheets
CREATE POLICY "Managers can view all timesheets"
  ON timesheets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Users can create their own timesheets
CREATE POLICY "Users can create own timesheets"
  ON timesheets
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Managers and admins can create timesheets for any user
CREATE POLICY "Managers can create timesheets for any user"
  ON timesheets
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Users can update their own draft or rejected timesheets
-- USING checks the current row (before update), WITH CHECK allows status change to submitted
CREATE POLICY "Users can update own timesheets"
  ON timesheets
  FOR UPDATE
  USING (user_id = auth.uid() AND status IN ('draft', 'rejected'))
  WITH CHECK (user_id = auth.uid());

-- Managers and admins can update any timesheet
CREATE POLICY "Managers can update all timesheets"
  ON timesheets
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Fix timesheet_entries policies similarly
-- Drop all existing policies (including the old "FOR ALL" policy)
DROP POLICY IF EXISTS "Users can manage own timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Users can view own timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Users can create own timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Users can insert own timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Users can update own timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Users can delete own timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Managers can view all timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Managers can insert any timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Managers can update all timesheet entries" ON timesheet_entries;
DROP POLICY IF EXISTS "Managers can delete any timesheet entries" ON timesheet_entries;

-- Users can view their own timesheet entries
CREATE POLICY "Users can view own timesheet entries"
  ON timesheet_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
      AND timesheets.user_id = auth.uid()
    )
  );

-- Managers can view all timesheet entries
CREATE POLICY "Managers can view all timesheet entries"
  ON timesheet_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Users can insert their own timesheet entries
-- This allows inserting entries even when submitting (status changes from draft to submitted)
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

-- Managers can insert timesheet entries for any timesheet
CREATE POLICY "Managers can insert any timesheet entries"
  ON timesheet_entries
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Users can update their own timesheet entries (for drafts and rejected)
CREATE POLICY "Users can update own timesheet entries"
  ON timesheet_entries
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
      AND timesheets.user_id = auth.uid()
      AND timesheets.status IN ('draft', 'rejected')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
      AND timesheets.user_id = auth.uid()
    )
  );

-- Managers can update any timesheet entries
CREATE POLICY "Managers can update all timesheet entries"
  ON timesheet_entries
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Users can delete their own timesheet entries (for drafts and rejected)
-- This is needed when updating a draft to submitted (delete old entries, insert new ones)
CREATE POLICY "Users can delete own timesheet entries"
  ON timesheet_entries
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
      AND timesheets.user_id = auth.uid()
      AND timesheets.status IN ('draft', 'rejected', 'submitted')
    )
  );

-- Managers can delete any timesheet entries
CREATE POLICY "Managers can delete any timesheet entries"
  ON timesheet_entries
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

SELECT 'Timesheet RLS policies fixed successfully!' as status;

