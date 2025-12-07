# Database Skeleton Export - Setup Guide

This export file contains a complete, production-ready database schema for a workforce management system.

## 📋 What's Included

### Core Features
- ✅ **User Management** - Profiles with role-based access control (RBAC)
- ✅ **Timesheets** - Weekly timesheet submission and approval system
- ✅ **Vehicle Inspections** - Daily vehicle inspection checklists with photos
- ✅ **RAMS** - Risk Assessment Method Statements document management
- ✅ **Messages & Notifications** - Toolbox Talks, Reminders, and in-app messaging
- ✅ **Absence Management** - Holiday and leave request system
- ✅ **Actions Tracking** - Defects and to-do tracking from inspections
- ✅ **Error Logging** - Application error tracking for debugging
- ✅ **Audit Logging** - Complete audit trail of data changes

### Security Features
- ✅ Row Level Security (RLS) on all tables
- ✅ Role-based permissions system
- ✅ Secure authentication via Supabase Auth
- ✅ Proper foreign key constraints
- ✅ Data isolation between users

## 🚀 Quick Start

### Step 1: Create New Supabase Project
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click "New Project"
3. Choose organization and enter project details
4. Wait for project to be created (~2 minutes)

### Step 2: Import Database Schema
1. Open your new project in Supabase
2. Go to **SQL Editor** (left sidebar)
3. Click **New Query**
4. Copy the entire contents of `database-skeleton-export.sql`
5. Paste into the query editor
6. Click **Run** (or press Ctrl/Cmd + Enter)
7. Wait for execution (~30 seconds)

### Step 3: Create Storage Buckets
1. Go to **Storage** in the left sidebar
2. Click **New Bucket**
3. Create these buckets:
   - `inspection-photos` - Set Public: **true**
   - `rams-documents` - Set Public: **false**
   - `toolbox-talk-pdfs` - Set Public: **false**

### Step 4: Apply Storage Policies
Run this in SQL Editor:

```sql
-- INSPECTION PHOTOS
INSERT INTO storage.buckets (id, name, public) VALUES ('inspection-photos', 'inspection-photos', true) ON CONFLICT DO NOTHING;

CREATE POLICY "Authenticated users can upload inspection photos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'inspection-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can view inspection photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'inspection-photos');

-- RAMS DOCUMENTS
INSERT INTO storage.buckets (id, name, public) VALUES ('rams-documents', 'rams-documents', false) ON CONFLICT DO NOTHING;

CREATE POLICY "Authenticated users can upload RAMS" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'rams-documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view RAMS" ON storage.objects
  FOR SELECT USING (bucket_id = 'rams-documents' AND auth.uid() IS NOT NULL);

-- TOOLBOX TALK PDFS
INSERT INTO storage.buckets (id, name, public) VALUES ('toolbox-talk-pdfs', 'toolbox-talk-pdfs', false) ON CONFLICT DO NOTHING;

CREATE POLICY "Managers can upload toolbox talks" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'toolbox-talk-pdfs' AND 
    EXISTS (SELECT 1 FROM profiles p JOIN roles r ON p.role_id = r.id WHERE p.id = auth.uid() AND r.is_manager_admin = true)
  );

CREATE POLICY "Authenticated users can view toolbox talks" ON storage.objects
  FOR SELECT USING (bucket_id = 'toolbox-talk-pdfs' AND auth.uid() IS NOT NULL);
```

### Step 5: Create First Admin User
1. Go to **Authentication > Users** in Supabase Dashboard
2. Click **Add User**
3. Enter email and password
4. Copy the User UUID (you'll need this)
5. Go back to **SQL Editor** and run:

```sql
-- Replace 'your-user-uuid-here' with the actual UUID
UPDATE profiles 
SET role = 'admin', 
    role_id = (SELECT id FROM roles WHERE name = 'admin')
WHERE id = 'your-user-uuid-here';

-- Optional: Make this user a Super Admin (access to error logs and system settings)
UPDATE roles 
SET is_super_admin = TRUE 
WHERE id = (SELECT role_id FROM profiles WHERE id = 'your-user-uuid-here');
```

### Step 6: Get Your API Keys
1. Go to **Project Settings > API** in Supabase
2. Copy these values for your app:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep this SECRET!)

### Step 7: Configure Your App
Create a `.env.local` file in your app:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional: For direct database access (migrations)
POSTGRES_URL_NON_POOLING=your-postgres-connection-string
```

## 📊 Database Structure

### Main Tables

| Table | Purpose | Key Features |
|-------|---------|--------------|
| `profiles` | User accounts | Links to auth.users, stores role and employee info |
| `roles` | User roles | RBAC system with manager/admin flags |
| `role_permissions` | Module permissions | Granular access control per role |
| `timesheets` | Weekly timesheets | Draft→Submitted→Approved workflow |
| `timesheet_entries` | Daily time entries | 7 days per timesheet |
| `vehicle_inspections` | Vehicle checks | Weekly inspection checklists |
| `inspection_items` | Individual checks | 26 items × 7 days |
| `messages` | Notifications | Toolbox Talks, Reminders, Error Reports |
| `rams_documents` | RAMS files | PDF/DOCX document management |
| `absences` | Leave requests | Holiday and absence tracking |
| `actions` | Defects/Tasks | Manager action items from inspections |
| `error_logs` | App errors | Debugging and monitoring |

### Default Roles

| Role | Type | Access Level |
|------|------|-------------|
| `admin` | Manager/Admin | Full access to all modules |
| `manager` | Manager/Admin | Full access to all modules |
| `employee` | Standard User | Access to timesheets, inspections, RAMS, absence, toolbox-talks |

### Available Modules

Module permissions that can be enabled/disabled per role:
- `timesheets`
- `inspections`
- `rams`
- `absence`
- `toolbox-talks`
- `approvals`
- `actions`
- `reports`
- `admin-users`
- `admin-vehicles`

## 🔒 Security Notes

### RLS Policies
All tables have Row Level Security enabled with policies that:
- **Employees** can only see/edit their own data
- **Managers/Admins** can see/edit all data
- **Super Admins** can access error logs and system settings

### Best Practices
1. **Never commit** your `service_role` key - it bypasses RLS!
2. **Always use** the `anon` key on the frontend
3. **Use `service_role`** only in secure API routes for admin operations
4. **Enable MFA** for admin accounts in production
5. **Regular backups** - set up automated backups in Supabase

## 🎨 Customization Tips

### Add Custom Roles
```sql
-- Create a new role
INSERT INTO roles (name, display_name, description, is_manager_admin)
VALUES ('supervisor', 'Supervisor', 'Team supervisor role', FALSE);

-- Get the role ID
SELECT id FROM roles WHERE name = 'supervisor';

-- Add permissions for specific modules
INSERT INTO role_permissions (role_id, module_name, enabled) VALUES
  ('role-uuid-here', 'timesheets', TRUE),
  ('role-uuid-here', 'inspections', TRUE),
  ('role-uuid-here', 'approvals', TRUE);
```

### Add Sample Vehicles
```sql
INSERT INTO vehicles (reg_number, vehicle_type, status, category_id) VALUES
  ('AB12 CDE', 'Truck', 'active', (SELECT id FROM vehicle_categories WHERE name = 'Truck')),
  ('FG34 HIJ', 'Van', 'active', (SELECT id FROM vehicle_categories WHERE name = 'Van')),
  ('KL56 MNO', 'Artic', 'active', (SELECT id FROM vehicle_categories WHERE name = 'Artic'));
```

### Add Custom Absence Reasons
```sql
INSERT INTO absence_reasons (name, is_paid, is_active) VALUES
  ('Unpaid leave', FALSE, TRUE),
  ('Training', TRUE, TRUE),
  ('Jury duty', TRUE, TRUE);
```

## 🔄 Updates & Migrations

When you need to update the schema:
1. Create migration files in `supabase/migrations/`
2. Name them with timestamps: `YYYYMMDD_description.sql`
3. Apply via Supabase SQL Editor or CLI
4. Keep this export file updated as your "source of truth"

## 📞 Support

### Useful Supabase Links
- [Documentation](https://supabase.com/docs)
- [RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Storage Guide](https://supabase.com/docs/guides/storage)
- [Community Forum](https://github.com/supabase/supabase/discussions)

### Verification Queries

Check your setup:

```sql
-- Count tables
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';
-- Should be 20+ tables

-- Check roles created
SELECT * FROM roles ORDER BY is_manager_admin DESC, name;

-- Check RLS is enabled
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;
-- Should show all your tables

-- Check your admin user
SELECT p.id, p.full_name, p.role, r.display_name, r.is_manager_admin, r.is_super_admin
FROM profiles p
LEFT JOIN roles r ON p.role_id = r.id
WHERE p.id = auth.uid();
```

## 📝 License

This database schema is designed to be reusable across multiple projects. Customize it to fit your needs!

---

**Version:** 1.0  
**Last Updated:** December 6, 2025  
**Compatibility:** Supabase, PostgreSQL 14+
