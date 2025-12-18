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
2. ✅ **Automatic mileage updates** from vehicle inspections
3. ✅ **Proactive alerting** for due/overdue maintenance items
4. ✅ **Audit trail** for all maintenance date changes
5. ✅ **Easy vehicle management** directly from maintenance module
6. ✅ **Flexible category system** for adding new maintenance types
7. ✅ **Mobile-friendly interface** for field staff access

### Success Criteria
- [ ] All data from `ALL VANS.xlsx` successfully imported and linked to vehicles
- [ ] Vehicle inspection mileage automatically updates maintenance records
- [ ] Due Soon alerts show items within 30 days or 1000 miles
- [ ] Overdue alerts show items past due date/mileage
- [ ] Maintenance staff can update due dates with mandatory comments
- [ ] Can add/edit/delete maintenance categories without code changes
- [ ] Can add/edit/delete vehicles directly from maintenance page
- [ ] Demo page (`/admin/maintenance-demo`) removed after launch
- [ ] Dashboard tile links to new `/maintenance` page
- [ ] Zero downtime during migration

---

## User Stories

### US-1: Maintenance Staff View Maintenance Dashboard
**As a** maintenance team member  
**I want to** see all vehicle maintenance status at a glance  
**So that** I can quickly identify vehicles requiring attention

**Acceptance Criteria:**
- See "Overdue Tasks" section with all items past due
- See "Due Soon" section with items due within 30 days/1000 miles
- Color coding: Red (overdue), Amber (due soon), Green (ok)
- Can switch between Table, Card, and Form views
- Mobile responsive layout
- Shows current mileage from latest inspection

---

### US-2: Maintenance Staff Update Maintenance Record
**As a** maintenance team member  
**I want to** update a due date when maintenance is completed  
**So that** the system reflects current maintenance status

**Acceptance Criteria:**
- Click vehicle to open edit dialog
- Update any of the 5 maintenance categories (Tax, MOT, Service, Cambelt, First Aid)
- **Mandatory comment field** explaining the change
- Comment stored with timestamp and user ID for audit
- New due date calculated based on maintenance type standards
- Confirmation message on save
- Real-time update of due/overdue status

---

### US-3: System Automatically Updates Mileage
**As a** fleet manager  
**I want** vehicle mileage to update automatically from inspections  
**So that** maintenance staff always have accurate mileage data

**Acceptance Criteria:**
- When inspection submitted, mileage updates in maintenance table
- Service due calculations automatically recalculate
- Cambelt due calculations automatically recalculate
- No manual mileage entry required
- Mileage history tracked for each vehicle
- Shows "Last Updated" timestamp

---

### US-4: Maintenance Staff Add New Maintenance Category
**As a** maintenance team member  
**I want to** add a new maintenance category (e.g., Tyre Replacement, Brake Service)  
**So that** I can track additional maintenance items

**Acceptance Criteria:**
- "Add Category" button in maintenance settings
- Specify: Category name, Type (Date-based or Mileage-based), Alert threshold
- Category immediately available for all vehicles
- Can set default values for new vehicles
- Can edit/delete categories (with confirmation if in use)

---

### US-5: Maintenance Staff Manage Vehicles
**As a** maintenance team member  
**I want to** add/edit/delete vehicles from the maintenance page  
**So that** I don't need to navigate to separate vehicle management page

**Acceptance Criteria:**
- "Add Vehicle" button in maintenance page
- Quick add: Registration, Category, Initial mileage, All due dates
- Edit vehicle directly from table/card view
- Delete vehicle with confirmation (checks for related records)
- Bulk import from spreadsheet for initial setup
- Same functionality as `/admin/vehicles` page

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
- Matches vehicles by registration number
- Creates maintenance records for all 5 categories
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
  cambelt_done BOOLEAN DEFAULT FALSE,
  
  -- Tracking
  last_updated_at TIMESTAMP DEFAULT NOW(),
  last_updated_by UUID REFERENCES profiles(id),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_vehicle_maintenance_vehicle ON vehicle_maintenance(vehicle_id);
CREATE INDEX idx_vehicle_maintenance_tax_due ON vehicle_maintenance(tax_due_date);
CREATE INDEX idx_vehicle_maintenance_mot_due ON vehicle_maintenance(mot_due_date);
```

#### New Table: `maintenance_categories`
```sql
CREATE TABLE maintenance_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  type VARCHAR(20) NOT NULL CHECK (type IN ('date', 'mileage')),
  alert_threshold_days INTEGER, -- for date-based
  alert_threshold_miles INTEGER, -- for mileage-based
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Default categories
INSERT INTO maintenance_categories (name, type, alert_threshold_days, alert_threshold_miles) VALUES
('Tax Due Date', 'date', 30, NULL),
('MOT Due Date', 'date', 30, NULL),
('Service Due', 'mileage', NULL, 1000),
('Cambelt Replacement', 'mileage', NULL, 5000),
('First Aid Kit Expiry', 'date', 30, NULL);
```

#### New Table: `maintenance_history`
```sql
CREATE TABLE maintenance_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  maintenance_category_id UUID REFERENCES maintenance_categories(id),
  
  old_value VARCHAR(50),
  new_value VARCHAR(50),
  value_type VARCHAR(20) NOT NULL CHECK (value_type IN ('date', 'mileage', 'boolean')),
  
  comment TEXT NOT NULL, -- Mandatory comment for audit
  
  updated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_maintenance_history_vehicle ON maintenance_history(vehicle_id);
CREATE INDEX idx_maintenance_history_date ON maintenance_history(created_at);
```

#### Trigger: Auto-update mileage from inspections
```sql
CREATE OR REPLACE FUNCTION update_vehicle_maintenance_mileage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE vehicle_maintenance
  SET 
    current_mileage = NEW.current_mileage,
    last_updated_at = NOW()
  WHERE vehicle_id = NEW.vehicle_id
    AND (current_mileage IS NULL OR NEW.current_mileage > current_mileage);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_maintenance_mileage
AFTER INSERT OR UPDATE OF current_mileage
ON vehicle_inspections
FOR EACH ROW
EXECUTE FUNCTION update_vehicle_maintenance_mileage();
```

### File Structure

```
app/(dashboard)/
├── maintenance/
│   ├── page.tsx                     # Main maintenance page
│   ├── components/
│   │   ├── MaintenanceOverview.tsx  # Due/Overdue alerts
│   │   ├── MaintenanceTable.tsx     # Table view
│   │   ├── MaintenanceCards.tsx     # Card view
│   │   ├── MaintenanceForm.tsx      # Form view
│   │   ├── EditMaintenanceDialog.tsx # Edit dates modal
│   │   ├── VehicleQuickAdd.tsx      # Add vehicle inline
│   │   └── MaintenanceHistory.tsx   # Audit history view
│   └── lib/
│       ├── maintenanceCalculations.ts  # Due date logic
│       └── maintenanceTypes.ts         # TypeScript types

app/api/
├── maintenance/
│   ├── route.ts                     # GET/POST maintenance records
│   ├── [id]/route.ts                # PUT/DELETE specific record
│   ├── categories/route.ts          # Manage categories
│   └── history/[vehicleId]/route.ts # Get maintenance history

scripts/
└── migrations/
    └── import-maintenance-spreadsheet.ts  # One-time Excel import

lib/utils/
└── maintenanceAlerts.ts             # Alert calculation logic
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
  href: '/maintenance'  // Add working link
}
```

### Main Page Layout
**Route:** `/maintenance`

**Sections:**
1. **Header**
   - Title: "Vehicle Maintenance & Service"
   - Add Vehicle button
   - Export button
   - Settings gear icon (manage categories)

2. **Alert Panels** (Top of page)
   - Overdue Tasks (red background, urgent icon)
   - Due Soon (amber background, calendar icon)
   - Each shows: Vehicle, Task, Detail, Days/Miles remaining

3. **View Tabs**
   - Table View (default, spreadsheet-style)
   - Card View (one card per vehicle)
   - Form View (detailed sectioned layout)

4. **Table View Columns**
   - Registration (sortable, searchable)
   - Current Mileage
   - TAX Due (color coded)
   - MOT Due (color coded)
   - Next Service (color coded)
   - Cambelt Due (color coded)
   - First Aid Expiry (color coded)
   - Actions (Edit, History)

5. **Color Coding System**
   - 🔴 Red: Overdue (past date or mileage exceeded)
   - 🟡 Amber: Due Soon (within 30 days or 1000 miles)
   - 🟢 Green: OK (more than 30 days or 1000 miles)

### Edit Dialog
**Triggered by:** Click Edit on any vehicle

**Fields:**
- Vehicle: BG21 EXH (read-only, shows in header)
- Tax Due Date (date picker)
- MOT Due Date (date picker)
- Service Due Mileage (number input)
- Cambelt Due Mileage (number input)
- Cambelt Done (checkbox)
- First Aid Expiry (date picker)
- **Comment** (textarea, required, minimum 10 characters)
  - Placeholder: "e.g., MOT passed, renewed until Dec 2026"
  - Helper text: "Required: Explain what maintenance was performed"

**Actions:**
- Save Changes (disabled until comment entered)
- View History (opens history panel)
- Cancel

### Mobile Responsiveness
- Alert panels stack vertically on mobile
- Table view switches to card view automatically on small screens
- Edit dialog becomes full-screen modal on mobile
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

**Process:**
1. Read `D:\Websites\avsworklog\data\VAN SERVICE SHEETS\ALL VANS.xlsx`
2. Parse columns:
   - Registration → Match to `vehicles.reg_number`
   - Present Mileage → `current_mileage`
   - MOT Date Due → `mot_due_date`
   - Tax Date Due → `tax_due_date`
   - Miles Next Service → `next_service_mileage`
   - Miles Last Service → `last_service_mileage`
   - Miles Due Cambelt → `cambelt_due_mileage`
   - Cambelt Done → `cambelt_done`
   - First Aid Check → Parse to expiry date if needed

3. Validation:
   - Check vehicle exists in database
   - Validate date formats
   - Validate mileage numbers
   - Flag missing/invalid data

4. Insert records with comment:
   - Comment: "Imported from ALL VANS.xlsx spreadsheet on [date]"
   - Created by: Admin user ID

5. Generate report:
   - Successfully imported: X vehicles
   - Failed imports: Y vehicles (with reasons)
   - Missing vehicles: Z registrations

**Rollback Plan:**
```sql
-- If issues found during migration
DELETE FROM maintenance_history WHERE comment LIKE '%Imported from ALL VANS.xlsx%';
DELETE FROM vehicle_maintenance WHERE created_at > '[migration_start_time]';
```

### Phase 3: Validation & Testing
1. Manual verification of 10 sample vehicles
2. Check alert calculations match expected values
3. Test mileage auto-update from inspection
4. Verify audit trail working
5. Test on mobile devices

---

## User Permissions

### Access Control
**Admin & Managers:** Full access
- View all maintenance records
- Edit all maintenance records
- Add/edit/delete vehicles
- Add/edit/delete maintenance categories
- View audit history
- Export reports

**Maintenance Staff:** (If role created)
- View all maintenance records
- Edit maintenance records (with comments)
- Add vehicles
- Cannot delete vehicles or categories

**Regular Employees:** No access
- Maintenance module not visible in dashboard

### RLS Policies
```sql
-- Enable RLS
ALTER TABLE vehicle_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_history ENABLE ROW LEVEL SECURITY;

-- Admin/Manager full access
CREATE POLICY "Admins manage maintenance" ON vehicle_maintenance
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM profiles WHERE role IN ('admin', 'manager')
    )
  );

-- Maintenance history read for admins/managers
CREATE POLICY "Admins view history" ON maintenance_history
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM profiles WHERE role IN ('admin', 'manager')
    )
  );
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

**Columns:**
1. Year
2. Reg No.
3. Driver
4. Brand
5. Model
6. Present Mileage
7. Miles Next Service
8. Miles Last Service
9. Miles Due Cambelt
10. Cambelt Done
11. Fire Extinguisher
12. First Aid Check
13. Comments
14. Hardware ID
15. MOT Date Due
16. Tax Date Due
17. Defects (1wk - 4wk)

### B. Maintenance Category Standards
- **Tax:** Annual renewal, 30-day warning
- **MOT:** Annual test, 30-day warning
- **Service:** Every 10,000 miles, 1,000-mile warning
- **Cambelt:** Manufacturer specific (typically 60k-100k miles), 5,000-mile warning
- **First Aid Kit:** Annual expiry, 30-day warning

### C. Color Coding Reference
```typescript
const getStatusColor = (daysUntil: number, type: 'days' | 'miles') => {
  if (daysUntil < 0) return 'red';      // Overdue
  if (type === 'days' && daysUntil <= 30) return 'amber';
  if (type === 'miles' && daysUntil <= 1000) return 'amber';
  return 'green';                        // OK
};
```

---

**End of PRD**
