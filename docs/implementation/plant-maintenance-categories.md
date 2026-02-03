# Plant Machinery Maintenance Categories Implementation

## Summary

Successfully implemented hours-based maintenance categories for plant machinery to allow admins to configure service interval thresholds in the Fleet Settings page.

## Key Changes

### 1. **TypeScript Types** (`types/maintenance.ts`)
- ✅ Extended `MaintenanceCategory` type to include:
  - `type: 'date' | 'mileage' | 'hours'`
  - `alert_threshold_hours: number | null`
  - `applies_to: ('vehicle' | 'plant')[]`
- ✅ Updated `CreateCategoryRequest` and `UpdateCategoryRequest` interfaces
- ✅ Added `HoursThreshold` interface for hours-based calculations

### 2. **MaintenanceSettings Component** (`app/(dashboard)/maintenance/components/MaintenanceSettings.tsx`)
- ✅ Split display into two sections:
  - **Vehicle Maintenance Categories** - Shows date and mileage-based categories
  - **Plant Maintenance Categories** - Shows hours-based categories
- ✅ Added filtering logic based on `applies_to` field
- ✅ Both sections are independently collapsible
- ✅ Updated info card to explain the difference between vehicle and plant categories

### 3. **CategoryDialog Component** (`app/(dashboard)/maintenance/components/CategoryDialog.tsx`)
- ✅ Added third type option: **Hours** (alongside Date and Mileage)
- ✅ Added hours threshold input field
- ✅ Auto-sets `applies_to: ['plant']` when hours type is selected
- ✅ Default threshold: 50 hours
- ✅ Updated validation schema to include hours type

### 4. **API Routes**
- ✅ **POST `/api/maintenance/categories`** - Create categories with hours type
- ✅ **PUT `/api/maintenance/categories/[id]`** - Update categories with hours fields
- ✅ Added validation for hours-based categories
- ✅ Added `applies_to` field support in database inserts/updates

### 5. **Database Migration** (`supabase/migrations/20260203_add_plant_maintenance_categories.sql`)
- ✅ Created migration to seed default plant categories:
  - **Service Due (Hours)** - Workshop responsibility, 50-hour threshold
  - **LOLER Due** - Office responsibility, 30-day threshold (DATE-based)
- ✅ Added comprehensive documentation about hours vs. dates

## Important Distinctions

### Plant Machinery Fields

| Field Type | Tracking Method | Example Categories |
|------------|----------------|-------------------|
| **Service Intervals** | HOURS-based | Service Due (Hours) |
| **LOLER Inspections** | DATE-based | LOLER Due |

### Why Hours vs. Dates?

- **Service intervals for plant machinery** are based on **engine operating hours**, not calendar dates or mileage
- Plant machinery has hour meters (like odometers but counting operating hours)
- Service is due every X hours of operation (e.g., 250 hours, 500 hours)

- **LOLER inspections** are **calendar-based** legal compliance requirements
- Required every X months regardless of hours used
- Stored in `plant.loler_due_date` (DATE field)

### Database Schema Review

✅ **Current Implementation is Correct:**

1. **plant table:**
   - `current_hours` (INTEGER) - ✅ Correct for tracking operating hours
   - `loler_due_date` (DATE) - ✅ Correct for calendar-based compliance
   - `loler_last_inspection_date` (DATE) - ✅ Correct

2. **vehicle_maintenance table:**
   - `current_hours` (INTEGER) - ✅ Used for plant machinery
   - `last_service_hours` (INTEGER) - ✅ Last service at X hours
   - `next_service_hours` (INTEGER) - ✅ Service due at X hours
   - `last_hours_update` (TIMESTAMP) - ✅ When hours were last updated

3. **maintenance_categories table:**
   - `type` - Now supports 'date', 'mileage', AND 'hours' ✅
   - `alert_threshold_hours` (INTEGER) - ✅ Alert threshold in hours
   - `applies_to` (VARCHAR[]) - ✅ Filter categories by asset type

## Next Steps

### To Apply Changes:

1. **Run the migration** (when database connection is available):
   ```bash
   npx tsx scripts/migrations/run-migration.ts supabase/migrations/20260203_add_plant_maintenance_categories.sql
   ```
   
   Or manually via Supabase Dashboard:
   - Go to SQL Editor
   - Copy contents of `supabase/migrations/20260203_add_plant_maintenance_categories.sql`
   - Run the script

2. **Verify in UI:**
   - Navigate to `/fleet?tab=settings`
   - Should see two sections:
     - Vehicle Maintenance Categories (Tax Due, MOT Due, Service Due, etc.)
     - Plant Maintenance Categories (Service Due (Hours), LOLER Due)
   - Click "Add Category" to create new categories with hours type

3. **Test Creating Hours-Based Categories:**
   - Click "Add Category" 
   - Select "Hours" type
   - Set threshold (e.g., 50 hours)
   - Note: `applies_to` auto-sets to ['plant']
   - Save and verify it appears in Plant section

## Files Changed

```
Modified:
  - types/maintenance.ts
  - app/(dashboard)/maintenance/components/MaintenanceSettings.tsx
  - app/(dashboard)/maintenance/components/CategoryDialog.tsx
  - app/api/maintenance/categories/route.ts
  - app/api/maintenance/categories/[id]/route.ts

Created:
  - supabase/migrations/20260203_add_plant_maintenance_categories.sql
```

## Git Commit

Changes have been committed locally:
```
feat: add plant machinery hours-based maintenance categories
```

## Status

✅ **Complete** - All code changes implemented and committed locally.

⏳ **Pending** - Database migration needs to be run (see Next Steps above).

---

**Note:** No push to GitHub has been made. Changes are committed locally only. Say "push to GitHub" when ready to push.
