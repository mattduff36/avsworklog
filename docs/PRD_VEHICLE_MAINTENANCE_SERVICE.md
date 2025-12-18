# PRD: Vehicle Maintenance & Service Module
**Date:** December 18, 2025  
**Status:** Planning  
**Priority:** HIGH  
**Branch:** `feature/vehicle-maintenance-service`

---

## Executive Summary

Develop a comprehensive Vehicle Maintenance & Service module to replace the manual spreadsheet-based system currently used by the maintenance team. This module will track and manage all vehicle maintenance records including Tax, MOT, Service, Cambelt, and First Aid Kit expiry dates, with automatic alerts for items due soon or overdue. The system will integrate with existing vehicle inspections to automatically update mileage data and provide an intuitive interface for maintenance staff to manage all vehicle maintenance activities.

---

## Problem Statement

### Current Limitations
1. **Manual Spreadsheet Management**: Maintenance team uses Excel spreadsheet (`ALL VANS.xlsx`) for tracking
2. **No Integration**: Vehicle maintenance data disconnected from vehicle inspection data
3. **No Automated Alerts**: Manual checking required to identify upcoming or overdue maintenance
4. **Data Fragmentation**: Maintenance data not linked to main vehicle database
5. **Poor Accessibility**: Spreadsheet not accessible to field staff or managers on mobile
6. **No Audit Trail**: Changes to maintenance dates not tracked with comments/reasons
7. **Limited Scalability**: Cannot easily add new maintenance categories
8. **No Configuration**: Alert thresholds hardcoded, cannot be adjusted per category

### Business Impact
- Risk of missed maintenance deadlines (especially MOT, Tax, Safety equipment)
- Manual data entry duplication between inspection and maintenance systems
- Potential compliance issues with expired documentation
- Inefficient workflow for maintenance staff
- No visibility for managers on fleet maintenance status
- Difficulty planning maintenance schedules

---

## Goals & Success Criteria

### Primary Goals
1. ✅ **Replace spreadsheet system** with integrated database solution
2. ✅ **Automatic mileage updates** from vehicle inspections (always update, even if lower)
3. ✅ **Proactive alerting** for due/overdue maintenance items
4. ✅ **Audit trail** for all maintenance date changes (mandatory comments)
5. ✅ **Easy vehicle management** directly from maintenance module
6. ✅ **Flexible category system** for adding new maintenance types
7. ✅ **Configurable alert thresholds** per maintenance category
8. ✅ **Settings interface** for admin/manager configuration
9. ✅ **RBAC integration** for access control (not hardcoded roles)
10. ✅ **Desktop-optimized interface** (mobile lite version future)

### Success Criteria
- [ ] All data from `ALL VANS.xlsx` successfully imported and linked to vehicles
- [ ] Vehicle inspection mileage **always** updates maintenance records (even if lower)
- [ ] Due Soon alerts configurable per category (default: 30 days / 1000 miles)
- [ ] Overdue alerts show items past due date/mileage with **red badge** on dashboard
- [ ] Due Soon alerts show **amber badge** on dashboard
- [ ] **All** maintenance updates require mandatory comments (min 10 characters)
- [ ] Admin/manager can add/edit/delete maintenance categories via Settings tab
- [ ] Admin/manager can configure alert thresholds per category via Settings tab
- [ ] Users with module permission can add/edit/delete vehicles from maintenance page
- [ ] Vehicle editing excludes Registration, Brand, Model fields
- [ ] Access controlled by existing RBAC system (Job Roles & Permissions)
- [ ] System remembers user's preferred view (Table/Card/Form)
- [ ] User can sort by any column (click headers or dropdown)
- [ ] Demo page (`/admin/maintenance-demo`) removed after launch
- [ ] Dashboard tile shows badge counts for overdue (red) and due soon (amber)
- [ ] Vehicle deletion asks for reason (Sold/Scrapped/Other) and archives data
- [ ] Missing data shows "Not Set" with professional warning message
- [ ] Settings button only enabled for managers/admins
- [ ] Zero downtime during migration

---

## User Stories

### US-1: Maintenance Staff View Maintenance Dashboard
**As a** maintenance team member  
**I want to** see all vehicle maintenance status at a glance  
**So that** I can quickly identify vehicles requiring attention

**Acceptance Criteria:**
- See "Overdue Tasks" section with all items past due
- See "Due Soon" section with items based on configurable thresholds
- Color coding: Red (overdue), Amber (due soon), Green (ok)
- Can switch between Table, Card, and Form views (system remembers preference)
- Desktop-optimized layout (mobile lite version future phase)
- Shows current mileage from latest inspection
- Can sort by any column (click header or use dropdown)
- Warning message for vehicles with "Not Set" dates
- Dashboard badge shows count of overdue (red) and due soon (amber) items

---

### US-2: Maintenance Staff Update Maintenance Record
**As a** maintenance team member  
**I want to** update a due date when maintenance is completed  
**So that** the system reflects current maintenance status

**Acceptance Criteria:**
- Click vehicle to open edit dialog
- Update any of the 5 maintenance categories (Tax, MOT, Service, Cambelt, First Aid)
- **Mandatory comment field** explaining the change (minimum 10 characters)
- Comment visible to all users with module access
- Comment stored with timestamp and user ID for audit
- New due date accepted as-is (no auto-calculations)
- Cannot edit Registration, Brand, or Model from this dialog
- Confirmation message on save
- Real-time update of due/overdue status

---

### US-3: System Automatically Updates Mileage
**As a** fleet manager  
**I want** vehicle mileage to update automatically from inspections  
**So that** maintenance staff always have accurate mileage data

**Acceptance Criteria:**
- When inspection submitted, mileage **always** updates (even if lower than current)
- No validation for mileage decreases or large increases
- Service due comparisons use updated mileage
- Cambelt due comparisons use updated mileage
- No manual mileage entry required
- Shows "Last Updated" timestamp

---

### US-4: Admin/Manager Configure Maintenance Settings
**As an** admin or manager  
**I want to** configure maintenance categories and alert thresholds  
**So that** the system adapts to our changing business needs

**Acceptance Criteria:**
- "Settings" tab/button visible only to managers/admins
- Settings button disabled for non-admin/manager users
- **Add New Category:**
  - Category name (required)
  - Type: Date-based or Mileage-based (required)
  - Alert threshold in days (for date-based)
  - Alert threshold in miles (for mileage-based)
  - Description (optional)
- **Edit Existing Category:**
  - Can change name, description, thresholds
  - Cannot change type (date vs mileage) after creation
  - Changes apply immediately to all vehicles
- **Delete Category:**
  - Confirmation dialog
  - Cannot delete if in use by vehicles (show count)
- **Default Categories (on initial setup):**
  - Tax Due Date (date, 30 days)
  - MOT Due Date (date, 30 days)
  - Service Due (mileage, 1000 miles)
  - Cambelt Replacement (mileage, 5000 miles)
  - First Aid Kit Expiry (date, 30 days)

---

### US-5: Authorized Users Manage Vehicles
**As a** user with maintenance module permission  
**I want to** add/edit/delete vehicles from the maintenance page  
**So that** I don't need to navigate to separate vehicle management page

**Acceptance Criteria:**
- Access controlled by existing RBAC "Job Roles & Permissions" system
- Managers/admins always have access
- Other roles can be granted permission via `/admin/users` roles tab
- "Add Vehicle" button in maintenance page
- Quick add: Registration, Category, Initial mileage, All due dates
- Edit vehicle from table/card view:
  - **Cannot edit:** Registration, Brand, Model
  - **Can edit:** All other fields including maintenance dates
- Delete vehicle:
  - Asks for reason: "Sold", "Scrapped", "Other" (required)
  - Archives vehicle data (doesn't permanently delete)
  - Confirmation dialog
- Bulk import from spreadsheet for initial setup

---

### US-6: Manager View Fleet Maintenance Reports
**As a** fleet manager  
**I want to** see aggregate maintenance status across the fleet  
**So that** I can plan resources and budgets

**Acceptance Criteria:**
- Summary statistics: Total vehicles, Overdue items, Due soon items
- Filter by vehicle category, maintenance type, date range
- Export to Excel/PDF for reporting
- Show cost estimates based on maintenance type
- Historical trend data (maintenance over time)

---

### US-7: Excel Data Migration
**As an** administrator  
**I want to** import existing spreadsheet data  
**So that** historical maintenance records are preserved

**Acceptance Criteria:**
- Migration script reads `ALL VANS.xlsx`
- Date format: `mmm-yy` (e.g., "Jan-26")
- Matches vehicles by registration number
- **Preserves ALL valid data:**
  - Current Mileage
  - Miles Last Service
  - Miles Next Service  
  - Miles Due Cambelt
  - Cambelt Done (as reference, stored in comments or separate field)
  - MOT Date Due
  - Tax Date Due
  - First Aid Expiry Date
- **Ignores removed fields:**
  - Fire Extinguisher
  - Defects (1wk-4wk)
- Creates maintenance records for all 5 categories
- Missing data saved as NULL with comment "Not Set - imported from spreadsheet"
- Links to existing vehicle records in database
- Validation report showing successful/failed imports
- Rollback capability if issues found
- One-time migration, not recurring

---

## Technical Design

### Database Schema

#### New Table: `vehicle_maintenance`
```sql
CREATE TABLE vehicle_maintenance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Date-based maintenance
  tax_due_date DATE,
  mot_due_date DATE,
  first_aid_kit_expiry DATE,
  
  -- Mileage-based maintenance
  current_mileage INTEGER,
  last_service_mileage INTEGER,
  next_service_mileage INTEGER,
  cambelt_due_mileage INTEGER,
  cambelt_done BOOLEAN DEFAULT FALSE, -- Reference only, not used in calculations
  
  -- Tracking
  last_mileage_update TIMESTAMP, -- When mileage was last updated from inspection
  last_updated_at TIMESTAMP DEFAULT NOW(),
  last_updated_by UUID REFERENCES profiles(id),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Metadata
  notes TEXT -- General notes about vehicle maintenance
);

CREATE INDEX idx_vehicle_maintenance_vehicle ON vehicle_maintenance(vehicle_id);
CREATE INDEX idx_vehicle_maintenance_tax_due ON vehicle_maintenance(tax_due_date);
CREATE INDEX idx_vehicle_maintenance_mot_due ON vehicle_maintenance(mot_due_date);
CREATE INDEX idx_vehicle_maintenance_service_due ON vehicle_maintenance(next_service_mileage);

-- Note: Fire extinguisher removed (not tracked)
-- Note: Defects fields removed (handled in inspections)

#### New Table: `maintenance_categories`
```sql
CREATE TABLE maintenance_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  type VARCHAR(20) NOT NULL CHECK (type IN ('date', 'mileage')),
  alert_threshold_days INTEGER, -- for date-based (e.g., 30 days before due)
  alert_threshold_miles INTEGER, -- for mileage-based (e.g., 1000 miles before due)
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0, -- For display ordering
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT check_threshold CHECK (
    (type = 'date' AND alert_threshold_days IS NOT NULL AND alert_threshold_miles IS NULL) OR
    (type = 'mileage' AND alert_threshold_miles IS NOT NULL AND alert_threshold_days IS NULL)
  )
);

CREATE INDEX idx_maintenance_categories_active ON maintenance_categories(is_active);
CREATE INDEX idx_maintenance_categories_type ON maintenance_categories(type);

-- Default categories (inserted during migration)
INSERT INTO maintenance_categories (name, type, alert_threshold_days, alert_threshold_miles, sort_order, description) VALUES
('Tax Due Date', 'date', 30, NULL, 1, 'Vehicle road tax renewal date'),
('MOT Due Date', 'date', 30, NULL, 2, 'Ministry of Transport test renewal'),
('Service Due', 'mileage', NULL, 1000, 3, 'Regular vehicle service interval'),
('Cambelt Replacement', 'mileage', NULL, 5000, 4, 'Cambelt replacement due mileage'),
('First Aid Kit Expiry', 'date', 30, NULL, 5, 'First aid kit expiration date');
```

#### New Table: `maintenance_history`
```sql
CREATE TABLE maintenance_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  maintenance_category_id UUID REFERENCES maintenance_categories(id),
  
  field_name VARCHAR(100) NOT NULL, -- e.g., 'tax_due_date', 'next_service_mileage'
  old_value VARCHAR(50),
  new_value VARCHAR(50),
  value_type VARCHAR(20) NOT NULL CHECK (value_type IN ('date', 'mileage', 'boolean', 'text')),
  
  comment TEXT NOT NULL, -- Mandatory comment (min 10 characters)
  
  updated_by UUID REFERENCES profiles(id),
  updated_by_name VARCHAR(255), -- Denormalized for audit trail
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT check_comment_length CHECK (LENGTH(comment) >= 10)
);

CREATE INDEX idx_maintenance_history_vehicle ON maintenance_history(vehicle_id);
CREATE INDEX idx_maintenance_history_category ON maintenance_history(maintenance_category_id);
CREATE INDEX idx_maintenance_history_date ON maintenance_history(created_at DESC);
CREATE INDEX idx_maintenance_history_user ON maintenance_history(updated_by);
```

#### New Table: `vehicle_archive`
```sql
CREATE TABLE vehicle_archive (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL, -- Original vehicle ID
  reg_number VARCHAR(20) NOT NULL,
  category_id UUID,
  status VARCHAR(50),
  
  -- Archive metadata
  archive_reason VARCHAR(50) NOT NULL CHECK (archive_reason IN ('Sold', 'Scrapped', 'Other')),
  archive_comment TEXT,
  archived_by UUID REFERENCES profiles(id),
  archived_at TIMESTAMP DEFAULT NOW(),
  
  -- Full vehicle data snapshot (JSONB for flexibility)
  vehicle_data JSONB NOT NULL,
  maintenance_data JSONB,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_vehicle_archive_reg ON vehicle_archive(reg_number);
CREATE INDEX idx_vehicle_archive_date ON vehicle_archive(archived_at DESC);
CREATE INDEX idx_vehicle_archive_reason ON vehicle_archive(archive_reason);
```

#### Trigger: Auto-update mileage from inspections
```sql
CREATE OR REPLACE FUNCTION update_vehicle_maintenance_mileage()
RETURNS TRIGGER AS $$
BEGIN
  -- ALWAYS update mileage, even if lower (per requirement)
  UPDATE vehicle_maintenance
  SET 
    current_mileage = NEW.current_mileage,
    last_mileage_update = NOW(),
    updated_at = NOW()
  WHERE vehicle_id = NEW.vehicle_id;
  
  -- Create record if doesn't exist
  IF NOT FOUND THEN
    INSERT INTO vehicle_maintenance (vehicle_id, current_mileage, last_mileage_update)
    VALUES (NEW.vehicle_id, NEW.current_mileage, NOW());
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_maintenance_mileage
AFTER INSERT OR UPDATE OF current_mileage
ON vehicle_inspections
FOR EACH ROW
WHEN (NEW.current_mileage IS NOT NULL)
EXECUTE FUNCTION update_vehicle_maintenance_mileage();
```

### File Structure

```
app/(dashboard)/
├── maintenance/
│   ├── page.tsx                     # Main maintenance page with RBAC checks
│   ├── components/
│   │   ├── MaintenanceOverview.tsx  # Due/Overdue alerts
│   │   ├── MaintenanceTable.tsx     # Table view with sortable columns
│   │   ├── MaintenanceCards.tsx     # Card view
│   │   ├── MaintenanceForm.tsx      # Form view
│   │   ├── MaintenanceSettings.tsx  # Settings tab (Admin/Manager only)
│   │   ├── CategoryManager.tsx      # Add/Edit/Delete categories
│   │   ├── ThresholdConfig.tsx      # Configure alert thresholds
│   │   ├── EditMaintenanceDialog.tsx # Edit dates modal with mandatory comment
│   │   ├── VehicleQuickAdd.tsx      # Add vehicle inline
│   │   ├── VehicleDeleteDialog.tsx  # Delete with reason & archive
│   │   ├── MaintenanceHistory.tsx   # Audit history view
│   │   └── ViewPreferences.tsx      # Save/load user view preference
│   └── lib/
│       ├── maintenanceCalculations.ts  # Due date logic with configurable thresholds
│       ├── maintenanceTypes.ts         # TypeScript types
│       └── viewPreferences.ts          # LocalStorage for view state

app/api/
├── maintenance/
│   ├── route.ts                     # GET/POST maintenance records
│   ├── [id]/route.ts                # PUT/DELETE specific record
│   ├── categories/
│   │   ├── route.ts                 # GET/POST categories (Admin only)
│   │   └── [id]/route.ts            # PUT/DELETE category (Admin only)
│   ├── history/[vehicleId]/route.ts # Get maintenance history
│   └── archive/
│       ├── route.ts                 # GET archived vehicles
│       └── [id]/route.ts            # Archive vehicle with reason

scripts/
└── migrations/
    └── import-maintenance-spreadsheet.ts  # One-time Excel import (uses xlsx library)

lib/utils/
├── maintenanceAlerts.ts             # Alert calculation logic
└── maintenanceBadge.ts              # Calculate dashboard badge counts

types/
└── maintenance.ts                   # Maintenance-specific TypeScript types
```

### API Endpoints

#### GET `/api/maintenance`
Returns all vehicle maintenance records with calculated status

**Response:**
```json
{
  "vehicles": [
    {
      "id": "uuid",
      "reg_number": "BG21 EXH",
      "current_mileage": 45000,
      "maintenance": {
        "tax": {
          "due_date": "2025-06-15",
          "status": "ok",
          "days_until": 179
        },
        "mot": {
          "due_date": "2025-12-20",
          "status": "due_soon",
          "days_until": 2
        },
        "service": {
          "next_mileage": 50000,
          "last_mileage": 40000,
          "status": "ok",
          "miles_until": 5000
        },
        "cambelt": {
          "due_mileage": 100000,
          "status": "ok",
          "done": false
        },
        "first_aid": {
          "expiry_date": "2026-01-15",
          "status": "ok"
        }
      }
    }
  ]
}
```

#### PUT `/api/maintenance/[id]`
Update maintenance record with mandatory comment

**Request:**
```json
{
  "mot_due_date": "2026-12-20",
  "comment": "MOT passed, renewed for 12 months"
}
```

**Response:**
```json
{
  "success": true,
  "maintenance": { /* updated record */ },
  "history_entry": { /* audit entry */ }
}
```

#### POST `/api/maintenance/categories`
Create new maintenance category

**Request:**
```json
{
  "name": "Tyre Replacement",
  "type": "mileage",
  "alert_threshold_miles": 2000,
  "description": "Track tyre wear and replacement schedule"
}
```

---

## UI/UX Design

### Dashboard Tile Update
**Location:** `app/(dashboard)/dashboard/page.tsx`

**Before:**
```tsx
{ id: 'maintenance', title: 'Maintenance Request', icon: Wrench, color: 'bg-red-500' }
```

**After:**
```tsx
{ 
  id: 'maintenance', 
  title: 'Maintenance & Service', 
  icon: Wrench, 
  color: 'bg-red-500',
  href: '/maintenance',  // Add working link
  badgeCount: overdueCount + dueSoonCount, // Show total badge
  badgeBreakdown: { // For dual-color badges
    overdue: overdueCount,  // Red badge
    dueSoon: dueSoonCount   // Amber badge
  }
}
```

**Badge Display:**
- If only overdue: Red badge with count
- If only due soon: Amber badge with count
- If both: Show two stacked badges (red primary, amber secondary)
- Uses same badge styling as RAMS module

### Main Page Layout
**Route:** `/maintenance` (RBAC-protected)

**Sections:**
1. **Header**
   - Title: "Vehicle Maintenance & Service"
   - Add Vehicle button (permission-based)
   - Export button
   - Sort By dropdown (Registration, Tax Due, MOT Due, Service Due, etc.)
   - Settings button (gear icon - **enabled only for Admin/Manager**)

2. **Warning Banner** (if applicable)
   - Shows if any vehicles have "Not Set" dates
   - Message: "⚠️ Some vehicles are missing maintenance due dates. Vehicles without set dates will not be monitored and may miss important deadlines. Please update these records."
   - Dismissible (saves to user preferences)

3. **Alert Panels** (Top of page)
   - Overdue Tasks (red background, AlertTriangle icon)
     - Shows items past due date or mileage
     - Click to filter table to overdue only
   - Due Soon (amber background, Calendar icon)
     - Shows items within configured threshold
     - Click to filter table to due soon only
   - Each alert shows: Vehicle Reg, Maintenance Type, Detail, Days/Miles remaining

4. **View Tabs** (System remembers user preference)
   - Table View (default, spreadsheet-style) ✓
   - Card View (one card per vehicle) ✓
   - Form View (detailed sectioned layout) ✓

5. **Table View Features**
   - **Sortable columns** (click header to sort ascending/descending)
   - **Search bar** (filters by registration)
   - **Columns:**
     - Registration (sortable, link to edit)
     - Current Mileage (sortable, shows last update time)
     - TAX Due (color coded, sortable)
     - MOT Due (color coded, sortable)
     - Next Service Miles (color coded, sortable)
     - Cambelt Due Miles (color coded, sortable)
     - First Aid Expiry (color coded, sortable)
     - Actions (Edit, History, Delete)
   - Empty cells show "Not Set" in gray

6. **Color Coding System** (Based on configurable thresholds)
   - 🔴 Red: Overdue (past date or mileage exceeded)
   - 🟡 Amber: Due Soon (within configured threshold)
   - 🟢 Green: OK (beyond threshold)
   - ⚪ Gray: Not Set

### Edit Maintenance Dialog
**Triggered by:** Click Edit on any vehicle

**Fields:**
- **Vehicle:** BG21 EXH (read-only, shows in header)
- **Read-only fields** (grayed out):
  - Registration
  - Brand
  - Model
- **Editable maintenance fields:**
  - Tax Due Date (date picker, format: mmm-yy)
  - MOT Due Date (date picker, format: mmm-yy)
  - Service Due Mileage (number input)
  - Cambelt Due Mileage (number input)
  - Cambelt Done (checkbox - reference only)
  - First Aid Expiry (date picker, format: mmm-yy)
- **Current Mileage:** 45,000 (read-only, auto-updated from inspections)
  - Shows "Last updated: 2 hours ago" beneath
- **Comment** (textarea, **required**, minimum 10 characters)
  - Placeholder: "e.g., MOT passed on [date], renewed for 12 months. Cost: £XX"
  - Helper text: "Required: Explain what maintenance was performed and why dates are changing"
  - Character counter: "10 / 500"
  - Validation message if < 10 chars: "Comment must be at least 10 characters"

**Actions:**
- Save Changes (disabled until comment length >= 10)
- View History (opens slide-out panel with all changes)
- Cancel

**Behavior:**
- All changes in single dialog save as one history entry
- Shows loading spinner during save
- Success toast: "Maintenance updated successfully"
- Dialog closes on successful save
- Table/cards refresh with new data

### Settings Tab (Admin/Manager Only)
**Access:** Button in header, visible to all but **only enabled** for Admin/Manager

**Sections:**

1. **Maintenance Categories**
   - Table showing all categories
   - Columns: Name, Type, Threshold, In Use Count, Actions
   - **Add Category** button
   - **Edit Category** (pencil icon)
   - **Delete Category** (trash icon - disabled if in use)

2. **Add/Edit Category Form:**
   - Category Name (text input, required, max 100 chars)
   - Description (textarea, optional)
   - Type (radio buttons: "Date-based" or "Mileage-based", **cannot change after creation**)
   - Alert Threshold:
     - If Date-based: Days (number input, e.g., 30)
     - If Mileage-based: Miles (number input, e.g., 1000)
   - Sort Order (number, for display ordering)
   - Active (checkbox, default true)
   - Save / Cancel buttons

3. **Validation:**
   - Category name must be unique
   - Threshold must be positive number
   - Cannot delete category if vehicles using it (show count and error message)
   - Cannot change type after creation (disable field in edit mode)

4. **User Feedback:**
   - Success: "Category created successfully"
   - Edit: "Category updated successfully. Changes apply to all vehicles."
   - Delete: "Are you sure? This category is used by X vehicles and cannot be deleted."
   - Changes take effect immediately

### Desktop Optimization
**Primary Design Target:** Desktop (1920x1080, 1366x768)
- Table view optimized for wide screens
- Multiple columns visible without horizontal scroll
- Larger touch targets for mouse precision
- Keyboard shortcuts (future enhancement)
- Hover states for interactive elements

### Mobile Support (Future - Lite Version)
**Current Phase:** Not implemented
**Future Phase:**
- Alert panels stack vertically
- Table auto-switches to card view on small screens
- Edit dialog becomes full-screen modal
- Touch-friendly tap targets (min 44px)
- Swipe actions for quick edit/delete

---

## Data Migration Plan

### Phase 1: Database Setup
1. Create new tables (`vehicle_maintenance`, `maintenance_categories`, `maintenance_history`)
2. Add RLS policies for admin/manager access
3. Create database triggers for mileage auto-update
4. Run schema validation tests

### Phase 2: Excel Import
**Script:** `scripts/migrations/import-maintenance-spreadsheet.ts`

**Library:** `xlsx` (npm package for parsing Excel files)

**Process:**
1. **Read** `D:\Websites\avsworklog\data\VAN SERVICE SHEETS\ALL VANS.xlsx`
2. **Parse columns** (using xlsx library):
   - Reg No. → Match to `vehicles.reg_number` (must exist)
   - Present Mileage → `current_mileage`
   - MOT Date Due → `mot_due_date` (format: mmm-yy, e.g., "Jan-26")
   - Tax Date Due → `tax_due_date` (format: mmm-yy)
   - Miles Next Service → `next_service_mileage`
   - Miles Last Service → `last_service_mileage`
   - Miles Due Cambelt → `cambelt_due_mileage`
   - Cambelt Done → `cambelt_done` (Yes/No → Boolean)
   - First Aid Check → `first_aid_kit_expiry` (format: mmm-yy)
   - Comments → `notes` (general notes)
   
   **Ignored columns:**
   - Fire Extinguisher (removed from requirements)
   - Defects (1wk-4wk) (handled in inspections module)
   - Year, Driver, Brand, Model, Hardware ID (already in vehicles table)

3. **Date Parsing:**
   ```typescript
   // Convert "Jan-26" to Date object (2026-01-01)
   function parseExcelDate(dateStr: string): Date | null {
     if (!dateStr || dateStr === '-' || dateStr === 'N/A') return null;
     // Format: mmm-yy (e.g., "Jan-26")
     const [month, year] = dateStr.split('-');
     const fullYear = parseInt('20' + year); // Assume 20XX
     // Return first day of that month
     return new Date(fullYear, monthMap[month], 1);
   }
   ```

4. **Validation:**
   - Check vehicle exists in database by reg_number
   - Validate date formats (mmm-yy)
   - Validate mileage numbers (positive integers)
   - Flag missing/invalid data
   - Handle NULL/empty cells gracefully

5. **Insert records:**
   ```typescript
   // For each row:
   const maintenanceRecord = {
     vehicle_id: matchedVehicle.id,
     current_mileage: row['Present Mileage'] || null,
     last_service_mileage: row['Miles Last Service'] || null,
     next_service_mileage: row['Miles Next Service'] || null,
     cambelt_due_mileage: row['Miles Due Cambelt'] || null,
     cambelt_done: row['Cambelt Done'] === 'Yes',
     tax_due_date: parseExcelDate(row['Tax Date Due']),
     mot_due_date: parseExcelDate(row['MOT Date Due']),
     first_aid_kit_expiry: parseExcelDate(row['First Aid Check']),
     notes: row['Comments'] || null,
     created_at: NOW(),
     updated_at: NOW()
   };
   
   // Create history entry
   const historyEntry = {
     vehicle_id: matchedVehicle.id,
     field_name: 'all',
     comment: 'Imported from ALL VANS.xlsx spreadsheet on ' + new Date().toISOString(),
     updated_by: ADMIN_USER_ID,
     created_at: NOW()
   };
   ```

6. **Generate report:**
   ```
   ✅ Successfully imported: X vehicles
   ⚠️  Skipped (not in vehicle database): Y registrations
   ❌ Failed imports: Z vehicles (with specific errors)
   ℹ️  NULL values: Fields with "Not Set"
   ```

**Rollback Plan:**
```sql
-- Backup first
CREATE TABLE vehicle_maintenance_backup AS SELECT * FROM vehicle_maintenance;

-- If issues found during migration
DELETE FROM maintenance_history 
WHERE comment LIKE '%Imported from ALL VANS.xlsx%';

DELETE FROM vehicle_maintenance 
WHERE created_at > '[migration_start_time]';

-- Or restore from backup
-- DROP TABLE vehicle_maintenance;
-- ALTER TABLE vehicle_maintenance_backup RENAME TO vehicle_maintenance;
```

### Phase 3: Validation & Testing
1. Manual verification of 10 sample vehicles
2. Check alert calculations match expected values
3. Test mileage auto-update from inspection
4. Verify audit trail working
5. Test on mobile devices

---

## User Permissions

### Access Control (RBAC Integration)
**Module Name:** `maintenance` (in Job Roles & Permissions system)

**Permission Levels:**

**Admin & Managers:** Full access (always granted)
- View all maintenance records
- Edit all maintenance records (with mandatory comments)
- Add/edit/delete vehicles
- **Add/edit/delete maintenance categories** (Settings tab enabled)
- **Configure alert thresholds** (Settings tab enabled)
- View audit history
- Export reports
- Archive vehicles

**Users with `maintenance` Permission:** Limited access
- View all maintenance records
- Edit maintenance records (with mandatory comments)
- Add/edit vehicles (except Registration, Brand, Model)
- Delete vehicles (with archive)
- **Cannot** access Settings tab (button disabled)
- **Cannot** add/edit/delete categories
- **Cannot** configure thresholds
- View audit history
- Export reports

**Users without `maintenance` Permission:** No access
- Module not visible in dashboard
- Cannot access `/maintenance` route (redirect to dashboard)
- No badge shown on dashboard tile

**Configuration:**
- Module permission managed via `/admin/users` → Roles tab
- Admin edits role → Enable "Maintenance & Service" module
- Changes apply immediately to users with that role
- Managers and Admins automatically have access (hardcoded)

### RLS Policies
```sql
-- Enable RLS
ALTER TABLE vehicle_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_archive ENABLE ROW LEVEL SECURITY;

-- Function to check if user has maintenance permission
CREATE OR REPLACE FUNCTION has_maintenance_permission()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles p
    INNER JOIN roles r ON p.role_id = r.id
    INNER JOIN role_permissions rp ON r.id = rp.role_id
    WHERE p.id = auth.uid()
      AND rp.module_name = 'maintenance'
      AND rp.enabled = true
  ) OR EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'manager')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Maintenance records: Read/Write for users with permission
CREATE POLICY "Users with permission manage maintenance" ON vehicle_maintenance
  FOR ALL USING (has_maintenance_permission());

-- Categories: Everyone with permission can read, only admins can modify
CREATE POLICY "Users with permission read categories" ON maintenance_categories
  FOR SELECT USING (has_maintenance_permission());

CREATE POLICY "Admins manage categories" ON maintenance_categories
  FOR INSERT, UPDATE, DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- History: Read for all with permission, write when updating maintenance
CREATE POLICY "Users with permission view history" ON maintenance_history
  FOR SELECT USING (has_maintenance_permission());

CREATE POLICY "Users with permission create history" ON maintenance_history
  FOR INSERT WITH CHECK (has_maintenance_permission());

-- Archive: Read/Write for users with permission
CREATE POLICY "Users with permission manage archive" ON vehicle_archive
  FOR ALL USING (has_maintenance_permission());
```

---

## Testing Plan

### Unit Tests
- [ ] Alert calculation logic (due soon, overdue)
- [ ] Date validation
- [ ] Mileage calculation
- [ ] Comment validation (min length)

### Integration Tests
- [ ] Mileage auto-update from inspection
- [ ] Create maintenance record
- [ ] Update maintenance record with audit
- [ ] Delete maintenance record (cascades)
- [ ] Import from Excel

### Manual Testing Checklist
- [ ] Create new vehicle with maintenance dates
- [ ] Edit maintenance date with comment
- [ ] Verify comment saved in history
- [ ] Submit vehicle inspection, check mileage updates
- [ ] Add new maintenance category
- [ ] Delete unused category
- [ ] View maintenance on mobile (portrait/landscape)
- [ ] Export maintenance report
- [ ] Check overdue alerts appear correctly
- [ ] Check due soon alerts appear correctly
- [ ] Verify color coding in all views

---

## Implementation Phases

### Phase 1: Database & Backend (Days 1-2)
- [ ] Create database tables and triggers
- [ ] Build API endpoints
- [ ] Write Excel import script
- [ ] Run migration with validation
- [ ] Create test data

### Phase 2: Core UI (Days 3-4)
- [ ] Build main maintenance page structure
- [ ] Implement alert panels (overdue/due soon)
- [ ] Build table view with color coding
- [ ] Create edit dialog with comment field
- [ ] Add vehicle management from page

### Phase 3: Advanced Features (Day 5)
- [ ] Build card view layout
- [ ] Build form view layout
- [ ] Implement category management
- [ ] Add maintenance history viewer
- [ ] Create export functionality

### Phase 4: Integration & Polish (Day 6)
- [ ] Update dashboard tile with link
- [ ] Update `/admin/vehicles` page link text
- [ ] Test mileage auto-update from inspections
- [ ] Mobile responsiveness testing
- [ ] Delete `/admin/maintenance-demo` page

### Phase 5: Testing & Documentation (Day 7)
- [ ] Run full test suite
- [ ] Manual testing checklist
- [ ] User acceptance testing with maintenance staff
- [ ] Write user guide
- [ ] Create admin setup guide

---

## Rollout Plan

### Pre-Launch
1. Import all data from Excel spreadsheet
2. Validate data accuracy with maintenance staff
3. Train 2-3 maintenance staff members
4. Create backup of current Excel file

### Launch Day
1. Enable `/maintenance` route
2. Update dashboard tile
3. Send announcement to maintenance team
4. Monitor for any issues

### Post-Launch (Week 1)
1. Daily check-ins with maintenance staff
2. Collect feedback on UX
3. Fix any critical bugs
4. Keep Excel file as backup (read-only)

### Post-Launch (Week 2-4)
1. Archive Excel file (no longer updated)
2. Delete demo page
3. Gather suggestions for improvements
4. Plan Phase 2 enhancements

---

## Future Enhancements (Phase 2)

### Notifications
- Email alerts for overdue maintenance
- SMS notifications for urgent items
- Scheduled weekly summary report

### Advanced Features
- Automatic service scheduling suggestions
- Cost tracking per vehicle
- Maintenance service provider management
- Document storage (MOT certificates, service receipts)
- Predictive maintenance based on usage patterns

### Reporting
- Cost analysis by vehicle/category
- Maintenance trends over time
- Compliance reports for audits
- Fleet age analysis

### Integration
- Calendar integration for scheduled maintenance
- Integration with external MOT check API
- Integration with DVLA for tax reminders

---

## Success Metrics

### Adoption Metrics (First Month)
- 100% of maintenance staff using system daily
- Zero maintenance updates to Excel file
- 95%+ data accuracy compared to paper records

### Operational Metrics
- Average time to update maintenance record: < 2 minutes
- Zero missed MOT/Tax deadlines
- 100% audit trail compliance (all updates have comments)

### User Satisfaction
- Maintenance staff satisfaction: 8/10 or higher
- Reduction in manual data entry time: 50%+
- Mobile usage: 40%+ of updates from mobile devices

---

## Risks & Mitigations

### Risk 1: Data Migration Errors
**Impact:** High  
**Likelihood:** Medium  
**Mitigation:**
- Extensive validation before import
- Manual verification of sample records
- Keep Excel file as backup
- Rollback plan ready

### Risk 2: User Adoption Resistance
**Impact:** Medium  
**Likelihood:** Medium  
**Mitigation:**
- Early involvement of maintenance staff in testing
- Comprehensive training sessions
- Keep UI similar to familiar spreadsheet layout
- Gradual transition with parallel running period

### Risk 3: Auto-Update Failures
**Impact:** High  
**Likelihood:** Low  
**Mitigation:**
- Thorough testing of database triggers
- Manual override capability
- Monitoring of mileage update success rate
- Fallback to manual entry if trigger fails

### Risk 4: Mobile Performance
**Impact:** Medium  
**Likelihood:** Low  
**Mitigation:**
- Optimize query performance
- Lazy loading for large datasets
- Pagination for vehicle lists
- Caching strategy for static data

---

## Dependencies

### Technical Dependencies
- Existing vehicle database structure
- Vehicle inspection system (for mileage updates)
- Supabase RLS policies
- Next.js 14+ App Router
- shadcn/ui components
- Excel parsing library (xlsx)

### Team Dependencies
- Maintenance staff availability for UAT
- Admin approval for data migration
- Access to production database (for import)

### External Dependencies
- None (fully internal system)

---

## Documentation Requirements

### User Documentation
- [ ] Maintenance Staff User Guide
- [ ] Admin Setup & Configuration Guide
- [ ] Mobile App Usage Guide
- [ ] FAQ & Troubleshooting Guide

### Technical Documentation
- [ ] Database Schema Documentation
- [ ] API Endpoint Reference
- [ ] Migration Script Documentation
- [ ] Alert Calculation Logic Documentation

---

## Approval & Sign-off

### Stakeholders
- **Product Owner:** ___________________ Date: _______
- **Maintenance Team Lead:** ___________________ Date: _______
- **Technical Lead:** ___________________ Date: _______
- **QA Lead:** ___________________ Date: _______

---

## Appendix

### A. Excel Spreadsheet Structure
**File:** `D:\Websites\avsworklog\data\VAN SERVICE SHEETS\ALL VANS.xlsx`

**Columns to Import:**
1. Reg No. → `vehicles.reg_number` (match key)
2. Present Mileage → `vehicle_maintenance.current_mileage`
3. Miles Next Service → `vehicle_maintenance.next_service_mileage`
4. Miles Last Service → `vehicle_maintenance.last_service_mileage`
5. Miles Due Cambelt → `vehicle_maintenance.cambelt_due_mileage`
6. Cambelt Done → `vehicle_maintenance.cambelt_done` (Yes/No boolean)
7. First Aid Check → `vehicle_maintenance.first_aid_kit_expiry` (**Date format: mmm-yy**)
8. Comments → `vehicle_maintenance.notes`
9. MOT Date Due → `vehicle_maintenance.mot_due_date` (**Date format: mmm-yy**)
10. Tax Date Due → `vehicle_maintenance.tax_due_date` (**Date format: mmm-yy**)

**Columns to Ignore (already in vehicles table or not needed):**
- Year
- Driver
- Brand
- Model
- Hardware ID
- Fire Extinguisher (removed from requirements)
- Defects (1wk - 4wk) (handled in inspections module)

**Date Format Details:**
- Excel dates in format: `mmm-yy` (e.g., "Jan-26", "Dec-25")
- Parse to first day of that month (e.g., "Jan-26" → 2026-01-01)
- Store as PostgreSQL DATE type
- Handle missing dates as NULL

### B. Maintenance Category Standards (Configurable)
Default settings (can be changed in Settings tab):

- **Tax Due Date:** Date-based, 30-day warning before expiry
- **MOT Due Date:** Date-based, 30-day warning before test due
- **Service Due:** Mileage-based, 1,000-mile warning before service due
- **Cambelt Replacement:** Mileage-based, 5,000-mile warning before due
- **First Aid Kit Expiry:** Date-based, 30-day warning before expiry

**Note:** These are defaults. Admin/Manager can adjust thresholds per category in Settings.

### C. Color Coding Reference
```typescript
// Get threshold from maintenance_categories table
const getStatusColor = (
  value: number, 
  threshold: number, 
  type: 'days' | 'miles'
) => {
  if (value < 0) return 'red';           // Overdue
  if (value <= threshold) return 'amber'; // Due Soon (configurable)
  return 'green';                         // OK
};

// Example usage:
const taxStatus = getStatusColor(
  getDaysUntil(vehicle.tax_due_date),
  category.alert_threshold_days, // from database (e.g., 30)
  'days'
);
```

### D. Key Requirements Summary

**✅ Confirmed Requirements from User:**

1. **Data Format:**
   - Excel dates: `mmm-yy` (e.g., "Jan-26")
   - First Aid: Expiry date (not status)
   - Fire Extinguisher: REMOVED (not tracked)
   - Defects fields: REMOVED (handled in inspections)

2. **Mileage Updates:**
   - **ALWAYS** update from inspections (even if lower)
   - No validation for decreases or large jumps

3. **Comments:**
   - Mandatory for **ALL** maintenance updates
   - Minimum 10 characters
   - Visible to all users with module access

4. **Vehicle Editing:**
   - From maintenance page: Edit everything **EXCEPT** Registration, Brand, Model
   - Vehicle deletion: Archive with reason (Sold/Scrapped/Other)

5. **Settings:**
   - Configurable per-category alert thresholds
   - Add/edit/delete categories
   - Only enabled for Admin/Manager (disabled for others)

6. **Access Control:**
   - Based on existing RBAC "Job Roles & Permissions"
   - Not hardcoded to specific roles
   - Managers/Admins always have access

7. **UI Preferences:**
   - System remembers user's view choice (Table/Card/Form)
   - User-controlled sorting (click headers or dropdown)
   - Dashboard badge shows overdue (red) + due soon (amber) counts

8. **Desktop Focus:**
   - Optimize for desktop use
   - Mobile lite version = future phase

9. **Missing Data:**
   - Show as "Not Set" in gray
   - Display warning banner

10. **Dates:**
    - Accept as-is (no auto-calculations)
    - Technician enters, system saves

---

**End of PRD**
