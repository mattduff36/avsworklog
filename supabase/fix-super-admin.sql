-- Fix Super Admin Implementation
-- Only admin@mpdee.co.uk should be super admin, not all admins

-- Step 1: Add super_admin column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS super_admin BOOLEAN DEFAULT FALSE;

-- Step 2: Remove is_super_admin from roles table (we don't need it)
-- Keep is_manager_admin for manager/admin role detection
UPDATE roles SET is_super_admin = FALSE WHERE is_super_admin = TRUE;

-- Step 3: Set super_admin flag ONLY for admin@mpdee.co.uk
UPDATE profiles p
SET super_admin = TRUE
FROM auth.users u
WHERE p.id = u.id AND u.email = 'admin@mpdee.co.uk';

-- Step 4: Create index
CREATE INDEX IF NOT EXISTS idx_profiles_super_admin ON profiles(super_admin);

-- Step 5: Update RLS policies to protect super admin

-- Prevent deleting super admin profile
DROP POLICY IF EXISTS "Prevent super admin deletion" ON profiles;
CREATE POLICY "Prevent super admin deletion" ON profiles FOR DELETE TO authenticated
USING (
  super_admin = FALSE  -- Cannot delete super admin
);

-- Prevent updating super admin flag (except by super admin themselves)
DROP POLICY IF EXISTS "Protect super admin flag" ON profiles;
CREATE POLICY "Protect super admin flag" ON profiles FOR UPDATE TO authenticated
USING (
  -- Allow if not changing super_admin field, or if user is super admin
  (super_admin = FALSE) OR 
  (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND super_admin = TRUE))
);

-- Verification
SELECT 
  p.full_name,
  u.email,
  p.role,
  p.super_admin,
  r.display_name as role_display_name
FROM profiles p
INNER JOIN auth.users u ON u.id = p.id
INNER JOIN roles r ON p.role_id = r.id
WHERE p.super_admin = TRUE OR p.role = 'admin'
ORDER BY p.super_admin DESC, p.full_name;

