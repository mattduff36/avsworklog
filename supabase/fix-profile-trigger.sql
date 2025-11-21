-- ========================================
-- Fix Profile Creation Trigger for RBAC
-- Update trigger to use role_id instead of role
-- Created: 2025-11-21
-- ========================================

-- Update the trigger function to use role_id
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_employee_role_id UUID;
BEGIN
  -- Get the default employee role ID (fallback if no role_id provided)
  SELECT id INTO default_employee_role_id
  FROM roles
  WHERE name = 'employee-civils'
  LIMIT 1;

  INSERT INTO public.profiles (id, full_name, employee_id, role_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    NEW.raw_user_meta_data->>'employee_id',
    COALESCE(
      (NEW.raw_user_meta_data->>'role_id')::UUID,  -- Use role_id if provided
      default_employee_role_id                       -- Otherwise use default
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify existing users have role_id populated
-- This should already be done by the main migration, but let's double-check
UPDATE profiles p
SET role_id = r.id
FROM roles r
WHERE p.role = r.name 
  AND p.role_id IS NULL
  AND p.role IS NOT NULL;

SELECT 
  'Fixed profile trigger!' as status,
  COUNT(*) FILTER (WHERE role_id IS NOT NULL) as users_with_role_id,
  COUNT(*) FILTER (WHERE role_id IS NULL) as users_missing_role_id
FROM profiles;

