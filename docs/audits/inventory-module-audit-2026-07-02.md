# Inventory Module Audit

Date: 2026-07-02

Scope: `/inventory` code, API routes, migrations, tests, docs, and read-only live database checks against Supabase project `lrhufzqfzeutgvudcowy`.

## Executive Summary

The current inventory model is valid in its core shape: every active item belongs to exactly one `inventory_locations` row, movements are recorded, and active location/item foreign-key integrity is healthy in live data. The model is also already part-way through the "vans are locations" transition: most van locations exist as rows named `Van - REG` and are linked back to `vans.id`.

The linked asset feature should not be removed. It is no longer best understood as an optional user-facing feature, but it is still valuable as the canonical sync key between an inventory location and a fleet asset. The recommended direction is to keep the linked asset columns for asset-backed locations, hide or reduce manual editing of those links, and add explicit location typing before adding quote/job-number site locations.

Further development should not start until the gaps below are addressed or consciously accepted. The largest risks are incomplete van-location coverage, a legacy move endpoint that bypasses check enforcement, weak inventory coverage in `db:validate`, and the lack of a documented canonical location contract.

## Current Implementation

Inventory is implemented as a client-heavy App Router module in `app/(dashboard)/inventory/page.tsx`, with supporting components in `app/(dashboard)/inventory/components` and item detail at `app/(dashboard)/inventory/items/[itemId]/page.tsx`.

The main data relationships are:

- `inventory_items.location_id` is required and points to `inventory_locations.id`.
- `inventory_item_movements` records movement history between locations.
- `inventory_user_locations` stores each user's selected primary inventory location.
- `inventory_locations` can optionally link to exactly one fleet asset through `linked_van_id`, `linked_hgv_id`, or `linked_plant_id`.
- `inventory_minor_plant_details.source_plant_id` bridges fleet Plant records into inventory minor plant items.

Key API boundaries:

- `GET /api/inventory`, `GET /api/inventory/locations`, `GET /api/inventory/fleet-assets`, and `GET/PATCH /api/inventory/me/location` are available to inventory users.
- Item creation/edit/retire, location create/edit/delete, groups, categories, checks, PDFs, and minor-plant move/restore are manager/admin gated.
- `POST /api/inventory/move` is the canonical move route and enforces check-blocking rules before calling `inventory_move_items_with_batch`.
- `POST /api/inventory/[id]/move` is an older single-item route and does not enforce the same check-blocking rules.

## Live Data Snapshot

Read-only checks found:

- 458 active inventory items and 5 retired items.
- 53 active locations and 1 inactive legacy `NoLocation`.
- 50 locations linked to vans; 48 active vans have linked active locations.
- 10 active vans returned by the fleet-assets API do not have linked active inventory locations.
- 0 active items with null, missing, inactive, or orphaned locations.
- 0 duplicate active location names.
- 0 orphaned linked van/HGV/plant references.
- 121 active items are in `Unknown`.
- 218 active items are in `Yard`.
- 182 Yard items would be blocked from leaving until checked.
- 37 non-Yard, non-Unknown items are overdue.
- 110 quotes have site addresses, 123 distinct quote references exist, and there is 1 reserved quote project number.

The live data supports the current canonical location approach, but it also shows the transition is incomplete.

## Assessment

### What Is Valid

- The core item-to-location model is sound and enforced by schema and API validation.
- Vans are already being represented as inventory locations in real data.
- The linked van id is useful as a stable key because location names are display labels and can drift.
- The move RPC uses row locking and records movements atomically.
- Special locations `Yard` and `Unknown` have clear behavior in utility logic and live data.
- Manager and employee UI flows are separated, and the permission audit documents the intended split.

### What Is Not Yet Future-Ready

- `inventory_locations` has no explicit `location_type`, so the app infers meaning from names and optional linked asset columns.
- The linked-asset UI still presents the relationship as a manual optional field, not as canonical sync metadata.
- There is no automated "ensure every active van has a location" process.
- Fleet API and import scripts do not clearly share the same definition of which vans should become inventory locations.
- Site locations are not modeled yet, despite `site_items` already existing as a live category.
- Quote/project-number site sources are text/reference based today and need a stable link strategy before being used as inventory locations.
- There is no dedicated Inventory PRD or architecture note.

### Obsolete Feature Decision

The "linked location to asset" feature is not obsolete, but its current user-facing form is becoming obsolete.

Recommended interpretation:

- Keep `linked_van_id`, `linked_hgv_id`, and `linked_plant_id` as internal linkage fields.
- Treat a van-backed location as the canonical inventory location for that van.
- Do not create a separate "asset link" concept for users to manage casually.
- Move toward generated/synced van locations, with managers editing display metadata only where appropriate.

Removing the linked asset fields would make reconciliation, display, and future sync harder because the system would need to infer a fleet relationship from names like `Van - FE24 TYU`.

## Recommendations

### Must Do Before Further Development

1. Define the canonical location contract.
   Add a short developer doc or PRD section that states `inventory_locations` is the canonical table for inventory locations, and that asset-backed/site-backed locations are subtypes of it.

2. Add explicit location metadata.
   Plan a migration adding fields such as `location_type`, `source_type`, `source_id`, and possibly `external_reference`. This should support values like `yard`, `unknown`, `van`, `hgv`, `plant`, `site`, and `manual`.

3. Convert van linking into a sync/invariant.
   Add a read/write service or admin action that ensures every active van that should carry stock has one active inventory location linked by `linked_van_id`. Resolve the 10 active vans currently missing linked active locations.

4. Retire or redirect `POST /api/inventory/[id]/move`.
   Either remove it or make it call the same server-side logic as `/api/inventory/move`. It currently bypasses the check-blocking behavior that the main UI depends on.

5. Add inventory checks to `scripts/db-validate.ts`.
   Include critical inventory columns and FKs for `inventory_locations`, `inventory_items`, `inventory_item_movements`, `inventory_user_locations`, `inventory_item_categories`, and `inventory_minor_plant_details`.

### Should Do Before Site Locations

1. Model quote/project site locations explicitly.
   A site location should be generated from a quote or project number using stable keys, not just copied from `quotes.site_address`.

2. Decide site identity rules.
   Use `quotes.quote_reference` and `quote_project_numbers.project_reference` as the stable reference. Treat `site_address` as display/search metadata because addresses can be edited.

3. Add sync behavior for quote/project sites.
   Define when site locations are created, renamed, archived, and reactivated. Likely triggers are quote won/in-progress states and open/linked project numbers.

4. Clarify item category semantics.
   `site_items` is active in live data but is not in the static fallback category label map. The dynamic category table mostly covers this, but defaults and tests should be aligned.

5. Add location lifecycle rules.
   Define what happens to inventory at a van/site location when the van is retired, a project closes, or a quote is lost.

### Cleanups To Schedule

- Remove or archive one-off migration/import scripts after documenting their purpose.
- Replace `window.confirm` flows in inventory manager actions with project-standard dialogs.
- Split `app/(dashboard)/inventory/page.tsx` into smaller server/client boundaries or focused hooks before adding more workflows.
- Revisit the Beta/development banner once the location contract and tests are in place.
- Fix live location name quality, including the one active location with edge whitespace and the unlinked `TEST LOCATION`.

## Test Gaps

Existing tests cover utility rules, user location assignment, category counts, check submission, retirement, auth-guard smoke tests, and a basic Playwright smoke path.

Missing coverage that should be added before development:

- API tests for `/api/inventory/move` check-blocking, group moves, claims, and same-location moves.
- API tests for location create/update with linked van/HGV/plant fields and duplicate active links.
- Tests proving every active van can be synced to exactly one active inventory location.
- Tests for the legacy `/api/inventory/[id]/move` route if it remains.
- Tests for future site-location generation from quote/project-number references.
- Playwright coverage for manager location management, employee set-location, claim item, move item, and check-required retry flows.

## Proposed Future Implementation Sequence

1. Document the canonical location model and add test coverage around current behavior.
2. Add `db:validate` inventory expectations.
3. Normalize linked asset behavior into a service used by import, reconciliation, API routes, and future scheduled/admin sync.
4. Backfill and verify active van inventory locations.
5. Replace or remove the legacy item-specific move endpoint.
6. Add location typing/source metadata.
7. Implement quote/project-number site location sync.
8. Build site-location UI and item movement flows on top of the typed model.

## Final Position

The implementation is relevant and usable, but it should be tightened before adding site-location development. The optimal path is evolution, not replacement: keep `inventory_locations` as canonical, keep asset links as internal identity metadata, add explicit location/source typing, and enforce van/site location creation through sync logic rather than manual linked-asset editing.
