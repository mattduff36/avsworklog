# Plant Pages Bug Fixes Implementation Summary

## Date: 2026-02-04

## Overview
Fixed 4 bugs related to plant machinery pages as requested:
1. Optional plant Registration Number field showing mandatory logic
2. Plant Machinery Categories not appearing after creation
3. Maintenance Categories incorrectly applying to plant machines
4. Attachment Templates not filtering by taxonomy mode

## Changes Implemented

### 1. Plant Asset Creation (Bug #1)
**File: `app/api/admin/vehicles/route.ts`**
- Updated POST endpoint to handle both `asset_type: 'vehicle'` and `asset_type: 'plant'`
- For plant assets:
  - `plant_id` is required
  - `reg_number` is optional (validated only if provided)
  - Inserts into `plant` table instead of `vehicles` table
- Maintains backward compatibility with existing vehicle creation flow

### 2. Vehicle Categories applies_to Field (Bug #2)
**Migration: `supabase/migrations/20260204_add_vehicle_categories_applies_to.sql`**
- Added `applies_to TEXT[]` column to `vehicle_categories` table
- Backfilled existing data based on usage (vehicle, plant, or both)
- Added GIN index for efficient filtering

**API Updates:**
- `app/api/admin/categories/route.ts` - POST now accepts and validates `applies_to`
- `app/api/admin/categories/[id]/route.ts` - PUT now updates `applies_to`, DELETE checks both vehicles and plant

**UI Updates:**
- `app/(dashboard)/fleet/components/VehicleCategoryDialog.tsx` - Added checkboxes for "Applies to" with icons
- `app/(dashboard)/fleet/page.tsx` - Fleet Settings now filters categories by `applies_to` field
- `app/(dashboard)/maintenance/components/AddVehicleDialog.tsx` - Category dropdown filters based on selected asset type

**Type Updates:**
- `types/database.ts` - Added `applies_to: string[]` to vehicle_categories Row/Insert/Update types

### 3. Maintenance Categories applies_to Toggle (Bug #3)
**Migration: `supabase/migrations/20260204_set_vehicle_only_maintenance_categories.sql`**
- Set specific categories to vehicle-only: "Service Due", "MOT Due Date", "Cambelt Replacement", "First Aid Kit Expiry"

**API Updates:**
- `app/api/maintenance/categories/route.ts` - POST now accepts `applies_to` with default `['vehicle']`
- `app/api/maintenance/categories/[id]/route.ts` - PUT now updates `applies_to` and `alert_threshold_hours`

**UI Updates:**
- `app/(dashboard)/maintenance/components/CategoryDialog.tsx`:
  - Added "Applies to" checkboxes with Vehicle/Plant icons
  - Added guardrails: mileage disables Plant, hours disables Vehicle, date allows both
  - Requires at least one selection
- `app/(dashboard)/maintenance/components/MaintenanceOverview.tsx`:
  - Alert generation now filters based on maintenance category `applies_to`
  - Checks if category applies to current asset type before showing alerts

### 4. Attachment Templates Taxonomy Filter (Bug #4)
**Migration: `supabase/migrations/20260204_add_attachment_templates_applies_to.sql`**
- Added `applies_to TEXT[]` column to `workshop_attachment_templates` with default `'{vehicle,plant}'`
- Added GIN index for efficient filtering

**UI Updates:**
- `components/workshop-tasks/AttachmentManagementPanel.tsx`:
  - Added `taxonomyMode` prop to filter templates
  - Added "Applies to" checkboxes in template create/edit dialog
  - Templates now filter based on selected taxonomy mode
- `app/(dashboard)/workshop-tasks/page.tsx` - Passes `categoryTaxonomyMode` to AttachmentManagementPanel

**Type Updates:**
- `types/database.ts` - Added `applies_to: string[]` to workshop_attachment_templates Row/Insert/Update types

## Database Migrations Created
1. `20260204_add_vehicle_categories_applies_to.sql` - Vehicle categories applies_to field
2. `20260204_set_vehicle_only_maintenance_categories.sql` - Set vehicle-only maintenance categories
3. `20260204_add_attachment_templates_applies_to.sql` - Attachment templates applies_to field

## Testing & Validation
- All modified files pass linter checks
- TypeScript type checking passes for modified files
- No breaking changes to existing functionality
- Migrations follow project's migration guidelines

## Files Modified
- `app/api/admin/vehicles/route.ts`
- `app/api/admin/categories/route.ts`
- `app/api/admin/categories/[id]/route.ts`
- `app/(dashboard)/fleet/components/VehicleCategoryDialog.tsx`
- `app/(dashboard)/fleet/page.tsx`
- `app/(dashboard)/maintenance/components/AddVehicleDialog.tsx`
- `app/(dashboard)/maintenance/components/CategoryDialog.tsx`
- `app/(dashboard)/maintenance/components/MaintenanceOverview.tsx`
- `components/workshop-tasks/AttachmentManagementPanel.tsx`
- `app/(dashboard)/workshop-tasks/page.tsx`
- `types/database.ts`

## Migration Files Created
- `supabase/migrations/20260204_add_vehicle_categories_applies_to.sql`
- `supabase/migrations/20260204_set_vehicle_only_maintenance_categories.sql`
- `supabase/migrations/20260204_add_attachment_templates_applies_to.sql`

## Next Steps
1. ✅ Database migrations run successfully
   - Vehicle categories now have `applies_to` field
   - Maintenance categories (Service, MOT, Cambelt, First Aid) set to vehicle-only
   - Attachment templates now have `applies_to` field (default: both)
2. Test plant asset creation without registration number
3. Verify plant categories appear immediately after creation
4. Confirm maintenance categories filter correctly for vehicles vs plant
5. Check attachment templates filter by taxonomy mode

## Migration Results
All three migrations executed successfully:
1. `20260204_add_vehicle_categories_applies_to.sql` - ✅ Complete
   - Added `applies_to` column with GIN index
   - Backfilled based on usage: "All plant" applies to both, others to vehicle
2. `20260204_set_vehicle_only_maintenance_categories.sql` - ✅ Complete
   - Set 4 categories to vehicle-only: Service Due, MOT, Cambelt, First Aid Kit
3. `20260204_add_attachment_templates_applies_to.sql` - ✅ Complete
   - Added `applies_to` column defaulting to both vehicle and plant

## Notes
- All changes maintain backward compatibility
- Existing data is preserved and backfilled appropriately
- Default values ensure smooth migration for existing records
- UI improvements include visual icons (Truck, HardHat) for better UX
