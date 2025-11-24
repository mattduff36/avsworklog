-- ========================================
-- Fix Profile Creation Trigger - Robust Version
-- Handles edge cases and errors gracefully
-- Created: 2025-11-21
-- ========================================

-- Update the trigger function to handle errors better
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_employee_role_id UUID;
  provided_role_id UUID;
  final_role_id UUID;
BEGIN
  -- Try to get the default employee role ID (fallback if no role_id provided)
  -- Try multiple common employee role names
  SELECT id INTO default_employee_role_id
  FROM roles
  WHERE name IN ('employee-civils', 'employee', 'Employee - Civils')
  ORDER BY CASE 
    WHEN name = 'employee-civils' THEN 1
    WHEN name = 'employee' THEN 2
    ELSE 3
  END
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

  -- If still no role_id, we need to handle this gracefully
  -- For now, we'll allow NULL and let the API update it later
  INSERT INTO public.profiles (id, full_name, employee_id, role_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    NEW.raw_user_meta_data->>'employee_id',
    final_role_id
  )
  ON CONFLICT (id) DO NOTHING; -- Prevent errors if profile already exists
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log the error but don't fail the transaction
  -- This allows the user to be created even if profile creation fails
  -- The API will handle creating/updating the profile
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

