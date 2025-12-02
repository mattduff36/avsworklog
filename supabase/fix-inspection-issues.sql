-- Migration: Fix inspection issues
-- 1. Ensure inspection_items has comments column
-- 2. Fix unique constraint to include day_of_week  
-- 3. Fix RLS policies for managers creating inspections
-- 4. Fix status enum to include 'defect' (standardizing from 'attention')

-- ========================================
-- PART 1: Fix inspection_items schema
-- ========================================

-- Add comments column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='inspection_items' AND column_name='comments'
  ) THEN
    ALTER TABLE inspection_items ADD COLUMN comments TEXT;
    RAISE NOTICE 'Added comments column to inspection_items';
  ELSE
    RAISE NOTICE 'Comments column already exists';
  END IF;
END $$;

-- Add day_of_week column if it doesn't exist (needed for unique constraint)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='inspection_items' AND column_name='day_of_week'
  ) THEN
    ALTER TABLE inspection_items ADD COLUMN day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7);
    RAISE NOTICE 'Added day_of_week column to inspection_items';
  ELSE
    RAISE NOTICE 'day_of_week column already exists';
  END IF;
END $$;

-- Add item_description column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='inspection_items' AND column_name='item_description'
  ) THEN
    ALTER TABLE inspection_items ADD COLUMN item_description TEXT;
    RAISE NOTICE 'Added item_description column to inspection_items';
  ELSE
    RAISE NOTICE 'item_description column already exists';
  END IF;
END $$;

-- Update status check constraint to include both 'attention' and 'defect'
-- This allows the app to use 'attention' while we transition
DO $$
BEGIN
  -- Drop the existing constraint if it exists
  ALTER TABLE inspection_items DROP CONSTRAINT IF EXISTS inspection_items_status_check;
  
  -- Add new constraint that supports both values
  ALTER TABLE inspection_items ADD CONSTRAINT inspection_items_status_check 
    CHECK (status IN ('ok', 'attention', 'defect', 'na'));
  
  RAISE NOTICE 'Updated status check constraint to support attention and defect';
END $$;

-- Fix the unique constraint to include day_of_week
DO $$
BEGIN
  -- Drop old unique constraint if it exists (without day_of_week)
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'inspection_items_inspection_id_item_number_key'
  ) THEN
    ALTER TABLE inspection_items DROP CONSTRAINT inspection_items_inspection_id_item_number_key;
    RAISE NOTICE 'Dropped old unique constraint';
  END IF;

  -- Add new unique constraint with day_of_week
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'inspection_items_inspection_id_item_number_day_of_week_key'
  ) THEN
    ALTER TABLE inspection_items 
      ADD CONSTRAINT inspection_items_inspection_id_item_number_day_of_week_key 
      UNIQUE(inspection_id, item_number, day_of_week);
    RAISE NOTICE 'Added new unique constraint with day_of_week';
  ELSE
    RAISE NOTICE 'Unique constraint with day_of_week already exists';
  END IF;
END $$;

-- ========================================
-- PART 2: Fix RLS policies for vehicle_inspections
-- ========================================

-- Drop old INSERT policy that prevents managers from creating on behalf of others
DROP POLICY IF EXISTS "Employees can create own inspections" ON vehicle_inspections;

-- Create new INSERT policy for regular employees (own inspections only)
CREATE POLICY "Employees can create own inspections" ON vehicle_inspections
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
  );

-- Create new INSERT policy for managers/admins (can create for any user)
CREATE POLICY "Managers can create inspections for users" ON vehicle_inspections
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- ========================================
-- PART 3: Fix RLS policies for inspection_items
-- ========================================

-- Update inspection_items policies to match new schema
DROP POLICY IF EXISTS "Users can manage own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Employees can view own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Employees can insert own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Employees can update own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Employees can delete own inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can view all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can insert all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can update all inspection items" ON inspection_items;
DROP POLICY IF EXISTS "Managers can delete all inspection items" ON inspection_items;

-- View policy (employees see their own, managers see all)
CREATE POLICY "Employees can view own inspection items" ON inspection_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can view all inspection items" ON inspection_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- Insert policy (employees can insert for their own, managers for any)
CREATE POLICY "Employees can insert own inspection items" ON inspection_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can insert all inspection items" ON inspection_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- Update policy (employees can update their own drafts, managers can update any)
CREATE POLICY "Employees can update own inspection items" ON inspection_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
      AND vi.status IN ('draft', 'in_progress')
    )
  );

CREATE POLICY "Managers can update all inspection items" ON inspection_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- Delete policy (employees can delete their own draft items, managers can delete any)
CREATE POLICY "Employees can delete own inspection items" ON inspection_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections vi
      WHERE vi.id = inspection_items.inspection_id
      AND vi.user_id = auth.uid()
      AND vi.status IN ('draft', 'in_progress')
    )
  );

CREATE POLICY "Managers can delete all inspection items" ON inspection_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- ========================================
-- VERIFICATION
-- ========================================

-- Migration completed successfully

