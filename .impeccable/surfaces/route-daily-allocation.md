---
version: 1
slug: "route-daily-allocation"
primary_target: "route:/daily-allocation"
related_targets: ["route:/daily-allocation/my","route:/daily-allocation/jobs"]
---

# Daily Allocation surface brief

Visitor mode: Operate.

## Job and audience

Managers and admins arrive to plan a team date: place timed visits against catalogue jobs, assign employees and plant, then publish an immutable allocation. Employees arrive from a notification to read their issued itinerary and earlier revisions. Nobody is browsing; they are completing a regulated daily task.

## Outcome and proof

Primary action is publish. Success is an atomic revision whose snapshot matches the board, with exactly one itinerary notification per in-scope employee. Proof is real job codes, site addresses, named staff, plant identity, absence state, and revision history — not demo scheduler data.

Product-specific truth: this is AVS Daily Allocation (catalogue jobs, publications, plant reconciliation, job sheets). FFTS `/scheduling` is the interaction baseline, not the domain.

## Selected direction

Visual world is not invented in this brief. Later UI work must retain the AVS shell, accent, terminology, and permission gating. Interaction thesis (confirmed, not visual): Daily and Weekly projections of the same visits; Jobs/Employees/Plant sidebar; drag-and-drop timed visits with move/resize; availability/conflict warnings; keyboard and explicit tap/dialog alternatives.

Memorable moment: a dated board where a visit has a start and end, not an employee card with a single start time.

## Scope and boundaries

- Fidelity: production replacement of the manager board; keep employee self-view and job sheets version-aware.
- Untouched: v1 publication bytes/hashes, job catalogue identity, current effective permission boundaries, plant inspection actuals model.
- Anti-goals: dual-write; inferred historical end times; one notification per visit; multiple distinct plant jobs on one day; client-only conflict enforcement; copying the FFTS board monolith or quote lifecycle.

## States and ranges

Typical: one team, one London date, tens of employees, a handful of plant items, several timed visits. Weekly view projects up to seven dates. Empty: no visits yet, untimed v1 drafts shown as legacy allocations requiring conversion. Error/stale: version conflict forces authoritative refresh. Publish with unallocated available employees requires an explicit confirmation step.

## Interaction and layout

Hierarchy: date/range and publish controls first; resource sidebar; timeline/grid of visits. Daily and Weekly must show the same entities. Feedback: conflict warnings, audited override confirmation, publish confirmation, loading/empty/error. 30-minute snap and minimum duration at the application layer; default viewport 05:00–20:00 is configuration.

## Constraints and open decisions

- Intervals: TIMESTAMPTZ, Europe/London, same civil date, `[start,end)`.
- Accessibility: keyboard create/assign/move/resize; do not rely on drag alone.
- Open: exact visual composition, DnD chrome, and compact mobile card styling — to be designed later without changing this product contract.
