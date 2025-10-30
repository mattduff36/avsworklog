-- Update employee roles to be more specific
-- Replace single 'employee' role with 5 department-specific roles

-- First, drop the old check constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Update existing 'employee' users to 'employee-civils' (default)
-- Admin can change these individually after migration
UPDATE profiles 
SET role = 'employee-civils' 
WHERE role = 'employee';

-- Now add new check constraint with updated roles
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check 
  CHECK (role IN ('admin', 'manager', 'employee-civils', 'employee-plant', 'employee-transport', 'employee-office', 'employee-workshop'));

COMMENT ON COLUMN profiles.role IS 'User role: admin, manager, employee-civils, employee-plant, employee-transport, employee-office, or employee-workshop';

