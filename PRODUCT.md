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

Success for Daily Allocation means every scoped employee receives exactly one allocation or absence itinerary message per publication, historical publications remain immutable, and managers can plan timed visits without inventing a second job catalogue.

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

- Deliver Daily and Weekly manager views with Jobs / Employees / Plant resources, timed visits, move/resize, availability warnings, and keyboard-accessible alternatives. Touch support is required.
- Preserve immutable publish/revision history, per-visit defaults plus per-employee instruction overrides, employee self-view, exactly one allocation or absence itinerary message per scoped employee per publication, plant reconciliation, job sheets, and current job-catalogue identity.
- Canonical jobs must not be duplicated into a Daily Allocation job table.
- Timed intervals are `TIMESTAMPTZ`, same London date, half-open `[start,end)`, `end > start`. 30-minute minimum and snap are application rules on top of those schema bounds. Default viewport 05:00–20:00 is configuration, not a schema constant.
- A registered or hired plant item may have only one distinct job per day; multiple visits are allowed only when they belong to that same job.
- Publishing may include unallocated available employees only with explicit confirmation; that unallocated state must be snapshotted.
- v1 untimed drafts and historical publications must not receive inferred end times. Conversion is per team/date; after conversion, v1 writes for that scope are rejected. Never dual-write v1 and v2.
- v1 publication rows and hashes remain untouched. Rollback after v2 data exists is disable-and-forward-fix, never a destructive downgrade.
- All create/move/resize/assign/delete/publish operations must go through transactional RPCs with deterministic locks, expected plan/entity versions, authorization and availability revalidation, audited conflict overrides, idempotency, and atomic snapshots/messages.

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
