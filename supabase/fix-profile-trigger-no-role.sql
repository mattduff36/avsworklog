-- ========================================
-- Fix Profile Creation Trigger - No Role Field
-- Only uses role_id, not deprecated role field
-- Created: 2025-11-24
-- ========================================

-- Update the trigger function to NOT set role field
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_employee_role_id UUID;
  provided_role_id UUID;
  final_role_id UUID;
BEGIN
  -- Try to get the default employee role ID (fallback if no role_id provided)
  SELECT id INTO default_employee_role_id
  FROM roles
  WHERE name = 'employee-civils'
  LIMIT 1;

  -- Try to parse the role_id from metadata
  BEGIN
    IF NEW.raw_user_meta_data->>'role_id' IS NOT NULL THEN
      provided_role_id := (NEW.raw_user_meta_data->>'role_id')::UUID;
      
      -- Verify the role_id exists in the roles table
      IF EXISTS (SELECT 1 FROM roles WHERE id = provided_role_id) THEN
        final_role_id := provided_role_id;
      ELSE
        -- Role doesn't exist, use default
        final_role_id := default_employee_role_id;
      END IF;
    ELSE
      -- No role_id provided, use default
      final_role_id := default_employee_role_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- If UUID cast fails, use default
    final_role_id := default_employee_role_id;
  END;

  -- Insert profile with only role_id (role field is deprecated)
  INSERT INTO public.profiles (id, full_name, employee_id, role_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    NEW.raw_user_meta_data->>'employee_id',
    final_role_id
  )
  ON CONFLICT (id) DO UPDATE SET
    role_id = EXCLUDED.role_id,
    full_name = EXCLUDED.full_name,
    employee_id = EXCLUDED.employee_id;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log the error but don't fail the transaction
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify the trigger exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION handle_new_user();
  END IF;
END $$;

SELECT 'Trigger function updated successfully!' as status;

