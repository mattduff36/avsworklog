-- Absence & Leave System Migration
-- Execute this SQL in your Supabase SQL Editor

-- Step 1: Add annual_holiday_allowance_days column to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS annual_holiday_allowance_days NUMERIC(4,2) DEFAULT 28;

-- Step 2: Create absence_reasons table
CREATE TABLE IF NOT EXISTS absence_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_paid BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Create absences table
CREATE TABLE IF NOT EXISTS absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  end_date DATE,
  reason_id UUID NOT NULL REFERENCES absence_reasons(id),
  duration_days NUMERIC(4,2) NOT NULL,
  is_half_day BOOLEAN DEFAULT false,
  half_day_session TEXT CHECK (half_day_session IN ('AM', 'PM')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_by UUID REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 4: Create indexes
CREATE INDEX IF NOT EXISTS idx_absences_profile_id ON absences(profile_id);
CREATE INDEX IF NOT EXISTS idx_absences_date ON absences(date);
CREATE INDEX IF NOT EXISTS idx_absences_status ON absences(status);
CREATE INDEX IF NOT EXISTS idx_absences_reason_id ON absences(reason_id);
CREATE INDEX IF NOT EXISTS idx_absence_reasons_name ON absence_reasons(name);
CREATE INDEX IF NOT EXISTS idx_absence_reasons_active ON absence_reasons(is_active);

-- Step 5: Enable RLS
ALTER TABLE absence_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;

-- Step 6: RLS Policies for absence_reasons
-- Users can view active reasons
CREATE POLICY "Users can view active absence reasons" ON absence_reasons
  FOR SELECT USING (
    is_active = true
  );

-- Admins can manage all reasons
CREATE POLICY "Admins can manage absence reasons" ON absence_reasons
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Step 7: RLS Policies for absences
-- Users can view their own absences
CREATE POLICY "Users can view own absences" ON absences
  FOR SELECT USING (
    auth.uid() = profile_id
  );

-- Users can insert absences for themselves
CREATE POLICY "Users can create own absences" ON absences
  FOR INSERT WITH CHECK (
    auth.uid() = profile_id AND
    auth.uid() = created_by
  );

-- Users can update their own pending future absences
CREATE POLICY "Users can update own pending future absences" ON absences
  FOR UPDATE USING (
    auth.uid() = profile_id AND
    status = 'pending' AND
    date >= CURRENT_DATE
  );

-- Users can delete their own pending future absences
CREATE POLICY "Users can delete own pending future absences" ON absences
  FOR DELETE USING (
    auth.uid() = profile_id AND
    status = 'pending' AND
    date >= CURRENT_DATE
  );

-- Admins can view all absences
CREATE POLICY "Admins can view all absences" ON absences
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Admins can manage all absences
CREATE POLICY "Admins can manage all absences" ON absences
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Step 8: Create triggers for updated_at
CREATE TRIGGER set_updated_at_absence_reasons
  BEFORE UPDATE ON absence_reasons
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_absences
  BEFORE UPDATE ON absences
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Step 9: Seed absence_reasons
INSERT INTO absence_reasons (name, is_paid, is_active) VALUES
  ('Annual leave', true, true),
  ('Sickness', true, true),
  ('Maternity leave', true, true),
  ('Paternity leave', true, true),
  ('Public duties', true, true),
  ('Dependant emergency', true, true),
  ('Medical appointment', true, true),
  ('Parental leave', true, true),
  ('Bereavement', true, true),
  ('Sabbatical', false, true)
ON CONFLICT (name) DO NOTHING;

-- Step 10: Grant necessary permissions
GRANT ALL ON absence_reasons TO authenticated;
GRANT ALL ON absences TO authenticated;

-- Migration complete
-- Verify with:
-- SELECT * FROM absence_reasons;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'annual_holiday_allowance_days';

