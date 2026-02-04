# Plant Inspections Module - Implementation Status

**Branch**: `feature/plant-inspections-module`
**Last Commit**: `1cc18b3`
**Status**: 75% Complete - Foundation Solid, UI Pages Remaining

## ✅ COMPLETED (Committed)

### 1. Foundation & Infrastructure (100%)
- ✅ Database migration: `inspection_daily_hours` table with RLS policies
- ✅ Database types: Extended `types/database.ts`
- ✅ Plant checklist: 22 items including "Greased"
- ✅ Module permissions: Full type system integration
- ✅ CSS theming: Darker orange brand colors
- ✅ Navigation: Dropdown menu with Vehicle/Plant options
- ✅ Dashboard: Plant Inspections tile with permission gating

### 2. API Endpoints (80% - 4 of 5)
- ✅ `DELETE /api/plant-inspections/[id]/delete`
- ✅ `GET /api/plant-inspections/locked-defects`
- ✅ `POST /api/plant-inspections/sync-defect-tasks` (simplified)
- ✅ `POST /api/plant-inspections/inform-workshop`
- ⏳ `GET /api/plant-inspections/[id]/pdf` (pending PDF template)

### 3. UI Pages (33% - 1 of 3)
- ✅ `/plant-inspections/page.tsx` - List page with filters
- ⏳ `/plant-inspections/new/page.tsx` - Create/Edit page (CRITICAL)
- ⏳ `/plant-inspections/[id]/page.tsx` - View page

## ⏳ REMAINING WORK (25%)

### Critical Priority (Required for MVP)

#### 1. New/Edit Plant Inspection Page
**File**: `app/(dashboard)/plant-inspections/new/page.tsx`  
**Complexity**: High (2341 lines to adapt)  
**Effort**: ~4-6 hours

**Source**: `/inspections/new/page.tsx`

**Key Adaptations Required**:
```typescript
// Replace vehicle selector with plant selector
const [selectedPlantId, setSelectedPlantId] = useState('');
const [plants, setPlants] = useState<Plant[]>([]);

// Add daily hours state (7 days: Mon-Sun)
const [dailyHours, setDailyHours] = useState<Record<number, number | null>>({
  1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null
});

// Remove mileage field entirely
// Remove: current_mileage

// Use plant checklist (22 items)
import { PLANT_INSPECTION_ITEMS } from '@/lib/checklists/plant-checklists';

// Update API endpoints
- /api/inspections/* → /api/plant-inspections/*
- locked-defects?vehicleId= → locked-defects?plantId=
- sync-defect-tasks with plantId
- inform-workshop with plantId

// Duplicate detection
.eq('plant_id', selectedPlantId)
.eq('inspection_end_date', endDate)

// Save daily hours
const dailyHoursToInsert = Object.entries(dailyHours)
  .filter(([_, hours]) => hours !== null)
  .map(([day, hours]) => ({
    inspection_id: newInspectionId,
    day_of_week: parseInt(day),
    hours
  }));

await supabase
  .from('inspection_daily_hours')
  .insert(dailyHoursToInsert);

// Offline queue
addToQueue({
  type: 'inspection',
  action: 'create',
  data: {
    plant_id: selectedPlantId,
    ...inspectionData,
    dailyHours: Object.entries(dailyHours).map(([day, hours]) => ({
      day_of_week: parseInt(day),
      hours
    }))
  }
});
```

**UI Changes**:
- Plant selector dropdown (from `plant` table)
- "PLANT NUMBER" label instead of "REG NO."
- Daily hours grid: 7 input fields (Mon-Sun)
- Validation: Require hours for days with checklist activity

#### 2. View Plant Inspection Page
**File**: `app/(dashboard)/plant-inspections/[id]/page.tsx`  
**Complexity**: Medium (1039 lines to adapt)  
**Effort**: ~2-3 hours

**Source**: `/inspections/[id]/page.tsx`

**Key Adaptations**:
```typescript
// Fetch inspection with plant details
.select(`
  *,
  plant (
    plant_id,
    nickname,
    vehicle_categories (name)
  ),
  profile:profiles!vehicle_inspections_user_id_fkey(full_name)
`)
.eq('id', inspectionId)
.not('plant_id', 'is', null)

// Fetch daily hours
const { data: dailyHours } = await supabase
  .from('inspection_daily_hours')
  .select('*')
  .eq('inspection_id', inspectionId)
  .order('day_of_week');

// Display plant number
<div>PLANT NUMBER: {inspection.plant.plant_id}</div>
{inspection.plant.nickname && <div>{inspection.plant.nickname}</div>}

// Display daily hours table
<div className="grid grid-cols-7 gap-2">
  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => {
    const hours = dailyHours.find(h => h.day_of_week === idx + 1);
    return (
      <div key={day}>
        <div className="font-semibold">{day}</div>
        <div>{hours?.hours || '-'}</div>
      </div>
    );
  })}
</div>

// Allow editing hours when status is 'draft'
```

#### 3. PDF Template
**File**: `lib/pdf/plant-inspection-pdf.tsx`  
**Complexity**: Medium  
**Effort**: ~2-3 hours

**Source**: `lib/pdf/inspection-pdf.tsx`

**Structure** (matching physical pad):
```tsx
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

export function PlantInspectionPDF({ inspection, plant, operator, items, dailyHours }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>OPERATED PLANT INSPECTION PAD</Text>
        </View>

        {/* Info Row */}
        <View style={styles.infoRow}>
          <View style={styles.infoBox}>
            <Text style={styles.label}>PLANT NUMBER</Text>
            <Text style={styles.value}>{plant.plant_id}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.label}>OPERATORS NAME</Text>
            <Text style={styles.value}>{operator.full_name}</Text>
          </View>
        </View>

        {/* Hours Table (Mon-Sun) */}
        <View style={styles.hoursTable}>
          <View style={styles.tableHeader}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
              <Text key={day} style={styles.dayHeader}>{day}</Text>
            ))}
          </View>
          <View style={styles.tableRow}>
            {[1,2,3,4,5,6,7].map(day => {
              const hours = dailyHours.find(h => h.day_of_week === day);
              return (
                <Text key={day} style={styles.hoursCell}>
                  {hours?.hours || '-'}
                </Text>
              );
            })}
          </View>
        </View>

        {/* Checklist (22 rows, 7 columns) */}
        <View style={styles.checklist}>
          {PLANT_INSPECTION_ITEMS.map((item, idx) => (
            <View key={idx} style={styles.checklistRow}>
              <Text style={styles.itemNumber}>{idx + 1}</Text>
              <Text style={styles.itemDescription}>{item}</Text>
              {[1,2,3,4,5,6,7].map(day => {
                const itemStatus = items.find(i => 
                  i.item_number === idx + 1 && i.day_of_week === day
                );
                return (
                  <View key={day} style={styles.statusCell}>
                    {itemStatus?.status === 'ok' && <Text>✓</Text>}
                    {itemStatus?.status === 'attention' && <Text>✗</Text>}
                    {itemStatus?.status === 'na' && <Text>N/A</Text>}
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        {/* Signature */}
        <View style={styles.signatureSection}>
          <Text style={styles.label}>Checked By:</Text>
          <View style={styles.signatureLine} />
        </View>

        {/* Defects/Comments */}
        <View style={styles.commentsSection}>
          <Text style={styles.label}>Defects / Comments:</Text>
          <Text style={styles.comments}>{inspection.inspector_comments || 'None'}</Text>
        </View>
      </Page>
    </Document>
  );
}
```

#### 4. PDF Generation Endpoint
**File**: `app/api/plant-inspections/[id]/pdf/route.ts`  
**Depends on**: PDF template completion

```typescript
// Fetch plant inspection with all data
const { data: inspection } = await supabase
  .from('vehicle_inspections')
  .select(`
    *,
    plant (plant_id, nickname, vehicle_categories(name)),
    profiles (full_name)
  `)
  .eq('id', inspectionId)
  .single();

// Fetch daily hours
const { data: dailyHours } = await supabase
  .from('inspection_daily_hours')
  .select('*')
  .eq('inspection_id', inspectionId);

// Fetch inspection items
const { data: items } = await supabase
  .from('inspection_items')
  .select('*')
  .eq('inspection_id', inspectionId);

// Generate PDF
const pdf = await renderToBuffer(
  <PlantInspectionPDF 
    inspection={inspection}
    plant={inspection.plant}
    operator={inspection.profiles}
    items={items}
    dailyHours={dailyHours}
  />
);

// Return as download
return new Response(pdf, {
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="plant-inspection-${plant.plant_id}-${date}.pdf"`
  }
});
```

### Medium Priority (Enhances reliability)

#### 5. Offline Sync Extension
**File**: `lib/stores/offline-queue.ts`  
**Effort**: ~30 minutes

**Location**: Find `processQueue` function, `type === 'inspection'` handler

```typescript
// After inserting inspection successfully
if (queueItem.action === 'create' && insertedData?.id) {
  const inspectionId = insertedData.id;
  
  // Sync daily hours if this is a plant inspection
  if (queueItem.data.plant_id && queueItem.data.dailyHours) {
    const hoursToInsert = queueItem.data.dailyHours.map((dh: any) => ({
      inspection_id: inspectionId,
      day_of_week: dh.day_of_week,
      hours: dh.hours
    }));
    
    const { error: hoursError } = await supabase
      .from('inspection_daily_hours')
      .insert(hoursToInsert);
    
    if (hoursError) {
      console.error('Failed to sync daily hours:', hoursError);
      // Continue - inspection still created
    }
  }
}
```

### Low Priority (Nice to have)

#### 6. Tests
**Effort**: ~1 hour

```typescript
// tests/unit/plant-checklist.test.ts
test('Plant checklist has 22 items including Greased', () => {
  expect(PLANT_INSPECTION_ITEMS.length).toBe(22);
  expect(PLANT_INSPECTION_ITEMS[21]).toBe('Greased');
});

// tests/integration/plant-defect-idempotency.test.ts
test('Plant defect tasks use plant_id not vehicle_id', async () => {
  // Create defect task with plant_id
  // Verify actions table has plant_id set, vehicle_id NULL
});
```

## 📋 COMPLETION CHECKLIST

When remaining work is done, verify:

- [ ] Run migration: `20260204_create_inspection_daily_hours.sql`
- [ ] Create new plant inspection (save as draft)
- [ ] Edit draft plant inspection
- [ ] Submit plant inspection
- [ ] View submitted plant inspection (with daily hours)
- [ ] Download PDF (shows plant number, hours table, 22 checklist items)
- [ ] Delete plant inspection (manager only)
- [ ] Offline: Create inspection while offline, verify sync
- [ ] Defect tasks: Create with plant_id, check workshop tab
- [ ] Locked defects: Mark item as defect, verify it locks in new inspection
- [ ] Navigation: Dropdown shows both Vehicle and Plant options
- [ ] Filters: Employee, status, and plant filters work on list page
- [ ] Permissions: Test with user who has only vehicle (not plant) access

## 🚀 DEPLOYMENT STEPS

1. **Merge to main** (after testing):
   ```bash
   git checkout main
   git merge feature/plant-inspections-module
   ```

2. **Run migration**:
   ```bash
   # Follow docs/guides/HOW_TO_RUN_MIGRATIONS.md
   npm run migration:run -- 20260204_create_inspection_daily_hours.sql
   ```

3. **Update role permissions**:
   - Grant `plant-inspections` module to appropriate roles in admin UI
   - Test with actual user accounts

4. **Verify workshop categories**:
   - Ensure categories exist with `applies_to='plant'`
   - Create if missing via admin interface

5. **Deploy to production**
   - Standard deployment process
   - Monitor error logs for plant inspection activity

## 📝 NOTES FOR CONTINUATION

### File Copying Strategy
The two remaining UI pages are large (3380 lines combined). Best approach:

1. Copy entire vehicle page to plant location
2. Global find/replace:
   - `vehicle_id` → `plant_id`
   - `vehicleId` → `plantId`
   - `reg_number` → `plant_id`
   - `vehicles` → `plant`
   - `Vehicle` → `Plant`
   - `INSPECTION_ITEMS` → `PLANT_INSPECTION_ITEMS`
3. Add daily hours UI components
4. Remove mileage-related code
5. Update API endpoint URLs
6. Test thoroughly

### Key Differences from Vehicle Inspections
| Aspect | Vehicle | Plant |
|--------|---------|-------|
| ID Field | `reg_number` (e.g., "AB12 CDE") | `plant_id` (e.g., "P001") |
| Mileage | Required field | Not applicable (removed) |
| Hours | Not tracked | Daily hours (Mon-Sun) required |
| Checklist | 26 items (varies by category) | 22 items (fixed) |
| PDF Title | "Vehicle Inspection" | "Operated Plant Inspection Pad" |

### Workshop Task Integration
- Plant defects create tasks in same `actions` table
- Use `plant_id` column (not `vehicle_id`)
- Filter categories by `applies_to='plant'`
- Task titles: "Plant {plant_id}: {description}"

## 📚 REFERENCE DOCUMENTS

- **Full specification**: `docs/PLANT_INSPECTIONS_REMAINING_WORK.md`
- **Migration guide**: `docs/guides/HOW_TO_RUN_MIGRATIONS.md`
- **Original plan**: `c:\Users\mattd\.cursor\plans\plant_inspections_module_b31b0648.plan.md`

## 🎯 SUMMARY

**Completed**: Infrastructure, database, permissions, navigation, API endpoints, list page  
**Remaining**: 2 UI pages (create/view), PDF template, PDF endpoint  
**Estimate**: ~8-12 hours to complete remaining work  
**Confidence**: High - patterns established, straightforward adaptation

The foundation is solid and all the hard architectural decisions are made. The remaining work is primarily copying existing vehicle inspection pages and adapting them for plant, which is well-documented and mechanical.
