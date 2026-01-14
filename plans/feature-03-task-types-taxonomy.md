## Feature 3: Workshop Task types taxonomy (categories + sub-categories)

### PRD alignment

- Extends existing Workshop Tasks PRD category work:
  - `docs/PRD_WORKSHOP_TASKS.md` → **FR-5: Category Management (Manager/Admin)** and **FR-6: Inspection Defect Integration**
- This plan implements Feature 3: task taxonomy = **top-level category** (Service/Repair/Modification/…) + **subcategory**, manager/admin editable, clearly visible in Maintenance History.

---

### Current-state audit

#### What exists today

- **Workshop tasks are stored in `actions`**, not a separate `workshop_tasks` table.
- **Categories already exist**:
  - Table: `workshop_task_categories` (created by `supabase/migrations/20260106_workshop_tasks.sql`).
  - `actions.workshop_category_id` is a nullable FK → `workshop_task_categories(id)`.
  - Current seeded categories include: `Uncategorised`, `Brakes`, `Engine`, `Electrical`, `Suspension & Steering`, `Bodywork`.
- **Access control already exists**:
  - `workshop_task_categories`: authenticated users can read; **manager/admin** can CRUD (via `roles.is_manager_admin`).

#### Where categories are used today

- **Workshop Tasks module**: `app/(dashboard)/workshop-tasks/page.tsx`
  - Loads tasks from `actions` with `workshop_task_categories(name)` join.
  - Loads categories from `workshop_task_categories`.
  - Create/Edit task chooses **one** category (`workshop_category_id`).
  - Has an embedded Settings UI for category CRUD.
- **Inspection workflows (auto-create defects)**:
  - `app/(dashboard)/inspections/new/page.tsx`
  - `app/(dashboard)/inspections/[id]/page.tsx`
  - Both lookup the `Uncategorised` category and set `actions.workshop_category_id` for `inspection_defect` tasks.
- **Maintenance History (API + UI)**:
  - API: `app/api/maintenance/history/[vehicleId]/route.ts` selects `workshop_task_categories(name)`.
  - UI: `app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx`
    - Shows category badge only for `workshop_vehicle_task` (not currently for `inspection_defect`).
    - Workshop card styling is currently **hard-coded** to one workshop color scheme.

---

### Current tables/models for categories

#### `workshop_task_categories`

- Source: `supabase/migrations/20260106_workshop_tasks.sql`
- Type defs: `types/database.ts` (`Tables.workshop_task_categories`)
- Fields today: `id`, `applies_to`, `name`, `is_active`, `sort_order`, `created_at`, `created_by`, `updated_at`

---

### How tasks reference categories today

- `actions.workshop_category_id` → `workshop_task_categories.id`

---

### File paths (touchpoints)

#### DB + types

- `supabase/migrations/20260106_workshop_tasks.sql`
- `types/database.ts`
- `types/maintenance.ts`
- `tests/integration/workshop-tasks-rls.test.ts`

#### UI / API

- Workshop tasks UI: `app/(dashboard)/workshop-tasks/page.tsx`
- Maintenance History API: `app/api/maintenance/history/[vehicleId]/route.ts`
- Maintenance History UI: `app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx`
- Inspection create/update:
  - `app/(dashboard)/inspections/new/page.tsx`
  - `app/(dashboard)/inspections/[id]/page.tsx`
- Navigation (if we add a dedicated taxonomy route): `lib/config/navigation.ts`

---

### Data model plan

#### Goal

- Repurpose the existing `workshop_task_categories` rows into **top-level categories** (Service/Repair/Modification/…).
- Add **subcategories** under each category.
- Update workshop tasks to reference **subcategory**, and derive category through the relation (optionally storing both for performance/back-compat).

#### Tables

1) **`workshop_task_categories` (repurposed as top-level categories)**
- Add:
  - `slug`
  - `sort_order`, `is_active` (already exists)
  - Optional UI metadata:
    - `ui_color`, `ui_icon`, `ui_badge_style`
- Constraints:
  - Unique `slug` per `applies_to` (case-insensitive recommended)

2) **`workshop_task_subcategories` (new)**
- Fields:
  - `id`
  - `category_id` FK → `workshop_task_categories(id)`
  - `name`, `slug`, `sort_order`, `is_active`
  - Optional UI metadata: `ui_color`, `ui_icon`, `ui_badge_style`
  - `created_at`, `created_by`, `updated_at`
- Constraints:
  - Unique (`category_id`, `slug`) (case-insensitive recommended)

3) **`actions` (workshop tasks)**
- Add:
  - `workshop_subcategory_id` FK → `workshop_task_subcategories(id)`
- Keep:
  - `workshop_category_id` for compatibility (existing code + queries)
- Recommended integrity rule:
  - When `workshop_subcategory_id` is set, ensure `workshop_category_id` matches the parent category of that subcategory (enforced via DB trigger or constraint+trigger).

---

### Admin UI plan (manager/admin CRUD)

Decision confirmed: **Manager + Admin** can CRUD categories/subcategories.

#### Pages/routes

- Add a dedicated taxonomy management page:
  - `app/(dashboard)/workshop-tasks/taxonomy/page.tsx`
- Link from Workshop Tasks settings:
  - `app/(dashboard)/workshop-tasks/page.tsx` → “Manage task types”
- Optional nav shortcut:
  - Add a manager/admin item in `lib/config/navigation.ts` pointing to `/workshop-tasks/taxonomy`.

#### CRUD flows

- **Categories**:
  - List categories with usage counts and styling preview
  - Create/edit: name, slug (auto-suggest), sort_order, active, optional UI metadata
  - Deactivate (preferred): `is_active=false`
  - Delete: only if no subcategories and not referenced by any tasks
- **Subcategories**:
  - List filtered by selected category
  - Create/edit: parent category, name, slug, sort_order, active, optional UI metadata
  - Deactivate (preferred)
  - Delete: blocked if referenced by any task

#### Confirmation prompts + validation

- Confirm deactivate: “Hides from new tasks; existing tasks remain.”
- Confirm delete: “Cannot be undone.”
- Validate:
  - Required name
  - Unique slug constraints
  - UI metadata formats (if used)

#### Deletion rules

- Recommended: **soft-delete** via `is_active=false`.
- Hard delete only when not in use.

---

### Task creation/edit UI plan

Update `app/(dashboard)/workshop-tasks/page.tsx`:

- Replace the single category select with:
  - **Category dropdown** (top-level)
  - **Subcategory dropdown** filtered by category
- Behavior:
  - Changing category clears subcategory
  - Subcategory required for new tasks once rollout is complete

#### Defaults and “Other”

- Seed an **Other** subcategory (slug `other`) under each top-level category.

---

### Migration/backfill strategy (and rollback)

#### Constraints / approach

- Follow:
  - `docs/guides/HOW_TO_RUN_MIGRATIONS.md`
  - `docs/guides/MIGRATIONS_GUIDE.md`
- Use the existing direct-Postgres runner pattern (like `scripts/run-workshop-tasks-migration.ts`).

#### Forward migration (high-level)

- Create `workshop_task_subcategories`.
- Add `slug` + optional UI metadata fields to `workshop_task_categories`.
- Add `actions.workshop_subcategory_id`.
- Seed new top-level categories (vehicle): **Service**, **Repair**, **Modification**, **Other**.
- Convert existing categories into subcategories (confirmed approach):
  - Existing `Uncategorised` → category **Other** + subcategory `Uncategorised` (or rename to `Other`)
  - Existing `Brakes/Engine/Electrical/...` → category **Repair** + subcategory with same name
- Backfill existing tasks:
  - Set `actions.workshop_subcategory_id` based on the old category mapping.
  - Update `actions.workshop_category_id` to the new top-level category (Repair/Other) to match.
- Add a DB rule (trigger recommended) to keep `workshop_category_id` synced from `workshop_subcategory_id` going forward.

#### Rollback strategy

- During forward migration, persist a small mapping/backup table so rollback is safe:
  - Old category rows
  - `actions.id` → previous `workshop_category_id`
  - Old→new mapping IDs
- Rollback steps:
  - Drop sync trigger/constraints
  - Restore `actions.workshop_category_id` from backup mapping
  - Set `actions.workshop_subcategory_id = NULL`
  - Remove seeded top-level categories/subcategories
  - Drop `workshop_task_subcategories`
  - Optionally drop the added metadata/slug columns

---

### Maintenance History display plan

Update:
- API: `app/api/maintenance/history/[vehicleId]/route.ts`
  - Include both **category** and **subcategory** names (and UI metadata if used).
- UI: `app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx`
  - Show category badge for **all** workshop tasks (including `inspection_defect`).
  - Show subcategory badge when present.

#### Card styling rules

- Use category UI metadata (color/icon/badge style) to theme the workshop card and/or badges.
- Fallback: if metadata missing, keep current workshop styling.

---

### Tests and acceptance checklist

#### Tests

- Extend `tests/integration/workshop-tasks-rls.test.ts` to cover:
  - Authenticated SELECT for subcategories
  - Manager/admin CRUD for subcategories
  - Block delete when subcategory is referenced
  - Writes with `workshop_subcategory_id` remain readable for workshop users

#### Acceptance checklist

- Taxonomy CRUD:
  - Manager/admin can create/edit/deactivate categories and subcategories
  - Deletion is blocked (or disabled) when in use
- Workshop Tasks create/edit:
  - Category dropdown filters subcategory dropdown
  - “Other” is always selectable
- Inspection defect defaults:
  - New defects default to **Repair → Inspection defects** (seeded)
- Maintenance History:
  - Category is clearly visible
  - Styling follows category metadata with safe fallbacks
- Backfill correctness:
  - Existing tasks show their previous category as a subcategory under Repair/Other

