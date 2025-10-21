-- Test Users Setup Script
-- Run this in Supabase SQL Editor to create test users

-- Note: You'll need to run this in the Supabase SQL Editor
-- because we need to use the auth.users table which requires admin access

-- Insert test users into auth.users
-- Password for all test users: TestPass123!

-- 1. Admin User
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  role
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'admin@avsworklog.test',
  crypt('TestPass123!', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Admin User","employee_id":"ADM001"}',
  false,
  'authenticated'
)
ON CONFLICT (email) DO NOTHING;

-- 2. Manager User
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  role
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'manager@avsworklog.test',
  crypt('TestPass123!', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Manager User","employee_id":"MGR001"}',
  false,
  'authenticated'
)
ON CONFLICT (email) DO NOTHING;

-- 3. Employee User
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  role
) VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000000',
  'employee@avsworklog.test',
  crypt('TestPass123!', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Employee User","employee_id":"EMP001"}',
  false,
  'authenticated'
)
ON CONFLICT (email) DO NOTHING;

-- Update profiles to set correct roles
-- (The trigger creates profiles with 'employee' role by default)

UPDATE profiles 
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@avsworklog.test');

UPDATE profiles 
SET role = 'manager'
WHERE id = (SELECT id FROM auth.users WHERE email = 'manager@avsworklog.test');

UPDATE profiles 
SET role = 'employee'
WHERE id = (SELECT id FROM auth.users WHERE email = 'employee@avsworklog.test');

-- Create some test vehicles for inspections
INSERT INTO vehicles (reg_number, make, model, vehicle_type, status) VALUES
  ('YX65ABC', 'Ford', 'Transit', 'Van', 'active'),
  ('AB12CDE', 'Mercedes', 'Sprinter', 'Van', 'active'),
  ('CD34EFG', 'Volvo', 'FH16', 'Truck', 'active')
ON CONFLICT (reg_number) DO NOTHING;

-- Confirm the test users
SELECT 
  u.email,
  p.full_name,
  p.employee_id,
  p.role
FROM auth.users u
JOIN profiles p ON u.id = p.id
WHERE u.email LIKE '%@avsworklog.test';

