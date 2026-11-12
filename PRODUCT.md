# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are A&V Squires staff working inside an authenticated operations app:

- Employees record timesheets, inspections, and read their issued daily allocation.
- Managers and admins plan labour and plant, publish allocations, and review history, job sheets, and plant reconciliation.
- Access is role- and module-permission based (employee, manager, admin / Level 5). Authorization must use server-side permission helpers, never user-editable auth metadata.

## Product Purpose

AVS Worklog is the internal digital operations system for A&V Squires Plant Co. Ltd. It exists so field and office staff can complete regulated daily work (timesheets, inspections, RAMS, absence, quotes, fleet, inventory, and daily allocation) with a durable audit trail.

Success for Daily Allocation means every scoped employee receives exactly one allocation or absence itinerary message per publication, historical publications remain immutable, and managers can plan Full, AM, and PM sessions without inventing a second job catalogue.

## Positioning

Daily Allocation is an AVS publishing and compliance workflow, not a generic scheduler. Jobs stay projections of the canonical AVS job catalogue. Publications are immutable, revision-serialized, and notification-backed. The adapted FFTS schedule board is an interaction reference only; AVS ownership, permissions, plant reconciliation, and issued history are the product mechanism.

## Operating Context

- Authenticated PWA at `/daily-allocation` (manager board), `/daily-allocation/my` (employee issued view), and `/daily-allocation/jobs/[code]` (job / plant sheets).
- Europe/London civil dates and wall-clock planning; work happens across DST boundaries.
- Managers publish a dated allocation; employees receive a low-priority itinerary notification and can reopen earlier revisions.
- Plant Daily Checks remain the actuals source for reconciliation against planned jobs.
- Current effective permission boundary: Daily Allocation management is admin-locked; employees can read their issued items.

## Capabilities and Constraints

Confirmed Daily Allocation facts (workstream `DA2-7F3C`):

- Deliver Daily and Weekly manager views with employee rows and AM/PM columns. A newly dropped job defaults to Full and its card spans both columns; managers resize either edge between Full and the relevant half day. Jobs and Plant stay sidebar resources. Availability warnings and keyboard-accessible alternatives are required. Touch support is required. There is no Jobs/Employees/Plant board-axis switch, minute timeline, arbitrary-duration resize, or arbitrary start/end editor.
- Preserve immutable publish/revision history, per-visit defaults plus per-employee instruction overrides, employee self-view, exactly one allocation or absence itinerary message per scoped employee per publication, plant reconciliation, job sheets, and current job-catalogue identity.
- Canonical jobs must not be duplicated into a Daily Allocation job table.
- Resources shows up to 80 jobs, prioritising the visible range then recent canonical activity. Debounced catalogue search includes codes and aliases, customer and title. Active, unambiguous jobs may be planned and published without a reliable site address for the first release. Missing addresses remain advisory warnings; employee itineraries show that no address was provided. Publication still revalidates the current canonical job and snapshots its available address.
- Visit storage stays `starts_at`/`ends_at` `TIMESTAMPTZ`, same London date, half-open `[start,end)`, `end > start`. New and moved draft visits use only Full `07:00–16:30`, AM `07:00–12:00`, or PM `12:00–16:30` Europe/London. Do not add a session enum column. Published custom intervals stay readable as exact times. Editable custom intervals are normalized only through an explicit preview.
- The default planning axis is employees. New visits use fixed London sessions: Full 07:00–16:30, AM 07:00–12:00, and PM 12:00–16:30. Jobs and plant are assigned onto those employee visits.
- Copy to the next calendar day is preview-first and insert-only. It keeps request-id idempotency and plan-version checks, adds required parent visits for selected jobs or plant, and skips conflicts or duplicates. It never updates or deletes the target day. Approved absence on the target day is a warning, not an overwrite.
- Plant Usage is a manager report for manual Sage entry. The latest published Daily Allocation revision is the planned source, and submitted plant checks supply validation. It does not calculate rates, post to Sage, or treat tracker last-known location as historical billing evidence.
- A registered or hired plant item may have only one distinct job per day; multiple visits are allowed only when they belong to that same job.
- Publishing may include unallocated available employees only with explicit confirmation; that unallocated state must be snapshotted.
- v1 untimed drafts and historical publications must not receive inferred end times. Conversion is per team/date; after conversion, v1 writes for that scope are rejected. Never dual-write v1 and v2.
- v1 publication rows and hashes remain untouched. Rollback after v2 data exists is disable-and-forward-fix, never a destructive downgrade.
- All create/move/assign/delete/publish operations must go through transactional RPCs with deterministic locks, expected plan/entity versions, authorization and availability revalidation, audited conflict overrides, idempotency, and atomic snapshots/messages. Drag and drop admits the board projection in the same turn and persists in the background.

Open (not invented here): visual world, palette, typography, and exact FFTS board chrome. Those belong to later UI work inside the existing AVS shell.

## Brand Commitments

- Product name: AVS Worklog.
- Company: A&V Squires Plant Co. Ltd.
- Keep AVS navigation, theme/accent, terminology (allocation, publication, job code, plant, issued), and permission patterns. Do not import FFTS quote/project/customer domain language onto this surface.

## Evidence on Hand

- Live app: https://avsworklog.mpdee.uk
- Incumbent manager/employee/job-sheet routes under `app/(dashboard)/daily-allocation/`
- v1 schema and publish RPCs: `supabase/migrations/20260813_daily_allocation_module.sql`
- FFTS interaction reference (read-only): `D:/Websites/ffts` `/scheduling`
- No testimonials, pricing, or marketing claims are on hand; do not fabricate them.

## Product Principles

1. Issued history is immutable; planning is versioned and convertible, never silently rewritten.
2. One scoped employee, one allocation or absence itinerary message per publication; never one notification per visit.
3. Plant truth stays reconcilable with a single actual job per asset/day.
4. Permissions follow current effective module access, not JWT user metadata.
5. Adapt proven schedule-board interactions without importing another product's data model.

## Quotes: negative invoice entry

Accounts/admin users can record a Sage credit note by entering a negative ad-hoc invoice amount and selecting the original invoice. This creates one entry in the existing financial-adjustment ledger, not a negative invoice row. The credit requires a reference, date and reason, cannot exceed the remaining invoice balance, and follows existing reconciliation confirmation and reversal behaviour. Sage remains the accounting source of truth.

## Policies and Procedures

The controlled document library serves current published policies and procedures to permitted readers. Document controllers (module Level 4) upload immutable draft versions, explicitly publish completed documents and archive/restore documents. A replacement draft leaves the previous published version available until publication. Historical versions are retained for controllers. Files remain private and all access follows effective module permissions and any configured PIN gate. Initial SharePoint imports remain drafts until reviewed and published; the source-of-truth cutover requires release acceptance.

## Error log triage

Application error logs on `/debug` stay visible until their outcome is closed. Untriaged active rows are red. Diagnosed rows that are not yet deployed and verified live stay active and are orange, with one next step. Only no-fix-required rows and deployed live-verified fixes are archived. A local commit is not a live fix. Bulk archive is not a product action.


## Daily Check reading corrections

Van, Plant and HGV Daily Check lists show the recorded miles, hours or kilometres to anyone with access to that check. Managers, admins and superadmins with access to the relevant module may correct the reading on any submitted check across teams. Supervisors and employees cannot make these corrections. Effective View As permissions apply.

Corrections change only the reading and retain the submitted check's answers, signature, submitter and status. Every correction records the previous and replacement readings, editor and time in the audit log; a reason/comment is optional. Stale edits are rejected. Linked asset readings are recalculated from the latest submitted check when the corrected reading was still current; a different current reading is preserved. Hired plant checks without a fleet link retain correction history without updating a fleet asset.

## Daily Check deletion

Workshop managers and existing full-access administrators with access to the relevant module may permanently delete Van, Plant and HGV Daily Checks in any status. Effective View As permissions apply; ordinary inspectors and managers outside Workshop gain no new deletion rights. Editing restrictions are unchanged.

Deletion atomically removes the check and its check-specific children, reverses recorded causal field changes, and keeps permanent accountability. It restores verified previous check, workshop or manual meter inputs, including known null before-images, while preserving later independent inputs and equal-valued confirmations. Legacy recovery verifies the original inspection/asset audit transaction and replays surviving meter history; review timestamps or matching values alone do not establish ownership. If evidence is genuinely missing, revised or ambiguous, deletion retains the current reading and records a permanent RECONCILIATION REQUIRED warning in the deletion audit and asset maintenance history, directing an audited manual correction. Shared tasks, completed Service work requiring a workshop correction, and photo evidence survive. Storage cleanup protects surviving public/signed/encoded/relative photo references, runs after commit, remains durable when blocked or failed, and can be retried by repeating the authorized DELETE; pending cleanup is not reported as completed.

## Plant service intervals

Plant services use the global hours interval in Workshop Service Settings unless a manager sets an individual interval override in the Plant maintenance record. A blank override follows the global interval. Interval changes recalculate the next due reading from the recorded last-service hours; global changes preserve individual overrides. Assets without recorded last-service hours retain their existing due reading. Service completion and correction use the effective interval and retain it in the service event history.

## Van service rotation

Vans alternate Basic Service A and Full Service, with the next service due 10,000 miles after the actual completed service mileage. The existing van checklist remains the Full Service checklist. Basic Service A retains core checks and engine oil/filter servicing, but fuel, air, pollen and gearbox filter items are checks/cleaning rather than routine replacement.

Historic generic Van Service records do not establish whether a Basic or Full service occurred. Existing ambiguous next-service selections require an explicit choice; existing due mileages and historic checklist responses remain unchanged. Maintenance Level 3 (Supervisor) and higher may change an existing asset's next service type, with its rotation step updated together. Service mileage and historical service corrections retain their manager/admin restriction.

New van and HGV workshop service tasks default to the asset's saved next service type. Workshop Level 3 (Supervisor) and higher may select another linked service checklist for that visit; lower levels must use the scheduled type. Task creation does not advance the asset's rotation. Service completion and corrections retain the shared audited service workflow, including the repeated Basic A positions in the HGV rotation. Plant rotations are unchanged.
