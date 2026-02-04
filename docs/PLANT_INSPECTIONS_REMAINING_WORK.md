# Plant Inspections Module - Remaining Implementation Work

## Overview
The foundation for the Plant Inspections module is complete and committed. This document outlines the remaining implementation work required to complete the module.

## ✅ Completed (Committed in `6850deb`)
1. Database migration: `inspection_daily_hours` table with RLS policies
2. Database types: Updated `types/database.ts`
3. Plant checklist: `lib/checklists/plant-checklists.ts` (22 items including "Greased")
4. Module permissions: Added `plant-inspections` to type system
5. Permissions granted to all managers/admins
6. Dashboard tile with darker orange branding
7. CSS styling: Plant-inspection color variants
8. Navigation: Inspections dropdown (Vehicle/Plant)
9. Forms configuration updated
10. Plant inspections list page: `/plant-inspections/page.tsx`

## 🔄 In Progress / Remaining Work

### 1. UI Pages (2 remaining)

#### A. New/Edit Plant Inspection Page (`/plant-inspections/new/page.tsx`)
**Source to adapt**: `/inspections/new/page.tsx` (2341 lines)

**Key changes needed**:
- Replace `vehicle_id` with `plant_id` throughout
- Replace vehicle selector with plant selector (from `plant` table)
- Change "REG NUMBER" to "PLANT NUMBER" in labels
- Remove `current_mileage` field (not applicable to plant)
- **Add daily hours capture**: 7 input fields (Mon-Sun) for hours worked
  - Store in `inspection_daily_hours` table
  - Link via `inspection_id`
  - Validation: Require hours for days with checklist activity
- Use `PLANT_INSPECTION_ITEMS` from `lib/checklists/plant-checklists.ts`
- Update API endpoints:
  - `/api/inspections/*` → `/api/plant-inspections/*`
  - Sync defect tasks: `/api/plant-inspections/sync-defect-tasks`
  - Locked defects: `/api/plant-inspections/locked-defects?plantId=...`
  - Inform workshop: `/api/plant-inspections/inform-workshop`
- Offline queue: Include `dailyHours` in queued data

**Duplicate prevention logic**:
```typescript
// Check for existing inspection on same day
.eq('plant_id', selectedPlantId)
.eq('inspection_end_date', endDate)
```

#### B. View Plant Inspection Page (`/plant-inspections/[id]/page.tsx`)
**Source to adapt**: `/inspections/[id]/page.tsx` (1039 lines)

**Key changes needed**:
- Replace `vehicle_id` with `plant_id` in queries
- Join `plant` table instead of `vehicles`
- Fetch and display daily hours from `inspection_daily_hours`
- Display "PLANT NUMBER" instead of "REG NO."
- Remove mileage display
- Update PDF download: `/api/plant-inspections/${id}/pdf`
- Allow editing daily hours when status is 'draft'

### 2. API Endpoints (5 endpoints)

All endpoints should follow the pattern from vehicle inspections but use `plant_id` and `applies_to='plant'`.

#### A. PDF Generation (`/api/plant-inspections/[id]/pdf/route.ts`)
**Source**: `/api/inspections/[id]/pdf/route.ts`

**Changes**:
- Query `plant` table instead of `vehicles`
- Fetch `inspection_daily_hours` for the inspection
- Join: `plant(plant_id, nickname, vehicle_categories(name))`
- Pass plant data and daily hours to `PlantInspectionPDF` component
- Filename: `plant-inspection-{plant_id}-{date}.pdf`

#### B. Delete (`/api/plant-inspections/[id]/delete/route.ts`)
**Source**: `/api/inspections/[id]/delete/route.ts`

**Changes**:
- Verify `plant_id IS NOT NULL` before deleting
- Daily hours cascade-delete automatically (ON DELETE CASCADE)

#### C. Sync Defect Tasks (`/api/plant-inspections/sync-defect-tasks/route.ts`)
**Source**: `/api/inspections/sync-defect-tasks/route.ts`

**Changes**:
- Accept `plantId` instead of `vehicleId` in request body
- Query `actions` table: `.eq('plant_id', plantId)`
- Filter categories: `.eq('applies_to', 'plant')`
- Task title format: `"Plant {plant.plant_id}: {item_description}"`
- Insert `actions` rows with:
  - `plant_id` set
  - `vehicle_id` NULL
  - `action_type='inspection_defect'`

#### D. Locked Defects (`/api/plant-inspections/locked-defects/route.ts`)
**Source**: `/api/inspections/locked-defects/route.ts`

**Changes**:
- Accept `plantId` query parameter
- Query: `.eq('plant_id', plantId).eq('action_type', 'inspection_defect')`
- Return locked items for the specified plant

#### E. Inform Workshop (`/api/plant-inspections/inform-workshop/route.ts`)
**Source**: `/api/inspections/inform-workshop/route.ts`

**Changes**:
- Accept `plantId` in request body
- Create `actions` row with:
  - `plant_id` set
  - `vehicle_id` NULL
  - `action_type='workshop_vehicle_task'`
- Filter categories: `.eq('applies_to', 'plant')`
- Task description: Reference plant ID

### 3. PDF Template

#### `lib/pdf/plant-inspection-pdf.tsx`
**Source**: `lib/pdf/inspection-pdf.tsx`

**Key elements** (based on physical pad form):
```tsx
// Page structure:
1. Header: "OPERATED PLANT INSPECTION PAD"
2. Info row:
   - PLANT NUMBER (from plant.plant_id)
   - OPERATORS NAME (from profile.full_name)
3. HOURS table (Mon-Sun):
   - 7 columns for days of week
   - Display hours from inspection_daily_hours
4. Checklist (22 rows):
   - Use PLANT_INSPECTION_ITEMS
   - 7 columns (Mon-Sun) for checkbox status
5. Additional fields:
   - "Checked By" signature line
   - "Defects / Comments" text area
```

**Data props**:
```typescript
interface PlantInspectionPDFProps {
  inspection: {
    id: string;
    inspection_date: string;
    inspection_end_date: string;
    inspector_comments: string | null;
    signature_data: string | null;
  };
  plant: {
    plant_id: string;
    nickname: string | null;
    vehicle_categories: { name: string } | null;
  };
  operator: {
    full_name: string;
  };
  items: Array<{
    item_number: number;
    item_description: string;
    day_of_week: number;
    status: 'ok' | 'attention' | 'na';
    comments: string | null;
  }>;
  dailyHours: Array<{
    day_of_week: number; // 1-7
    hours: number | null;
  }>;
}
```

### 4. Offline Sync Extension

#### `lib/stores/offline-queue.ts`
**Location**: Find the `processQueue` function, specifically the `type === 'inspection'` handler.

**Changes needed**:
```typescript
// In the inspection creation block:
if (queueItem.action === 'create' && queueItem.data.plant_id) {
  // After inserting inspection, also insert daily hours
  const dailyHours = queueItem.data.dailyHours; // Array of { day_of_week, hours }
  
  if (dailyHours && Array.isArray(dailyHours)) {
    const hoursToInsert = dailyHours.map(dh => ({
      inspection_id: insertedInspectionId,
      day_of_week: dh.day_of_week,
      hours: dh.hours
    }));
    
    const { error: hoursError } = await supabase
      .from('inspection_daily_hours')
      .insert(hoursToInsert);
    
    if (hoursError) {
      console.error('Failed to sync daily hours:', hoursError);
      // Continue processing - inspection still created
    }
  }
}
```

**Queue payload structure** (from new page):
```typescript
{
  type: 'inspection',
  action: 'create',
  data: {
    plant_id: selectedPlantId,
    // ... other inspection fields
    dailyHours: [
      { day_of_week: 1, hours: 8 },
      { day_of_week: 2, hours: 7 },
      // ... etc
    ]
  }
}
```

### 5. Tests

#### A. Plant Checklist Test (`tests/unit/plant-checklist.test.ts`)
```typescript
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';

describe('Plant Inspection Checklist', () => {
  it('should have exactly 22 items', () => {
    expect(PLANT_INSPECTION_ITEMS.length).toBe(22);
  });

  it('should include "Greased" as the 22nd item', () => {
    expect(PLANT_INSPECTION_ITEMS[21]).toBe('Greased');
  });

  it('should not have duplicate items', () => {
    const uniqueItems = new Set(PLANT_INSPECTION_ITEMS);
    expect(uniqueItems.size).toBe(PLANT_INSPECTION_ITEMS.length);
  });
});
```

#### B. Plant Defect Task Idempotency Test (`tests/integration/plant-defect-idempotency.test.ts`)
**Source pattern**: `tests/integration/inspection-defect-idempotency.test.ts`

**Key test cases**:
1. Creating defect task with `plant_id` (not `vehicle_id`)
2. Idempotency: Re-syncing same defect doesn't create duplicate
3. Status updates: Changing defect status updates existing task
4. Category filtering: Only uses categories with `applies_to='plant'`
5. Task title format: Uses `plant.plant_id` not `vehicle.reg_number`

## Implementation Notes

### Database Queries
When querying `vehicle_inspections` for plant inspections:
```sql
SELECT * FROM vehicle_inspections 
WHERE plant_id IS NOT NULL 
  AND vehicle_id IS NULL;
```

### Workshop Task Categories
Ensure workshop task categories support plant:
```sql
SELECT * FROM workshop_task_categories 
WHERE applies_to = 'plant' OR applies_to IS NULL;
```

### Duplicate Detection
Check for existing inspection by:
- `plant_id` + `inspection_end_date` (same logic as vehicle)

### Validation Rules
- Require plant selection (equivalent to vehicle selection)
- Require at least one checklist item marked per day
- For submitted inspections: Require hours for any day with checklist activity
- Hours range: 0-24 per day

## Testing Checklist

Once implementation is complete, test:

- [ ] Create new plant inspection
- [ ] Save as draft
- [ ] Edit draft
- [ ] Submit inspection
- [ ] Download PDF
- [ ] View submitted inspection
- [ ] Delete inspection (manager only)
- [ ] Offline: Create inspection while offline
- [ ] Offline: Sync queues correctly when back online
- [ ] Daily hours: Saved and displayed correctly
- [ ] Defect tasks: Created with `plant_id` and `applies_to='plant'`
- [ ] Locked defects: Prevent editing items with active tasks
- [ ] Navigation: Dropdown shows both Vehicle and Plant Inspections
- [ ] Permissions: Only users with `plant-inspections` module can access
- [ ] Dashboard: Plant Inspections tile visible to authorized users
- [ ] Filters: Employee, status, and plant filters work correctly
- [ ] Realtime: Updates appear automatically

## Migration Runbook

Before deploying, run the migration:
```bash
# Follow docs/guides/HOW_TO_RUN_MIGRATIONS.md
npm run migration:run -- 20260204_create_inspection_daily_hours.sql
```

## Related Files

**Foundation (Complete)**:
- `supabase/migrations/20260204_create_inspection_daily_hours.sql`
- `types/database.ts`
- `lib/checklists/plant-checklists.ts`
- `types/roles.ts`
- `lib/utils/permissions.ts`
- `lib/config/forms.ts`
- `lib/config/navigation.ts`
- `app/globals.css`
- `components/layout/Navbar.tsx`
- `app/(dashboard)/dashboard/page.tsx`
- `app/(dashboard)/plant-inspections/page.tsx`

**To Create**:
- `app/(dashboard)/plant-inspections/new/page.tsx`
- `app/(dashboard)/plant-inspections/[id]/page.tsx`
- `app/api/plant-inspections/[id]/pdf/route.ts`
- `app/api/plant-inspections/[id]/delete/route.ts`
- `app/api/plant-inspections/sync-defect-tasks/route.ts`
- `app/api/plant-inspections/locked-defects/route.ts`
- `app/api/plant-inspections/inform-workshop/route.ts`
- `lib/pdf/plant-inspection-pdf.tsx`
- `tests/unit/plant-checklist.test.ts`
- `tests/integration/plant-defect-idempotency.test.ts`

**To Modify**:
- `lib/stores/offline-queue.ts` (add daily hours sync logic)
