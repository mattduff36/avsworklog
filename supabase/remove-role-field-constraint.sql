-- ========================================
-- Remove role field CHECK constraint
-- We now use role_id exclusively
-- Created: 2025-11-24
-- ========================================

-- Drop the CHECK constraint on role field
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Make role field nullable (we no longer use it)
ALTER TABLE profiles ALTER COLUMN role DROP NOT NULL;

-- Add a comment explaining the field is deprecated
COMMENT ON COLUMN profiles.role IS 'DEPRECATED: Use role_id instead. This field is kept for backward compatibility only.';

-- Verify
SELECT 
  'Constraint removed successfully!' as status,
  COUNT(*) as total_profiles,
  COUNT(*) FILTER (WHERE role_id IS NOT NULL) as profiles_with_role_id,
  COUNT(*) FILTER (WHERE role IS NULL) as profiles_with_null_role
FROM profiles;

