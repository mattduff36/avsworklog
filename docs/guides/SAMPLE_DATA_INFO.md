# Sample Data Information

## Overview
Sample data has been seeded into the database for testing the Reports functionality.

## What Was Created

### 👥 Employees (5)
- **John Smith** - EMP101 (john.smith@avsworklog.test)
- **Sarah Jones** - EMP102 (sarah.jones@avsworklog.test)
- **Mike Wilson** - EMP103 (mike.wilson@avsworklog.test)
- **Emma Brown** - EMP104 (emma.brown@avsworklog.test)
- **David Taylor** - EMP105 (david.taylor@avsworklog.test)

All employee passwords: `TestPass123!`

### 🚗 Vehicles (5)
- YX21ABC (Truck)
- YX22DEF (Artic)
- YX23GHI (Trailer)
- YX24JKL (Truck)
- YX25MNO (Van)

### 📅 Timesheets
- **Total:** 20 timesheets (5 employees × 4 weeks)
- **Entries:** 106 daily entries
- **Status:** Most approved, some submitted
- **Features:**
  - Random job codes (JOB001-JOB005, YARD)
  - Mix of regular work and yard work
  - Realistic working hours (8-10 hours/day)
  - Some days off (particularly weekends)
  - 4-7 working days per week per employee

### 🔍 Vehicle Inspections
- **Total:** 31 inspections
- **Defects:** 20 defect items found
- **Actions:** 16 actions created from defects
- **Features:**
  - Each employee performed 1-2 inspections per week
  - 26 inspection items per inspection (standard checklist)
  - ~30% of inspections contain defects
  - Random mileage readings
  - Most inspections approved
  - Actions automatically created for each defect with random priority levels

## Testing the Reports

### Login as Manager
To view and download reports:
1. Navigate to http://localhost:3000
2. Login with:
   - Email: `manager@avsworklog.test`
   - Password: `TestPass123!`
3. Go to Reports page

### Available Reports

#### 📊 Weekly Timesheet Summary
- Shows all timesheets with daily hours breakdown
- **NEW:** Includes Job Numbers column
- Shows status, submission dates
- Totals for approved timesheets

#### 💰 Payroll Report
- Approved timesheets only
- Regular hours vs. overtime (40hr week standard)
- Total hours summary

#### ✅ Inspection Compliance Report
- All inspections with status
- Compliance rate statistics
- Submission tracking

#### 🔧 Defects Report
- Lists all inspection items marked as defects
- Vehicle details and inspector information
- Defect comments included

### 📋 Actions Page
The Actions page displays defects that require attention:
- **16 Actions** created from inspection defects
- Priority levels: Low, Medium, High, Urgent
- Status tracking: Pending, In Progress, Completed
- Checkbox to mark actions as completed
- Links back to source inspection
- Filters to show pending vs completed actions

## Date Range for Testing

The sample data covers the last 4 weeks from today:
- Week 1: Most recent week ending on the last Sunday
- Week 2-4: Previous 3 weeks

Use the date picker in the Reports page to filter data.

## Re-running the Seed Script

To add more sample data or recreate it:

```bash
npm run seed:sample-data
```

**Note:** The script will create new users if they don't exist, or use existing ones if they do.

## Login Credentials Summary

| Role | Email | Password | Access |
|------|-------|----------|--------|
| Admin | admin@avsworklog.test | TestPass123! | Full system access |
| Manager | manager@avsworklog.test | TestPass123! | View all, approve forms, reports |
| Employee 1 | john.smith@avsworklog.test | TestPass123! | Own forms only |
| Employee 2 | sarah.jones@avsworklog.test | TestPass123! | Own forms only |
| Employee 3 | mike.wilson@avsworklog.test | TestPass123! | Own forms only |
| Employee 4 | emma.brown@avsworklog.test | TestPass123! | Own forms only |
| Employee 5 | david.taylor@avsworklog.test | TestPass123! | Own forms only |

## Testing Scenarios

### 1. Test Timesheet Reports
- Login as manager
- Go to Reports
- Select last month's date range
- Download "Weekly Timesheet Summary"
- Verify Job Numbers column is present

### 2. Test Payroll Calculation
- Download "Payroll Report"
- Check that overtime is calculated correctly (hours > 40)

### 3. Test Inspection Reports
- Download "Inspection Compliance Report"
- Check compliance rate calculation
- Download "Defects Report"
- Verify defect items are listed with details

### 4. Test Filtering
- Use different date ranges
- Verify data is filtered correctly

## Notes
- All timesheets have realistic working hours (6-8 AM start, 8-10 hour days)
- Job codes are randomly assigned from a pool of 6 codes
- Defects are randomly distributed across inspections (~30% have defects)
- Vehicles are randomly assigned to employees each week

