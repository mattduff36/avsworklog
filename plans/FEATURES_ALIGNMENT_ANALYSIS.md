# Feature Plans Alignment Analysis
**Date:** 2026-01-14  
**Scope:** Features 1-4 implementation dependency check

---

## Executive Summary

✅ **CLEAR TO PROCEED** - All features align and will not break existing workflows when implemented in order.

**Dependencies confirmed:**
- Feature 2 depends on itself (must implement /fleet before Feature 4 references it)
- Feature 4 depends on Features 1 & 3 (updated plan now documents integrations)

**Critical adjustments required:**
- Feature 2 permission change from "admin-only" to "admin + manager" (documented below)
- Feature 3 "Uncategorised" category migration (inspection workflows depend on it)

---

## Feature-by-Feature Analysis

### Feature 1: Workshop Task Comments Timeline

**Status:** ✅ SAFE - No breaking changes

**What it does:**
- Adds new table `workshop_task_comments` for multi-note timeline
- Keeps existing `actions.logged_comment` and `actions.actioned_comment` fields
- Unified timeline merges status events + freeform comments

**Dependencies:**
- None (extends existing workshop tasks without breaking them)

**Impact on other features:**
- Feature 4 must integrate the new comments table (documented in updated plan)

**Codebase touchpoints verified:**
- `app/(dashboard)/workshop-tasks/page.tsx` - will add drawer
- `app/api/maintenance/history/[vehicleId]/route.ts` - Feature 4 will extend this

**Potential risks:** None identified

---

### Feature 2: Merge /maintenance and /admin/vehicles into /fleet

**Status:** ✅ SAFE with documented permission changes

**What it does:**
- Creates new `/fleet` route with tabs (Maintenance, Vehicles, Categories, Settings)
- Redirects `/maintenance` → `/fleet?tab=maintenance`
- Redirects `/admin/vehicles` → `/fleet?tab=vehicles`
- **Changes vehicle CRUD permissions from admin-only to admin + manager**

**Dependencies:**
- Must implement `/fleet` route before Feature 4 references `/fleet/vehicles/[vehicleId]/history`

**Critical Permission Change:**
Current API enforcement (admin-only):
```typescript
// app/api/admin/vehicles/route.ts (GET/POST)
if (!profile || profile.role?.name !== 'admin') {
  return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
}
```

Must change to (admin + manager):
```typescript
if (!profile || !profile.role?.is_manager_admin) {
  return NextResponse.json({ error: 'Forbidden: Manager or Admin access required' }, { status: 403 });
}
```

**Files requiring permission updates:**
1. `app/api/admin/vehicles/route.ts` (GET, POST)
2. `app/api/admin/vehicles/[id]/route.ts` (PUT, DELETE)
3. `app/api/admin/categories/route.ts` (GET, POST) - verify intended scope
4. `app/api/admin/categories/[id]/route.ts` (PUT, DELETE) - verify intended scope

**Helper function available:**
`lib/utils/permissions.ts` exports `isManagerOrAdmin(userId)` which checks `profile?.roles?.is_manager_admin`

**Navigation updates required:**
- `lib/config/navigation.ts`: Update "Maintenance" → "Fleet" and "Vehicles" → point to `/fleet?tab=vehicles`
- `app/(dashboard)/dashboard/page.tsx`: Admin tiles link to `/fleet?tab=vehicles`

**Codebase touchpoints verified:**
- No hardcoded dependencies on `/maintenance` or `/admin/vehicles` routes in business logic
- All navigation is centralized in `lib/config/navigation.ts`

**Potential risks:**
- Medium: Manager role gains vehicle master data access (intended per plan)
- Low: Redirects must preserve query params for deep linking

---

### Feature 3: Workshop Task Types Taxonomy (2-tier)

**Status:** ✅ SAFE with migration strategy documented

**What it does:**
- Repurposes `workshop_task_categories` as top-level (Service/Repair/Modification/Other)
- Adds new `workshop_task_subcategories` table (Brakes/Engine/Electrical/etc)
- Adds `actions.workshop_subcategory_id` FK
- Backfills existing categories into subcategories under appropriate top-level category

**Critical Migration Point: "Uncategorised" Category**

Current inspection workflows depend on finding "Uncategorised":
```typescript
// app/(dashboard)/inspections/new/page.tsx (line 949-955)
const { data: uncategorisedCategory } = await supabase
  .from('workshop_task_categories')
  .select('id')
  .eq('name', 'Uncategorised')
  .eq('applies_to', 'vehicle')
  .single();
```

**Migration must ensure:**
1. After migration, a subcategory named "Uncategorised" (or renamed to "Other") exists under top-level "Other" category
2. Inspection workflows updated to reference the new subcategory structure OR
3. Migration creates a compatibility view/trigger so existing queries still work during transition

**Recommended approach (from Feature 3 plan):**
- Create top-level "Other" category
- Convert existing "Uncategorised" to subcategory under "Other" 
- Update inspection workflows to set `workshop_subcategory_id` instead of `workshop_category_id`

**Dependencies:**
- Feature 4 must display both category + subcategory (documented in updated plan)

**Codebase touchpoints verified:**
- Inspection workflows: `app/(dashboard)/inspections/new/page.tsx`, `app/(dashboard)/inspections/[id]/page.tsx`
- Workshop tasks UI: `app/(dashboard)/workshop-tasks/page.tsx`
- Maintenance history: `app/api/maintenance/history/[vehicleId]/route.ts`
- Actions page: `app/(dashboard)/actions/page.tsx` (filters workshop tasks)

**Potential risks:**
- Medium: Inspection defect auto-creation breaks if "Uncategorised" not found after migration
- Mitigation: Ensure backfill creates default subcategory and update inspection code

---

### Feature 4: Maintenance History UI (Modal → Page)

**Status:** ✅ SAFE with Feature 1 & 3 integrations documented

**What it does:**
- Creates dedicated route `/fleet/vehicles/[vehicleId]/history`
- Tabs: Maintenance | MOT | Documents | Notes
- Extracts components from existing dialogs for reuse
- Replaces dialog-on-dialog pattern with tab-based navigation

**Dependencies:**
- **Feature 1:** Must query and display `workshop_task_comments` table
- **Feature 2:** Must use `/fleet` route (created by Feature 2)
- **Feature 3:** Must display both category + subcategory with UI metadata

**Integration requirements (now documented in plan):**
1. `WorkshopTaskTimeline` component must:
   - Query `workshop_task_comments` table via API
   - Render full comment threads (not just single `logged_comment`/`actioned_comment`)
   - Display category badge + subcategory badge
   - Apply UI styling from taxonomy metadata
2. API endpoint `/api/maintenance/history/[vehicleId]` must:
   - Join `workshop_task_comments` table
   - Join both `workshop_task_categories` (top-level) AND `workshop_task_subcategories`
   - Return UI metadata for badge styling

**Codebase touchpoints verified:**
- Existing dialogs: `app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx`, `MotHistoryDialog.tsx`
- API endpoint: `app/api/maintenance/history/[vehicleId]/route.ts`
- Entry points: `app/(dashboard)/maintenance/page.tsx`, `app/(dashboard)/admin/vehicles/page.tsx`

**Potential risks:**
- Low: Component extraction must not break existing dialog usage during transition
- Mitigation: Keep dialogs as wrappers during rollout (documented in plan Phase 2)

---

## Cross-Feature Compatibility Matrix

| From → To | Feature 1 | Feature 2 | Feature 3 | Feature 4 |
|-----------|-----------|-----------|-----------|-----------|
| **Feature 1** | - | ✅ No impact | ✅ No impact | ⚠️ **F4 must integrate** |
| **Feature 2** | ✅ No impact | - | ✅ No impact | ⚠️ **F4 uses /fleet route** |
| **Feature 3** | ✅ No impact | ✅ No impact | - | ⚠️ **F4 must display 2-tier** |
| **Feature 4** | N/A (F4 last) | N/A | N/A | - |

✅ = No breaking changes  
⚠️ = Integration required (documented)

---

## Existing Workflows That Must Not Break

### 1. Inspection Defect Workflow ✅ SAFE
**Files:** `app/(dashboard)/inspections/new/page.tsx`, `app/(dashboard)/inspections/[id]/page.tsx`

**Current behavior:**
- On inspection submission with failed items, auto-creates `actions` rows
- Sets `action_type='inspection_defect'`
- Looks up "Uncategorised" category and sets `workshop_category_id`

**Feature 3 impact:**
- Must update to set `workshop_subcategory_id` to the migrated "Uncategorised" subcategory
- Documented in Feature 3 migration plan

**Verification needed during Feature 3:**
- [ ] Inspection submission still creates workshop tasks
- [ ] Tasks appear in Workshop Tasks module
- [ ] Default category/subcategory correctly assigned

---

### 2. Workshop Tasks Module ✅ SAFE
**Files:** `app/(dashboard)/workshop-tasks/page.tsx`

**Current behavior:**
- Filters `actions` by `action_type IN ('inspection_defect', 'workshop_vehicle_task')`
- Displays category badge
- Status workflow: Pending → In Progress → Completed
- Settings tab for category CRUD (manager/admin)

**Feature impacts:**
- **Feature 1:** Adds comments drawer (non-breaking extension)
- **Feature 3:** Category dropdown becomes 2-tier (category → subcategory filter)

**Verification needed:**
- [ ] Feature 1: Comments drawer opens/closes without breaking task list
- [ ] Feature 3: 2-tier category selection works, existing tasks display correctly

---

### 3. Manager Actions Page ✅ SAFE
**Files:** `app/(dashboard)/actions/page.tsx`

**Current behavior:**
- Filters OUT workshop tasks: `action_type NOT IN ('inspection_defect', 'workshop_vehicle_task')`
- Shows only `action_type='manager_action'` or null

**Feature impacts:**
- None (workshop tasks remain separate)

**Verification needed:**
- [ ] Workshop tasks do not appear on Actions page after all features

---

### 4. Maintenance Module ✅ SAFE with redirects
**Files:** `app/(dashboard)/maintenance/page.tsx`, `app/(dashboard)/maintenance/components/*`

**Current behavior:**
- Lists vehicles with maintenance status
- Opens MaintenanceHistoryDialog on row click
- Add/Edit/Retire vehicle via dialogs
- DVLA sync

**Feature impacts:**
- **Feature 2:** Route redirects to `/fleet?tab=maintenance`, UI extracted to shared components
- **Feature 4:** History dialog becomes link to dedicated page

**Verification needed:**
- [ ] Feature 2: `/maintenance` bookmark still works (redirects correctly)
- [ ] Feature 4: "View history" navigates to new page, back button returns correctly

---

### 5. Admin Vehicles Page ✅ SAFE with permission expansion
**Files:** `app/(dashboard)/admin/vehicles/page.tsx`

**Current behavior:**
- Admin-only vehicle master data CRUD
- Category CRUD
- Vehicle stats cards
- Links to `/maintenance` (stale link to demo)

**Feature impacts:**
- **Feature 2:** Route redirects to `/fleet?tab=vehicles`, **managers gain access**
- **Feature 4:** Adds "View history" link (currently missing)

**Verification needed:**
- [ ] Feature 2: Managers can access vehicle CRUD
- [ ] Feature 2: Employees still blocked from vehicle master data
- [ ] Feature 4: History link works from vehicles table

---

## Database Schema Changes Summary

### Feature 1: New Tables
```sql
CREATE TABLE workshop_task_comments (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES actions(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**RLS:** Workshop-permitted users can CRUD own comments, managers can moderate

**Indexes:**
- Composite: `(task_id, created_at DESC)`
- Single: `author_id`

**Impact:** None (additive)

---

### Feature 3: Schema Changes
```sql
-- Repurpose workshop_task_categories as top-level
ALTER TABLE workshop_task_categories 
  ADD COLUMN slug TEXT,
  ADD COLUMN ui_color TEXT,
  ADD COLUMN ui_icon TEXT,
  ADD COLUMN ui_badge_style TEXT;

-- New subcategories table
CREATE TABLE workshop_task_subcategories (
  id UUID PRIMARY KEY,
  category_id UUID REFERENCES workshop_task_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  ui_color TEXT,
  ui_icon TEXT,
  ui_badge_style TEXT,
  created_at TIMESTAMPTZ,
  created_by UUID,
  updated_at TIMESTAMPTZ,
  UNIQUE(category_id, slug)
);

-- Extend actions table
ALTER TABLE actions 
  ADD COLUMN workshop_subcategory_id UUID REFERENCES workshop_task_subcategories(id);

-- Keep workshop_category_id for compatibility
-- Add trigger to sync workshop_category_id from workshop_subcategory_id's parent
```

**RLS:** Same as existing workshop_task_categories (authenticated read, manager/admin write)

**Backfill:**
- Convert existing categories → subcategories under appropriate top-level
- Update `actions.workshop_subcategory_id` based on old `workshop_category_id`
- Sync `actions.workshop_category_id` to new top-level

**Impact:** Breaking if not careful with "Uncategorised" category (see Feature 3 section above)

---

## API Routes Changes Summary

### Feature 1: New Routes
- `GET /api/workshop-tasks/tasks/:taskId/comments` - List timeline (comments + status events)
- `POST /api/workshop-tasks/tasks/:taskId/comments` - Create comment
- `PATCH /api/workshop-tasks/comments/:commentId` - Edit comment
- `DELETE /api/workshop-tasks/comments/:commentId` - Delete comment

**Auth:** Workshop-tasks module permission required

**Impact:** None (additive)

---

### Feature 2: Permission Changes
**Affected routes:**
- `GET /api/admin/vehicles` - Change from admin-only to admin+manager
- `POST /api/admin/vehicles` - Change from admin-only to admin+manager
- `PUT /api/admin/vehicles/[id]` - Change from admin-only to admin+manager
- `DELETE /api/admin/vehicles/[id]` - Change from admin-only to admin+manager

**Verify scope:** Do category endpoints also need manager access?
- `GET/POST /api/admin/categories`
- `PUT/DELETE /api/admin/categories/[id]`

**Impact:** Functional change (managers gain vehicle CRUD)

---

### Feature 4: API Extensions
**Existing route to extend:**
- `GET /api/maintenance/history/[vehicleId]` - Must join `workshop_task_comments` and 2-tier taxonomy

**Impact:** None (extends existing response)

---

## Testing Checklist

### Pre-Feature 1
- [ ] Workshop tasks module works (create, update, complete tasks)
- [ ] Status workflow transitions work
- [ ] Category management works (manager/admin)

### Post-Feature 1
- [ ] Comments drawer opens/closes
- [ ] Add comment works
- [ ] Edit own comment works
- [ ] Delete own comment works
- [ ] Manager can moderate comments
- [ ] Timeline shows status events + comments in correct order
- [ ] Empty/loading/error states render

### Post-Feature 2
- [ ] `/maintenance` redirects to `/fleet?tab=maintenance`
- [ ] `/admin/vehicles` redirects to `/fleet?tab=vehicles`
- [ ] Manager can access Vehicles and Categories tabs
- [ ] Employee with maintenance permission cannot access Vehicles tab
- [ ] Vehicle CRUD works for managers
- [ ] Navigation links updated

### Post-Feature 3
- [ ] Inspection defect auto-creation still works
- [ ] Default subcategory assigned to new defects
- [ ] Workshop tasks display category + subcategory
- [ ] Category → subcategory filtering works in task creation
- [ ] Taxonomy CRUD works (manager/admin)
- [ ] Existing tasks migrated correctly
- [ ] UI badge styling applies from metadata

### Post-Feature 4
- [ ] "View history" link works from maintenance table
- [ ] "View history" link works from admin vehicles table
- [ ] History page tabs work (Maintenance, MOT, Documents, Notes)
- [ ] Workshop tasks show comments timeline
- [ ] Workshop tasks show category + subcategory
- [ ] MOT history tab works
- [ ] Back button returns to correct caller
- [ ] returnTo parameter validated (no open redirect)

---

## Risk Summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| Feature 2 permission change unintended | Medium | Clear documentation; verify test coverage for manager access |
| Feature 3 "Uncategorised" migration breaks inspections | High | Test inspection submission after Feature 3; update inspection code in same commit |
| Feature 4 implements before Feature 2 creates /fleet | High | Feature order enforced: F2 before F4 |
| Feature 4 missing F1/F3 integrations | Medium | Plan updated with explicit integration requirements |

---

## Conclusion

✅ **All features are aligned and safe to implement in order (1 → 2 → 3 → 4).**

**Key success criteria:**
1. Feature 3 migration handles "Uncategorised" category carefully
2. Feature 2 permission change tested for admin, manager, and employee
3. Feature 4 waits for Features 1-3 and integrates comments + 2-tier taxonomy

**Next step:** Proceed with Feature 1 implementation.
