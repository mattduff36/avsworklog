-- ========================================
-- AVS WORKLOG - COMPLETE DATABASE SCHEMA
-- Skeleton Export for New Projects
-- ========================================
-- 
-- This is a comprehensive database schema for a workforce management system
-- including timesheets, vehicle inspections, RAMS, absence tracking, and more.
--
-- FEATURES INCLUDED:
-- - User profiles with role-based permissions
-- - Timesheets & timesheet entries
-- - Vehicle inspections & defect tracking
-- - RAMS (Risk Assessment Method Statements) documents
-- - Messages & notifications (Toolbox Talks, Reminders)
-- - Absence & leave management
-- - Actions/defects tracking
-- - Error logging system
-- - Audit logging
-- - Complete RLS (Row Level Security) policies
--
-- INSTRUCTIONS:
-- 1. Create a new Supabase project
-- 2. Go to SQL Editor in Supabase Dashboard
-- 3. Paste and execute this entire file
-- 4. Create your first admin user via Supabase Auth UI
-- 5. Update their role: UPDATE profiles SET role = 'admin', role_id = (SELECT id FROM roles WHERE name = 'admin') WHERE id = 'your-user-id';
-- 6. Create storage buckets (see STORAGE SETUP section at end)
--
-- ========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- CORE TABLES
-- ========================================

-- ----------------------------------------
-- Profiles Table (extends auth.users)
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id TEXT UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin', 'manager', 'employee')) DEFAULT 'employee',
  role_id UUID, -- Will reference roles table (created below)
  phone_number TEXT,
  annual_holiday_allowance_days NUMERIC(4,2) DEFAULT 28,
  force_password_reset BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------
-- Roles Table (RBAC System)
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  is_super_admin BOOLEAN DEFAULT FALSE,
  is_manager_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------
-- Role Permissions Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role_id, module_name)
);

-- Add foreign key constraint to profiles now that roles exists
ALTER TABLE profiles ADD CONSTRAINT fk_profiles_role_id FOREIGN KEY (role_id) REFERENCES roles(id);

-- ----------------------------------------
-- Vehicle Categories Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------
-- Vehicles Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reg_number TEXT UNIQUE NOT NULL,
  vehicle_type TEXT,
  category_id UUID REFERENCES vehicle_categories(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------
-- Timesheets Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS timesheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  reg_number TEXT,
  week_ending DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'adjusted', 'processed')),
  signature_data TEXT,
  signed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  manager_comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_ending)
);

-- ----------------------------------------
-- Timesheet Entries Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS timesheet_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timesheet_id UUID REFERENCES timesheets(id) ON DELETE CASCADE NOT NULL,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7) NOT NULL,
  date DATE,
  time_started TIME,
  time_finished TIME,
  working_in_yard BOOLEAN DEFAULT false,
  did_not_work BOOLEAN DEFAULT false,
  job_number TEXT,
  shift_type TEXT CHECK (shift_type IN ('day', 'night')),
  daily_total DECIMAL(4,2),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(timesheet_id, day_of_week)
);

-- ----------------------------------------
-- Vehicle Inspections Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) NOT NULL,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  week_ending DATE NOT NULL,
  mileage INTEGER,
  checked_by TEXT,
  defects_comments TEXT,
  action_taken TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'submitted', 'reviewed', 'rejected')),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------
-- Inspection Items Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS inspection_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES vehicle_inspections(id) ON DELETE CASCADE NOT NULL,
  item_number INTEGER CHECK (item_number BETWEEN 1 AND 26) NOT NULL,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7) NOT NULL,
  status TEXT CHECK (status IN ('ok', 'attention', 'na')) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(inspection_id, item_number, day_of_week)
);

-- ----------------------------------------
-- Inspection Photos Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS inspection_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES vehicle_inspections(id) ON DELETE CASCADE NOT NULL,
  item_number INTEGER,
  day_of_week INTEGER,
  photo_url TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------
-- Actions Table (Defects/To-Do Tracking)
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES vehicle_inspections(id) ON DELETE CASCADE,
  inspection_item_id UUID REFERENCES inspection_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  status TEXT CHECK (status IN ('pending', 'in_progress', 'completed')) DEFAULT 'pending',
  actioned BOOLEAN NOT NULL DEFAULT FALSE,
  actioned_at TIMESTAMPTZ,
  actioned_by UUID REFERENCES profiles(id),
  created_by UUID REFERENCES profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- MESSAGES & NOTIFICATIONS SYSTEM
-- ========================================

-- ----------------------------------------
-- Messages Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL CHECK (type IN ('TOOLBOX_TALK', 'REMINDER', 'ERROR_REPORT')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('HIGH', 'LOW')),
  sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_via TEXT DEFAULT 'web'
);

-- ----------------------------------------
-- Message Recipients Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS message_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SHOWN', 'SIGNED', 'DISMISSED')),
  signed_at TIMESTAMPTZ,
  first_shown_at TIMESTAMPTZ,
  cleared_from_inbox_at TIMESTAMPTZ,
  signature_data TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- ========================================
-- RAMS (Risk Assessment Method Statements)
-- ========================================

-- ----------------------------------------
-- RAMS Documents Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS rams_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_type TEXT NOT NULL,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1
);

-- ----------------------------------------
-- RAMS Assignments Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS rams_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rams_document_id UUID REFERENCES rams_documents(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending',
  read_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  signature_data TEXT,
  action_taken TEXT,
  comments TEXT,
  UNIQUE(rams_document_id, employee_id)
);

-- ----------------------------------------
-- RAMS Visitor Signatures Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS rams_visitor_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rams_document_id UUID REFERENCES rams_documents(id) ON DELETE CASCADE,
  visitor_name TEXT NOT NULL,
  visitor_company TEXT,
  visitor_role TEXT,
  signature_data TEXT NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT NOW(),
  recorded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT unique_visitor_signature UNIQUE(rams_document_id, visitor_name, visitor_company)
);

-- ========================================
-- ABSENCE & LEAVE MANAGEMENT
-- ========================================

-- ----------------------------------------
-- Absence Reasons Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS absence_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_paid BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------
-- Absences Table
-- ----------------------------------------
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

-- ========================================
-- AUDIT & ERROR LOGGING
-- ========================================

-- ----------------------------------------
-- Audit Log Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------
-- Error Logs Table
-- ----------------------------------------
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message TEXT NOT NULL,
  error_stack TEXT,
  error_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  page_url TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  component_name TEXT,
  additional_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================
-- INDEXES FOR PERFORMANCE
-- ========================================

-- Profiles
CREATE INDEX IF NOT EXISTS idx_profiles_role_id ON profiles(role_id);
CREATE INDEX IF NOT EXISTS idx_profiles_employee_id ON profiles(employee_id);

-- Roles
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
CREATE INDEX IF NOT EXISTS idx_roles_is_super_admin ON roles(is_super_admin);
CREATE INDEX IF NOT EXISTS idx_roles_is_manager_admin ON roles(is_manager_admin);

-- Role Permissions
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_module_name ON role_permissions(module_name);
CREATE INDEX IF NOT EXISTS idx_role_permissions_enabled ON role_permissions(enabled);

-- Vehicles
CREATE INDEX IF NOT EXISTS idx_vehicles_category_id ON vehicles(category_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);

-- Timesheets
CREATE INDEX IF NOT EXISTS idx_timesheets_user_id ON timesheets(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_week_ending ON timesheets(week_ending);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);

-- Vehicle Inspections
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_id ON vehicle_inspections(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_inspections_user_id ON vehicle_inspections(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_week_ending ON vehicle_inspections(week_ending);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON vehicle_inspections(status);

-- Actions
CREATE INDEX IF NOT EXISTS idx_actions_inspection_id ON actions(inspection_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_actioned ON actions(actioned);
CREATE INDEX IF NOT EXISTS idx_actions_created_at ON actions(created_at DESC);

-- Messages
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON messages(deleted_at);

-- Message Recipients
CREATE INDEX IF NOT EXISTS idx_message_recipients_message ON message_recipients(message_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_user ON message_recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_status ON message_recipients(status);
CREATE INDEX IF NOT EXISTS idx_message_recipients_created_at ON message_recipients(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_recipients_cleared ON message_recipients(cleared_from_inbox_at);

-- RAMS
CREATE INDEX IF NOT EXISTS idx_rams_documents_uploaded_by ON rams_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_rams_documents_created_at ON rams_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rams_documents_is_active ON rams_documents(is_active);
CREATE INDEX IF NOT EXISTS idx_rams_assignments_document_id ON rams_assignments(rams_document_id);
CREATE INDEX IF NOT EXISTS idx_rams_assignments_employee_id ON rams_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_rams_assignments_status ON rams_assignments(status);
CREATE INDEX IF NOT EXISTS idx_rams_visitor_signatures_document_id ON rams_visitor_signatures(rams_document_id);
CREATE INDEX IF NOT EXISTS idx_rams_visitor_signatures_signed_at ON rams_visitor_signatures(signed_at DESC);

-- Absences
CREATE INDEX IF NOT EXISTS idx_absences_profile_id ON absences(profile_id);
CREATE INDEX IF NOT EXISTS idx_absences_date ON absences(date);
CREATE INDEX IF NOT EXISTS idx_absences_status ON absences(status);
CREATE INDEX IF NOT EXISTS idx_absences_reason_id ON absences(reason_id);
CREATE INDEX IF NOT EXISTS idx_absence_reasons_name ON absence_reasons(name);
CREATE INDEX IF NOT EXISTS idx_absence_reasons_active ON absence_reasons(is_active);

-- Audit & Error Logs
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id ON error_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_error_type ON error_logs(error_type);

-- ========================================
-- FUNCTIONS & TRIGGERS
-- ========================================

-- ----------------------------------------
-- Updated At Timestamp Function
-- ----------------------------------------
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_roles BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_role_permissions BEFORE UPDATE ON role_permissions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_vehicle_categories BEFORE UPDATE ON vehicle_categories FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_timesheets BEFORE UPDATE ON timesheets FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_timesheet_entries BEFORE UPDATE ON timesheet_entries FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_vehicle_inspections BEFORE UPDATE ON vehicle_inspections FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_actions BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_messages BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_message_recipients BEFORE UPDATE ON message_recipients FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_rams_documents BEFORE UPDATE ON rams_documents FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_absence_reasons BEFORE UPDATE ON absence_reasons FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_updated_at_absences BEFORE UPDATE ON absences FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ----------------------------------------
-- Create Profile on User Signup
-- ----------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, employee_id, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    NEW.raw_user_meta_data->>'employee_id',
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ----------------------------------------
-- Permission Check Function
-- ----------------------------------------
CREATE OR REPLACE FUNCTION user_has_permission(user_id UUID, module TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  has_access BOOLEAN;
  is_manager BOOLEAN;
BEGIN
  SELECT r.is_manager_admin INTO is_manager
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  WHERE p.id = user_id;
  
  IF is_manager THEN
    RETURN TRUE;
  END IF;
  
  SELECT rp.enabled INTO has_access
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  INNER JOIN role_permissions rp ON rp.role_id = r.id
  WHERE p.id = user_id AND rp.module_name = module;
  
  RETURN COALESCE(has_access, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------
-- Get User Permissions Function
-- ----------------------------------------
CREATE OR REPLACE FUNCTION get_user_permissions(user_id UUID)
RETURNS TABLE (module_name TEXT, enabled BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rp.module_name,
    CASE 
      WHEN r.is_manager_admin THEN TRUE 
      ELSE rp.enabled 
    END as enabled
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  WHERE p.id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- ENABLE ROW LEVEL SECURITY (RLS)
-- ========================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE rams_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rams_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rams_visitor_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- ========================================
-- RLS POLICIES
-- ========================================

-- ----------------------------------------
-- PROFILES POLICIES
-- ----------------------------------------
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Admins can manage all profiles" ON profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- ROLES POLICIES
-- ----------------------------------------
CREATE POLICY "Anyone can view roles" ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Only admins can manage roles" ON roles FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- ROLE PERMISSIONS POLICIES
-- ----------------------------------------
CREATE POLICY "Anyone can view permissions" ON role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Only admins can manage permissions" ON role_permissions FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- VEHICLES POLICIES
-- ----------------------------------------
CREATE POLICY "All users can view active vehicles" ON vehicles FOR SELECT USING (status = 'active');
CREATE POLICY "Admins can manage vehicles" ON vehicles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- VEHICLE CATEGORIES POLICIES
-- ----------------------------------------
CREATE POLICY "Anyone can view categories" ON vehicle_categories FOR SELECT USING (true);
CREATE POLICY "Admins can manage categories" ON vehicle_categories FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- TIMESHEETS POLICIES
-- ----------------------------------------
CREATE POLICY "Employees can view own timesheets" ON timesheets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Employees can create own timesheets" ON timesheets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Employees can update own draft timesheets" ON timesheets FOR UPDATE USING (
  auth.uid() = user_id AND status IN ('draft', 'rejected')
);
CREATE POLICY "Managers can view all timesheets" ON timesheets FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Managers can manage all timesheets" ON timesheets FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- TIMESHEET ENTRIES POLICIES
-- ----------------------------------------
CREATE POLICY "Users can manage own timesheet entries" ON timesheet_entries FOR ALL USING (
  EXISTS (SELECT 1 FROM timesheets WHERE timesheets.id = timesheet_entries.timesheet_id AND timesheets.user_id = auth.uid())
);
CREATE POLICY "Managers can view all timesheet entries" ON timesheet_entries FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- VEHICLE INSPECTIONS POLICIES
-- ----------------------------------------
CREATE POLICY "Employees can view own inspections" ON vehicle_inspections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Employees can create own inspections" ON vehicle_inspections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Employees can update own draft inspections" ON vehicle_inspections FOR UPDATE USING (
  auth.uid() = user_id AND status IN ('draft', 'in_progress', 'submitted', 'rejected')
);
CREATE POLICY "Managers can view all inspections" ON vehicle_inspections FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Managers can manage all inspections" ON vehicle_inspections FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- INSPECTION ITEMS POLICIES
-- ----------------------------------------
CREATE POLICY "Employees can view own inspection items" ON inspection_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid())
);
CREATE POLICY "Employees can insert own inspection items" ON inspection_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid())
);
CREATE POLICY "Employees can update own inspection items" ON inspection_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
);
CREATE POLICY "Employees can delete own inspection items" ON inspection_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM vehicle_inspections vi WHERE vi.id = inspection_items.inspection_id AND vi.user_id = auth.uid() AND vi.status = 'draft')
);
CREATE POLICY "Managers can view all inspection items" ON inspection_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Managers can manage all inspection items" ON inspection_items FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- INSPECTION PHOTOS POLICIES
-- ----------------------------------------
CREATE POLICY "Users can manage own inspection photos" ON inspection_photos FOR ALL USING (
  EXISTS (SELECT 1 FROM vehicle_inspections WHERE vehicle_inspections.id = inspection_photos.inspection_id AND vehicle_inspections.user_id = auth.uid())
);
CREATE POLICY "Managers can view all inspection photos" ON inspection_photos FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- ACTIONS POLICIES
-- ----------------------------------------
CREATE POLICY "Managers can view all actions" ON actions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Managers can manage actions" ON actions FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- MESSAGES POLICIES
-- ----------------------------------------
CREATE POLICY "Managers can view their messages" ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Users can view assigned messages" ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM message_recipients WHERE message_id = messages.id AND user_id = auth.uid())
);
CREATE POLICY "Managers can manage messages" ON messages FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- MESSAGE RECIPIENTS POLICIES
-- ----------------------------------------
CREATE POLICY "Users can view their recipients" ON message_recipients FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can update their recipients" ON message_recipients FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Managers can view all recipients" ON message_recipients FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Managers can manage recipients" ON message_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- RAMS DOCUMENTS POLICIES
-- ----------------------------------------
CREATE POLICY "Managers can view all RAMS documents" ON rams_documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Employees can view assigned RAMS" ON rams_documents FOR SELECT USING (
  EXISTS (SELECT 1 FROM rams_assignments WHERE rams_document_id = rams_documents.id AND employee_id = auth.uid())
);
CREATE POLICY "Managers can manage RAMS documents" ON rams_documents FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- RAMS ASSIGNMENTS POLICIES
-- ----------------------------------------
CREATE POLICY "Users can view their assignments" ON rams_assignments FOR SELECT USING (employee_id = auth.uid());
CREATE POLICY "Employees can sign their assignments" ON rams_assignments FOR UPDATE USING (employee_id = auth.uid());
CREATE POLICY "Managers can view all assignments" ON rams_assignments FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Managers can manage assignments" ON rams_assignments FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- RAMS VISITOR SIGNATURES POLICIES
-- ----------------------------------------
CREATE POLICY "Managers can view visitor signatures" ON rams_visitor_signatures FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Employees can view their recorded signatures" ON rams_visitor_signatures FOR SELECT USING (recorded_by = auth.uid());
CREATE POLICY "Users can record visitor signatures" ON rams_visitor_signatures FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM rams_assignments WHERE rams_document_id = rams_visitor_signatures.rams_document_id AND employee_id = auth.uid() AND status = 'signed')
);

-- ----------------------------------------
-- ABSENCE REASONS POLICIES
-- ----------------------------------------
CREATE POLICY "Users can view active absence reasons" ON absence_reasons FOR SELECT USING (is_active = true);
CREATE POLICY "Admins can manage absence reasons" ON absence_reasons FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- ABSENCES POLICIES
-- ----------------------------------------
CREATE POLICY "Users can view own absences" ON absences FOR SELECT USING (auth.uid() = profile_id);
CREATE POLICY "Users can create own absences" ON absences FOR INSERT WITH CHECK (auth.uid() = profile_id AND auth.uid() = created_by);
CREATE POLICY "Users can update own pending future absences" ON absences FOR UPDATE USING (
  auth.uid() = profile_id AND status = 'pending' AND date >= CURRENT_DATE
);
CREATE POLICY "Users can delete own pending future absences" ON absences FOR DELETE USING (
  auth.uid() = profile_id AND status = 'pending' AND date >= CURRENT_DATE
);
CREATE POLICY "Admins can view all absences" ON absences FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);
CREATE POLICY "Admins can manage all absences" ON absences FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
);

-- ----------------------------------------
-- ERROR LOGS POLICIES
-- ----------------------------------------
CREATE POLICY "SuperAdmin can view all error logs" ON error_logs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_super_admin = true)
);
CREATE POLICY "Users can insert error logs" ON error_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "SuperAdmin can delete error logs" ON error_logs FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_super_admin = true)
);

-- ========================================
-- SEED DATA
-- ========================================

-- ----------------------------------------
-- Default Roles
-- ----------------------------------------
INSERT INTO roles (name, display_name, description, is_super_admin, is_manager_admin) VALUES
  ('admin', 'Administrator', 'Full system administrator with all permissions', FALSE, TRUE),
  ('manager', 'Manager', 'Manager with oversight and approval capabilities', FALSE, TRUE),
  ('employee', 'Employee', 'Standard employee with basic permissions', FALSE, FALSE)
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------
-- Default Role Permissions
-- ----------------------------------------
DO $$
DECLARE
  admin_role_id UUID;
  manager_role_id UUID;
  employee_role_id UUID;
  modules TEXT[] := ARRAY[
    'timesheets', 'inspections', 'rams', 'absence', 
    'toolbox-talks', 'approvals', 'actions', 'reports',
    'admin-users', 'admin-vehicles'
  ];
  module TEXT;
BEGIN
  SELECT id INTO admin_role_id FROM roles WHERE name = 'admin';
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager';
  SELECT id INTO employee_role_id FROM roles WHERE name = 'employee';

  FOREACH module IN ARRAY modules LOOP
    -- Admin gets everything
    INSERT INTO role_permissions (role_id, module_name, enabled)
    VALUES (admin_role_id, module, TRUE)
    ON CONFLICT (role_id, module_name) DO NOTHING;
    
    -- Manager gets everything
    INSERT INTO role_permissions (role_id, module_name, enabled)
    VALUES (manager_role_id, module, TRUE)
    ON CONFLICT (role_id, module_name) DO NOTHING;
    
    -- Employee gets employee-facing modules only
    INSERT INTO role_permissions (role_id, module_name, enabled)
    VALUES (employee_role_id, module, 
      CASE WHEN module IN ('timesheets', 'inspections', 'rams', 'absence', 'toolbox-talks') 
      THEN TRUE ELSE FALSE END)
    ON CONFLICT (role_id, module_name) DO NOTHING;
  END LOOP;
END $$;

-- ----------------------------------------
-- Default Vehicle Categories
-- ----------------------------------------
INSERT INTO vehicle_categories (name, description) VALUES
  ('Truck', 'Standard rigid truck'),
  ('Artic', 'Articulated lorry/semi-trailer'),
  ('Trailer', 'Trailer unit'),
  ('Van', 'Light commercial vehicle')
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------
-- Default Absence Reasons
-- ----------------------------------------
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

-- ========================================
-- STORAGE SETUP (Manual Step Required)
-- ========================================
-- 
-- After running this SQL, you need to create storage buckets in Supabase Dashboard:
-- 
-- 1. Go to Storage > Buckets
-- 2. Create the following buckets:
--    - inspection-photos (Public: true)
--    - rams-documents (Public: false, restricted)
--    - toolbox-talk-pdfs (Public: false, restricted)
-- 
-- 3. Set up storage policies for each bucket via SQL Editor:
-- 
-- -- INSPECTION PHOTOS BUCKET
-- INSERT INTO storage.buckets (id, name, public) VALUES ('inspection-photos', 'inspection-photos', true) ON CONFLICT DO NOTHING;
-- 
-- CREATE POLICY "Authenticated users can upload inspection photos" ON storage.objects
--   FOR INSERT WITH CHECK (bucket_id = 'inspection-photos' AND auth.uid() IS NOT NULL);
-- 
-- CREATE POLICY "Anyone can view inspection photos" ON storage.objects
--   FOR SELECT USING (bucket_id = 'inspection-photos');
-- 
-- CREATE POLICY "Users can delete own inspection photos" ON storage.objects
--   FOR DELETE USING (bucket_id = 'inspection-photos' AND auth.uid() IS NOT NULL);
-- 
-- -- RAMS DOCUMENTS BUCKET
-- INSERT INTO storage.buckets (id, name, public) VALUES ('rams-documents', 'rams-documents', false) ON CONFLICT DO NOTHING;
-- 
-- CREATE POLICY "Authenticated users can upload RAMS" ON storage.objects
--   FOR INSERT WITH CHECK (bucket_id = 'rams-documents' AND auth.uid() IS NOT NULL);
-- 
-- CREATE POLICY "Authenticated users can view RAMS" ON storage.objects
--   FOR SELECT USING (bucket_id = 'rams-documents' AND auth.uid() IS NOT NULL);
-- 
-- -- TOOLBOX TALK PDFS BUCKET
-- INSERT INTO storage.buckets (id, name, public) VALUES ('toolbox-talk-pdfs', 'toolbox-talk-pdfs', false) ON CONFLICT DO NOTHING;
-- 
-- CREATE POLICY "Managers can upload toolbox talks" ON storage.objects
--   FOR INSERT WITH CHECK (
--     bucket_id = 'toolbox-talk-pdfs' AND 
--     EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
--   );
-- 
-- CREATE POLICY "Authenticated users can view toolbox talks" ON storage.objects
--   FOR SELECT USING (bucket_id = 'toolbox-talk-pdfs' AND auth.uid() IS NOT NULL);
--
-- ========================================
-- NEXT STEPS
-- ========================================
-- 
-- 1. Create your first admin user via Supabase Auth UI (Authentication > Users > Add User)
-- 2. Run this query to make them admin:
--    UPDATE profiles 
--    SET role = 'admin', role_id = (SELECT id FROM roles WHERE name = 'admin')
--    WHERE id = 'paste-user-uuid-here';
-- 3. Optionally set them as super admin:
--    UPDATE roles SET is_super_admin = TRUE WHERE id = (SELECT role_id FROM profiles WHERE id = 'paste-user-uuid-here');
-- 4. Add sample vehicles (optional):
--    INSERT INTO vehicles (reg_number, vehicle_type, status, category_id) VALUES
--      ('ABC123', 'Truck', 'active', (SELECT id FROM vehicle_categories WHERE name = 'Truck'));
-- 5. Configure your app's environment variables with Supabase URL and keys
-- 6. Deploy your frontend application
--
-- ========================================
-- SCHEMA VERSION: 1.0
-- LAST UPDATED: 2025-12-06
-- ========================================
