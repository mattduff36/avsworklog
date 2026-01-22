## Feature 5: Workshop Task Attachments (Service Reports / Checklists)

### PRD alignment

- Extends Workshop Tasks functionality from `docs/PRD_WORKSHOP_TASKS.md`
- Adds customizable attachment templates (form-based checklists/reports) that can be linked to any workshop task
- Designed for service documentation (e.g., Full Service checklist, Basic Service checklist) but applicable to any task type

---

### Problem statement

- A standard comments box is insufficient for detailed service tasks
- Workshop staff need structured checklists to document service work (oil changed, filters replaced, brakes inspected, etc.)
- Hard-coding service checklists into sub-categories is inflexible and doesn't future-proof the system
- The client needs to create/edit/delete attachment templates as business requirements evolve

---

### Functional requirements

#### FR-1: Attachment Template Management (Admin/Manager)

- Admins and managers can create, edit, and delete attachment templates
- Each template has a name and description
- Templates contain ordered questions with configurable response types:
  - **Checkbox** (yes/no, checked/unchecked)
  - **Text** (short text input)
  - **Long text** (multi-line text area)
  - **Number** (numeric input)
  - **Date** (date picker)
- Questions can be marked as required or optional
- Templates are managed from the Settings tab on `/workshop-tasks`

#### FR-2: Attachment Templates on Task Creation

- When creating a workshop task, users can optionally select one or more attachment templates
- Users can choose to:
  - Fill the attachment form immediately during task creation
  - Link the template and fill it later from the task details
- Multiple attachments can be added to a single task

#### FR-3: Attachment Responses on Task Detail View

- Task detail modal displays all attached templates with completion status
- Users can open and fill pending attachments
- Completed attachments show a summary of responses
- Attachments can be edited until the task is marked complete

#### FR-4: Attachment Data Storage

- All attachment data stored in database (no file uploads for MVP)
- Responses are preserved even if template questions are later modified
- Question snapshots stored with responses for historical accuracy

---

### Non-functional requirements

- **NFR-1**: Attachment management UI should match existing category management patterns
- **NFR-2**: No new external dependencies if possible; if needed, prefer MIT-licensed libraries
- **NFR-3**: RLS policies consistent with existing workshop task access patterns

---

### Data model

#### Tables

1. **`workshop_attachment_templates`**
   - `id` (UUID, PK)
   - `name` (text, required)
   - `description` (text, nullable)
   - `is_active` (boolean, default true)
   - `created_at`, `created_by`, `updated_at`

2. **`workshop_attachment_questions`**
   - `id` (UUID, PK)
   - `template_id` (FK → `workshop_attachment_templates`)
   - `question_text` (text, required)
   - `question_type` (enum: checkbox, text, long_text, number, date)
   - `is_required` (boolean, default false)
   - `sort_order` (integer)
   - `created_at`, `updated_at`

3. **`workshop_task_attachments`**
   - `id` (UUID, PK)
   - `task_id` (FK → `actions`)
   - `template_id` (FK → `workshop_attachment_templates`)
   - `status` (enum: pending, completed)
   - `completed_at` (timestamp, nullable)
   - `completed_by` (FK → `profiles`, nullable)
   - `created_at`, `created_by`

4. **`workshop_attachment_responses`**
   - `id` (UUID, PK)
   - `attachment_id` (FK → `workshop_task_attachments`)
   - `question_id` (FK → `workshop_attachment_questions`)
   - `question_snapshot` (JSONB - stores question text/type at time of response)
   - `response_value` (text - stores all response types as text)
   - `created_at`, `updated_at`

---

### Seed data (starter templates)

#### Template 1: Vehicle Van Full Service

Checklist items (all checkbox type):
- Vehicle details recorded
- Mileage recorded
- Service date recorded
- Engine oil drained
- Engine oil replaced
- Oil filter replaced
- Air filter inspected
- Air filter replaced
- Fuel filter replaced
- Cabin filter replaced
- Spark plugs inspected or replaced
- Glow plugs tested if diesel
- Cooling system inspected
- Coolant level checked
- Coolant condition checked
- Brake fluid level checked
- Brake fluid condition checked
- Power steering fluid checked
- Washer fluid topped up
- Auxiliary drive belt inspected
- Timing belt service status checked
- Battery health tested
- Battery terminals cleaned
- Brake pads inspected front
- Brake pads inspected rear
- Brake discs inspected
- Brake lines inspected
- Tyres inspected for wear
- Tyre pressures set
- Spare tyre inspected
- Steering components inspected
- Suspension components inspected
- Exhaust system inspected
- Lights checked exterior
- Lights checked interior
- Wipers inspected
- Wiper blades replaced
- Horn tested
- OBD fault codes scanned
- Service indicator reset
- Road test completed
- Service checklist signed off

#### Template 2: Vehicle Van Basic Service

Checklist items (all checkbox type):
- Vehicle details recorded
- Mileage recorded
- Service date recorded
- Engine oil replaced
- Oil filter replaced
- Fluid levels checked
- Coolant level checked
- Brake fluid level checked
- Washer fluid topped up
- Tyres inspected
- Tyre pressures set
- Brake pads visually inspected
- Lights checked exterior
- Wipers inspected
- Battery visual check
- OBD fault codes scanned
- Service indicator reset
- Road test completed
- Service checklist signed off

---

### UI touchpoints

- **Settings tab** (`/workshop-tasks`): Add attachment management panel
- **Create task dialog**: Add optional attachment selection
- **Task detail modal**: Display attachments and allow filling responses

---

### Future enhancements (out of scope for MVP)

- File upload attachments (PDFs, images)
- Template versioning
- Category-specific attachment validation (only certain templates for certain task types)
- Branching logic (show/hide questions based on other answers)
- Template duplication/cloning
