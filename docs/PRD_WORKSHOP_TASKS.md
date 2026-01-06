# PRD: Workshop Tasks Module

**Status:** In Development  
**Owner:** Development Team  
**Created:** 2026-01-06  
**Last Updated:** 2026-01-06

---

## Executive Summary

The Workshop Tasks module provides a dedicated interface for workshop staff to log and track vehicle repair work, including inspection defect resolution, proactive repairs, and fault fixes. This module consolidates vehicle workshop activities into a single source of truth, replacing the manager-centric Actions interface for defect tracking.

**Key Goals:**
- Centralize vehicle repair/defect tracking in one workshop-focused module
- Reuse existing Actions workflow (Pending → Logged → Completed) for proven reliability
- Enable workshop staff access with appropriate permission controls
- Support future expansion to plant machinery and tool repairs

---

## Background & Context

### Current State
- **Actions Module** (`app/(dashboard)/actions/page.tsx`): Manager-only interface showing inspection defects
- **Inspection Defects**: Auto-created in `actions` table when inspections have failed items
- **Workflow**: Pending → Logged (with manager note) → Completed
- **Access**: Restricted to managers/admins only via RLS

### Problem Statement
- Workshop staff need a dedicated interface to manage vehicle repair work
- Current Actions page is manager-focused and not suitable for workshop daily operations
- No way to log proactive repairs or work not tied to inspection defects
- No categorization system for types of workshop work

### Related Modules
- **Vehicle Inspections** ([PRD](PRD_VEHICLE_MAINTENANCE_SERVICE.md)): Source of defect actions
- **Maintenance & Service** ([PRD](PRD_VEHICLE_MAINTENANCE_SERVICE.md)): Tracks scheduled maintenance (separate from ad-hoc repairs)
- **Actions**: Will transition to general manager actions summary

---

## Goals & Success Criteria

### MVP Goals (Phase 1: Vehicle Tasks)
1. **Workshop staff can view and manage vehicle repair tasks**
   - Access via dashboard tile and top navigation
   - Permission-gated module (`workshop-tasks`)
   
2. **Support three task sources:**
   - Auto-created from inspection defects
   - Manual creation for proactive repairs
   - Manual creation for fault resolution

3. **Reuse existing workflow:**
   - Status: Pending → Logged (shown as "In Progress") → Completed
   - Maintain backward compatibility with existing Actions records

4. **Categorization system:**
   - Editable categories (manager/admin only)
   - Assign category during task creation
   - Future-proof for plant/tools categories

5. **Single source of truth:**
   - Inspection defects immediately become Workshop Tasks
   - No parallel systems or duplicate records

### Success Metrics
- Workshop staff adoption: 80%+ of workshop users access module weekly
- Defect resolution time tracked and visible
- Zero data migration issues (reusing existing table)
- Manager Actions page successfully transitions to exclude workshop defects

### Non-Goals (Deferred)
- ❌ Plant machinery tasks
- ❌ Tool repair tracking
- ❌ Task assignment to specific staff
- ❌ Time tracking / labor hours
- ❌ Parts inventory integration
- ❌ Cost tracking
- ❌ Photo attachments (could leverage existing inspection photos)
- ❌ PDF export of completed work

---

## User Personas & Use Cases

### Persona 1: Workshop Mechanic (Primary)
**Needs:**
- See all pending vehicle repairs in one place
- Log work done proactively (before it fails inspection)
- Update task status as work progresses
- Add detailed notes about work performed

**Use Cases:**
- UC-1: View all open vehicle tasks assigned to workshop
- UC-2: Create task for proactive repair (e.g., noticed worn brake pads)
- UC-3: Update inspection defect from "Pending" to "In Progress" when starting work
- UC-4: Mark task completed with notes when repair finished
- UC-5: Filter tasks by vehicle or status

### Persona 2: Workshop Manager/Admin
**Needs:**
- All workshop staff capabilities
- Manage task categories
- Oversight of workshop workload
- Transition from using Actions page for defects

**Use Cases:**
- UC-6: Create/edit/disable task categories
- UC-7: Review completed work history
- UC-8: Access both Workshop Tasks and manager Actions summary

---

## Functional Requirements

### FR-1: Module Access & Permissions
- **FR-1.1** New permission: `workshop-tasks` (ModuleName)
- **FR-1.2** Managers/admins auto-granted access
- **FR-1.3** Other roles require explicit permission grant
- **FR-1.4** Dashboard tile appears for users with permission
- **FR-1.5** Top navigation link (employee nav section)

### FR-2: Vehicle Tasks List
- **FR-2.1** Display all workshop-type actions (`action_type` IN `inspection_defect`, `workshop_vehicle_task`)
- **FR-2.2** Columns: Vehicle (reg), Category, Status, Source, Created Date, Actions
- **FR-2.3** Status filter: All / Pending / Logged / Completed
- **FR-2.4** Vehicle filter: All vehicles dropdown
- **FR-2.5** Sort by created date (newest first) by default
- **FR-2.6** Card-based layout (mobile-friendly, consistent with other modules)

### FR-3: Create Task Modal
- **FR-3.1** Fields:
  - Vehicle (required): Select from active vehicles by reg number
  - Category (required): Select from active categories
  - Workshop Comments (required): Textarea, minimum 10 chars
- **FR-3.2** On submit:
  - INSERT into `actions` with `action_type='workshop_vehicle_task'`
  - Default status: `pending`
  - Record `created_by` (current user)
- **FR-3.3** Validation errors shown inline
- **FR-3.4** Success toast on completion

### FR-4: Task Status Workflow (Reuse Existing)
- **FR-4.1** Statuses: `pending`, `logged`, `completed`
- **FR-4.2** Status transitions:
  - Pending → Logged: Button "Mark In Progress", opens dialog for workshop comment
  - Logged → Completed: Button "Mark Complete"
  - Completed → Logged: Button "Undo" (undo complete)
  - Logged → Pending: Button "Undo" (undo logged)
- **FR-4.3** UI labels:
  - `pending`: "Pending"
  - `logged`: "In Progress" (display label only; DB stores `logged`)
  - `completed`: "Completed"
- **FR-4.4** Timestamps: `created_at`, `logged_at`, `actioned_at` (completed)
- **FR-4.5** Audit: `created_by`, `logged_by`, `actioned_by`

### FR-5: Category Management (Manager/Admin)
- **FR-5.1** Access: Manager/admin only (UI + RLS enforced)
- **FR-5.2** CRUD operations:
  - Create category (name, applies_to='vehicle')
  - Edit category name
  - Toggle active/inactive
  - Delete category (if no tasks reference it)
- **FR-5.3** Ordering: `sort_order` field (manual numeric entry, drag-drop deferred)
- **FR-5.4** Default category: "Uncategorised" (system-generated, cannot delete)

### FR-6: Inspection Defect Integration
- **FR-6.1** When inspection submitted with failed items:
  - Auto-create actions with `action_type='inspection_defect'`
  - Set `vehicle_id` from inspection
  - Populate `title` and `description` from defect
  - Default `workshop_category_id` to "Uncategorised"
- **FR-6.2** Workshop Tasks shows these as "From Inspection" source
- **FR-6.3** Link back to source inspection visible in task details

---

## Data Model

### New Table: `workshop_task_categories`
```sql
CREATE TABLE workshop_task_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  applies_to TEXT NOT NULL DEFAULT 'vehicle' CHECK (applies_to IN ('vehicle', 'plant', 'tools')),
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Extended Table: `actions` (existing, add columns)
```sql
-- New columns to add to existing actions table
ALTER TABLE actions ADD COLUMN action_type TEXT NOT NULL DEFAULT 'manager_action' 
  CHECK (action_type IN ('inspection_defect', 'workshop_vehicle_task', 'manager_action'));

ALTER TABLE actions ADD COLUMN vehicle_id UUID REFERENCES vehicles(id);
-- Note: vehicle_id is nullable; for inspection_defect it's derived via inspection_id join

ALTER TABLE actions ADD COLUMN workshop_category_id UUID REFERENCES workshop_task_categories(id);

ALTER TABLE actions ADD COLUMN workshop_comments TEXT;
-- Separate from logged_comment (short manager note) vs workshop_comments (detailed work notes)
```

### Indexes
```sql
CREATE INDEX idx_actions_action_type_status ON actions(action_type, status, created_at DESC);
CREATE INDEX idx_actions_vehicle_id ON actions(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_actions_workshop_category ON actions(workshop_category_id);
```

---

## Security & Permissions

### RLS Policies

#### `workshop_task_categories`
- **SELECT**: Any authenticated user
- **INSERT/UPDATE/DELETE**: Managers/admins only (`roles.is_manager_admin = true`)

#### `actions` (extended policies)
Existing manager/admin policies remain unchanged. Add new policies for workshop access:

- **SELECT (workshop users)**:
  ```sql
  CREATE POLICY "Workshop users can view workshop tasks" ON actions
    FOR SELECT TO authenticated
    USING (
      action_type IN ('inspection_defect', 'workshop_vehicle_task')
      AND EXISTS (
        SELECT 1 FROM profiles p
        INNER JOIN roles r ON p.role_id = r.id
        INNER JOIN role_permissions rp ON r.id = rp.role_id
        WHERE p.id = auth.uid()
        AND rp.module_name = 'workshop-tasks'
        AND rp.enabled = true
      )
    );
  ```

- **UPDATE (workshop users)**:
  ```sql
  CREATE POLICY "Workshop users can update workshop tasks" ON actions
    FOR UPDATE TO authenticated
    USING (
      action_type IN ('inspection_defect', 'workshop_vehicle_task')
      AND EXISTS (
        SELECT 1 FROM profiles p
        INNER JOIN roles r ON p.role_id = r.id
        INNER JOIN role_permissions rp ON r.id = rp.role_id
        WHERE p.id = auth.uid()
        AND rp.module_name = 'workshop-tasks'
        AND rp.enabled = true
      )
    )
    WITH CHECK (
      action_type IN ('inspection_defect', 'workshop_vehicle_task')
    );
  ```

### Permission Backfill
Migration must insert `role_permissions` rows:
```sql
INSERT INTO role_permissions (role_id, module_name, enabled)
SELECT id, 'workshop-tasks', is_manager_admin
FROM roles
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions 
  WHERE role_id = roles.id AND module_name = 'workshop-tasks'
);
```

---

## UI/UX Specifications

### Navigation & Entry Points
1. **Dashboard Tile**:
   - Icon: Wrench or Tool icon (from lucide-react)
   - Color: `--workshop-primary` (new color token, e.g., orange/amber)
   - Title: "Workshop Tasks"
   - Description: "Vehicle repairs & workshop work"

2. **Top Nav** (employee section):
   - Label: "Workshop"
   - Icon: Wrench
   - Permission-filtered (only shown if user has `workshop-tasks` access)

### Workshop Tasks Page Layout
```
┌─────────────────────────────────────────────────────────┐
│ Workshop Tasks                          [+ New Task]    │
│ Track vehicle repairs and workshop work                 │
├─────────────────────────────────────────────────────────┤
│ Tabs: [Vehicle Tasks*] [Plant ⓘ] [Tools ⓘ] [Settings]│
├─────────────────────────────────────────────────────────┤
│ Filters: [Status: All ▾] [Vehicle: All ▾]             │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────┐│
│ │ 🚗 AB12 CDE        Category: Brakes    [Pending]   ││
│ │ From Inspection • Created 2 days ago               ││
│ │ Front brake pads worn to minimum                   ││
│ │                         [Mark In Progress] [View]  ││
│ └─────────────────────────────────────────────────────┘│
│ ┌─────────────────────────────────────────────────────┐│
│ │ 🚗 XY34 FGH        Category: Engine  [In Progress] ││
│ │ Manual Entry • Created 5 days ago                  ││
│ │ Oil leak from sump gasket                          ││
│ │                         [Mark Complete] [View]     ││
│ └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### Status Badge Colors
- Pending: Amber (`amber-500/20`)
- In Progress: Blue (`blue-500/20`)
- Completed: Green (`green-500/20`)

---

## Technical Architecture

### Component Structure
```
app/(dashboard)/workshop-tasks/
├── page.tsx                    # Main page with tabs and list
├── components/
│   ├── VehicleTasksList.tsx    # List of tasks (reuse Actions card pattern)
│   ├── AddTaskModal.tsx        # Create new task modal
│   ├── TaskCard.tsx            # Individual task card
│   ├── CategoryManager.tsx     # Manager/admin category CRUD
│   └── StatusBadge.tsx         # Status indicator
└── types.ts                    # Local types

lib/hooks/
├── useWorkshopTasks.ts         # Fetch tasks with filters

types/
└── database.ts                 # Update with new columns/tables
```

### API Routes (if needed)
Most operations use direct Supabase client queries. Potential API routes:
- `POST /api/workshop-tasks/categories` - Create category (if complex validation needed)
- Could defer; client-side Supabase queries may suffice

---

## Migration Strategy

### Phase 1: Foundation (Week 1)
- ✅ Create PRD (this document)
- ✅ DB migration: `workshop_task_categories` table + `actions` extensions
- ✅ RLS policies for workshop access
- ✅ Permission backfill script

### Phase 2: Core Module (Week 1-2)
- ✅ Add `workshop-tasks` ModuleName and permission plumbing
- ✅ Dashboard tile and nav link
- ✅ Workshop Tasks page (list + filters)
- ✅ Add Task modal (manual creation)
- ✅ Status update workflow (reuse Actions buttons/logic)

### Phase 3: Integration (Week 2)
- ✅ Update inspection submission to set `action_type='inspection_defect'`
- ✅ Backfill existing actions: `UPDATE actions SET action_type='inspection_defect' WHERE inspection_id IS NOT NULL`
- ✅ Category manager UI (manager/admin only)

### Phase 4: Transition Actions Page (Week 3)
- ✅ Update Actions page to filter `action_type='manager_action'` OR add prominent Workshop Tasks links
- ✅ Documentation update for managers

### Phase 5: Testing & Rollout (Week 3)
- ✅ Integration tests (RLS, permissions)
- ✅ UAT with workshop staff
- ✅ Production rollout
- ✅ Monitor adoption metrics

---

## Testing Requirements

### Unit Tests
- Category CRUD validation
- Task creation validation (required fields)
- Status transition logic

### Integration Tests
- RLS: Workshop users can read/write workshop tasks only
- RLS: Workshop users cannot access manager_action rows
- RLS: Non-managers cannot modify categories
- Permission checks on page load

### Manual Testing Checklist
- [ ] Workshop user can see dashboard tile
- [ ] Workshop user can create manual task
- [ ] Workshop user can update status (Pending → In Progress → Complete)
- [ ] Workshop user can see inspection defects
- [ ] Manager can manage categories
- [ ] Manager can access both Workshop Tasks and Actions
- [ ] Non-workshop user cannot access workshop tasks

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| RLS complexity breaks existing Actions | High | Low | Thorough testing; maintain manager full-access path |
| Workshop staff confused by "Logged" terminology | Medium | Medium | UI relabel to "In Progress" (DB keeps `logged`) |
| Existing defects lack categories | Low | High | Default to "Uncategorised" category; workshop can recategorize |
| Actions page transition confuses managers | Medium | Medium | Clear communication; phased rollout; keep fallback view |

---

## Open Questions & Decisions

### Decided
- ✅ Storage: Reuse `actions` table (not new `workshop_tasks` table)
- ✅ Workflow: Pending / Logged / Completed (existing statuses)
- ✅ Cutover: Immediate (inspection defects become Workshop Tasks in MVP)
- ✅ UI label: Display "In Progress" for `logged` status

### To Decide During Implementation
- [ ] Should workshop users be able to delete tasks they created?
- [ ] Should we show inspection link prominently on defect-sourced tasks?
- [ ] Category color coding (future enhancement)?
- [ ] Actions page: Filter out workshop rows, or add "Open in Workshop Tasks" buttons?

---

## Appendix

### Related Documentation
- [MIGRATIONS_GUIDE.md](guides/MIGRATIONS_GUIDE.md) - Migration execution pattern
- [HOW_TO_RUN_MIGRATIONS.md](guides/HOW_TO_RUN_MIGRATIONS.md) - Quick start
- [PRD_VEHICLE_MAINTENANCE_SERVICE.md](PRD_VEHICLE_MAINTENANCE_SERVICE.md) - Scheduled maintenance (separate from workshop tasks)

### Glossary
- **Workshop Task**: Any vehicle repair, defect resolution, or proactive maintenance work logged by workshop staff
- **Inspection Defect**: Failed item from vehicle inspection that auto-creates a workshop task
- **Action**: Generic term for manager/workshop task record in database (table name: `actions`)
- **Category**: User-defined classification of workshop work type (e.g., Brakes, Engine, Electrical)

---

**Document Version:** 1.0  
**Approval:** Pending stakeholder review

