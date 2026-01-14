## Feature 4: Review Maintenance History + MOT History UI (Modal vs Page)

### PRD linkage + Feature dependencies

- **Base PRD**: `docs/PRD_VEHICLE_MAINTENANCE_SERVICE.md`
  - Pressure points relevant to this feature: **audit trail**, **mandatory comments**, **desktop-first**, and scaling beyond the original "single modal" assumption.
- **Feature 1 dependency**: `plans/feature-01-task-comments.md`
  - Feature 1 adds `workshop_task_comments` table for multi-note timeline on workshop tasks
  - **Integration required**: Feature 4's history page must display the full comments timeline (not just single `logged_comment`/`actioned_comment` fields)
  - The WorkshopTaskTimeline component must query and render comments from the new table
- **Feature 2 dependency**: `plans/feature-02-vehicles-pages.md`
  - Feature 2's direction is to unify `/maintenance` and `/admin/vehicles` into a single canonical **Fleet** surface (proposed `/fleet`) with redirects, reducing duplicated vehicle UI.
- **Feature 3 dependency**: `plans/feature-03-task-types-taxonomy.md`
  - Feature 3 adds two-tier taxonomy: top-level category (Service/Repair/Modification) + subcategories (Brakes/Engine/etc)
  - **Integration required**: Feature 4's history page must display BOTH category and subcategory badges with correct styling from UI metadata
  - The WorkshopTaskTimeline component must render category + subcategory (not just one category field)
- **Feature 4 goal**: provide a **single, consistent "vehicle history" experience** reachable from both Feature 2 entry points:
  - `/maintenance` (maintenance operations)
  - `/admin/vehicles` (admin vehicle master data)
  - ...and future-proofed for the Feature 2 canonical Fleet surface (`/fleet`).

---

## UX audit

### Current UI surfaces

- **Maintenance history UI**: `Dialog` in `app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx`
- **MOT history UI**: `Dialog` in `app/(dashboard)/maintenance/components/MotHistoryDialog.tsx`
- **Entry from `/maintenance`**: vehicle row click opens Maintenance History via `app/(dashboard)/maintenance/components/MaintenanceTable.tsx`
- **Entry from `/admin/vehicles`**:
  - No "View history" entry today.
  - There is still a link to `/admin/maintenance-demo` in `app/(dashboard)/admin/vehicles/page.tsx`, but docs indicate that demo page was removed. This is a discoverability and correctness issue for Feature 2 alignment.

### Data shown: Maintenance History dialog (what's on screen)

- **Header / actions**
  - Title: "Maintenance History - {vehicleReg}"
  - Buttons:
    - **MOT** (opens MOT History dialog)
    - **Edit** (closes history and opens edit dialog)
- **Auto-sync behavior**
  - On open, the dialog may trigger a DVLA/MOT sync based on "staleness"
  - On success, it calls `window.location.reload()` (full page reload while a dialog is open)
- **Vehicle Data section** (VES + MOT fields, if available)
  - Make (VES preferred; fallback MOT)
  - Model (MOT)
  - Colour (VES preferred; fallback MOT)
  - Year (VES preferred; fallback MOT)
  - Fuel (VES preferred; fallback MOT)
  - First registration date (MOT)
  - Engine capacity (VES)
  - Tax status (VES)
  - Tax due date
  - MOT status (VES)
  - MOT due date
  - CO2 emissions (VES)
  - Euro status (VES)
  - Wheelplan (VES)
- **Combined activity feed** (sorted newest-first)
  - **Maintenance audit entries** (`maintenance_history`)
    - Updated by (name)
    - Field updated (mapped label)
    - Old → new values (formatted as date/mileage/boolean)
    - Mandatory comment
    - Relative time label
  - **Workshop task history items** (workshop tasks/actions) **[Feature 1 + 3 update: must show comments timeline + two-tier categories]**
    - User (name)
    - Task type (inspection defect fix vs workshop task)
    - Category badge (when present) **[Feature 3: must show category + subcategory]**
    - Status badge (Pending / In Progress / Completed)
    - Started/completed timestamps (relative)
    - Task details (workshop comments / description)
    - Progress note (`logged_comment`) **[Feature 1: replaced by comments timeline]**
    - Completed note (`actioned_comment`) **[Feature 1: replaced by comments timeline]**
    - **[Feature 1: NEW]** Full comments timeline from `workshop_task_comments` table
- **Progressive disclosure**
  - "Recent Updates" (top 3)
  - Expand "Show more" and paginate by +10 in-place

### Data shown: MOT History dialog (what's on screen)

- **Header**
  - Title: "MOT History - {vehicleReg}"
- **Loading/error states**
  - "Vehicle not found" (special-case messaging for test/invalid registrations)
  - "No MOT history yet" (vehicle too new)
  - Generic error with "Try again"
- **Current MOT status card**
  - Expiry date
  - Status (Valid/Expired/etc)
  - Days remaining
  - Last test date
  - Special "No MOT History" card variant:
    - First MOT due date (from existing due date; else GOV.UK data; else computed +3y from first used)
- **Test history list**
  - For each test:
    - Result + completed date
    - Expiry date (if present)
    - Mileage + unit
    - Test station name + postcode (if present)
    - MOT test number
    - Defect summary badges by type (Dangerous/Major/Minor/Advisory)
    - Expand/collapse defects list (type + lateral + free text)

### Interaction problems (scroll, density, discoverability)

- **Modal stacking**
  - Maintenance History opens MOT History as a second dialog (dialog-on-dialog).
  - Typical impacts: confusing "Back/Close" mental model, unclear focus/escape behavior, increased risk of losing reading position.
- **Scroll + density**
  - Both dialogs are effectively long, scroll-heavy "mini apps" (lots of cards, grids, badges, multi-line notes).
  - No structural navigation inside the dialogs (no anchors, no search/filter, no "jump to section").
- **Hidden complexity**
  - Older history requires multiple "Show more" actions.
  - MOT defects are buried behind per-test expanders (fine in isolation, but heavy combined with long scroll containers).
- **Disruptive side effects**
  - Auto-sync on open combined with `window.location.reload()` breaks expectations for a read-only "history viewer".

### Mobile issues

- Dialogs are effectively full-screen on mobile; combined with long history, this becomes "app-within-app".
- Nested dialog behavior is significantly worse on mobile (harder to keep context, more accidental closes).
- Progressive disclosure competes with small viewport: users lose their place and have limited cues about what else exists.

### Entry points (from both pages; Feature 2 consistency)

- **From `/maintenance`**
  - Current: row click opens Maintenance History dialog; within that, "MOT" opens second dialog.
  - Desired: "View history" should route to the same history surface used by admins.
- **From `/admin/vehicles`**
  - Current: no vehicle history entry; stale link to removed demo page.
  - Desired: "View history" should route to the same history surface used by maintenance staff.

---

## Options

### Option A: Keep modal, refactor layout

- **Description**
  - Keep using `Dialog`, but consolidate into one surface with internal tabs: Maintenance | MOT | Notes/Vehicle data.
  - Remove nested dialog (MOT becomes a tab).
  - Replace auto-sync + reload with an explicit refresh control and query invalidation.
- **Pros**
  - Smallest routing change.
  - Keeps users "in list context" (quick glance behavior).
- **Cons**
  - Still treats "history" as a modal mini-app (scroll-heavy, weak deep linking).
  - Hard to align `/maintenance` and `/admin/vehicles` experience without adding URL state anyway.

### Option B: Convert to drawer/side panel

- **Description**
  - Replace dialog with `Sheet` / side panel for desktop split view (list + history).
  - Use internal tabs for Maintenance/MOT (no nesting).
  - On mobile, drawer becomes full-screen but with clearer back/close behavior than nested dialogs.
- **Pros**
  - Better desktop ergonomics than modal.
  - Preserves "return to list" without route change.
- **Cons**
  - Still not a true deep-link unless you add URL state.
  - Harder to share/bookmark a specific vehicle history view.

### Option C: Dedicated vehicle history page with tabs (Maintenance, MOT, Documents, Notes)

- **Description**
  - Introduce a dedicated route that both Feature 2 pages navigate to.
  - Tabs provide the information architecture instead of stacking dialogs.
- **Pros**
  - Best scalability as history complexity grows.
  - Natural deep-linking, back/forward, shareability, and better mobile navigation.
  - Simplifies "consistency" between `/maintenance` and `/admin/vehicles` (same destination).
- **Cons**
  - Requires routing decisions and shared component extraction.
  - Requires careful permission design across roles (maintenance-module users vs admin users).

---

## Recommendation

**Choose Option C (dedicated history page with tabs).**

### Why this is the best fit (tied to Feature 2)

- The current UI is already behaving like a mini-application (nested dialogs, long scroll, progressive disclosure, background sync side effects). That indicates the **modal container is no longer the right pattern**.
- Feature 2's objective is to reduce duplication and produce a consistent fleet experience. A single history page becomes a reusable destination from:
  - `/maintenance` today
  - `/admin/vehicles` today
  - `/fleet` (Feature 2 canonical) later
- This is the cleanest way to keep "vehicle history" consistent while Feature 2 evolves navigation.

---

## Routing / URLs (page-based)

### Canonical route (Feature 2 forward-compatible)

- **Primary (future-proof)**: `/fleet/vehicles/[vehicleId]/history`
  - Aligns with Feature 2's "single Fleet surface" direction.

### Transitional compatibility (Feature 2 not yet merged)

- If `/fleet` is not yet implemented, still build the history page under one canonical location and link to it from both pages.
- Two acceptable strategies:
  - **Preferred**: build `/fleet/vehicles/[vehicleId]/history` now (even before the rest of Feature 2 ships) and treat it as a shared destination.
  - **Alternative**: build `/maintenance/vehicles/[vehicleId]/history` now and add a redirect later when `/fleet` becomes canonical.

### Tab routing (query params)

- `?tab=maintenance|mot|documents|notes` (default `maintenance`)
- Use `nuqs` for tab state to match project conventions.

### "Back to where I came from" (Feature 2 consistency)

- Add optional `returnTo` query param to preserve caller context:
  - `returnTo=/maintenance`
  - `returnTo=/admin/vehicles`
  - (future) `returnTo=/fleet?tab=maintenance` or `returnTo=/fleet?tab=vehicles`
- Validate `returnTo` against an allowlist to avoid open redirects.

### Navigation flow (mermaid)

```mermaid
flowchart TD
maintenanceList[/maintenance/] -->|ViewHistory(vehicleId)| historyPage[/fleet/vehicles/:vehicleId/history?tab=maintenance&returnTo=/maintenance/]
adminVehicles[/admin/vehicles/] -->|ViewHistory(vehicleId)| historyPage
fleetPage[/fleet/] -->|ViewHistory(vehicleId)| historyPage
historyPage -->|Back(returnTo)| maintenanceList
historyPage -->|Back(returnTo)| adminVehicles
historyPage -->|Back(returnTo)| fleetPage
```

---

## Implementation steps (no code)

### Phase 0: Fix entry points to remove dead UX and align with Feature 2

- Update `/admin/vehicles` UI to remove any link to `/admin/maintenance-demo` and replace with correct navigation.
- Add an explicit **"View history"** action per vehicle row on `/admin/vehicles` (button or row action menu).
- Confirm `/maintenance` uses an explicit **"View history"** action (avoid "row click does multiple things" ambiguity if row click is also used for selection/edit elsewhere).

### Phase 1: Create the dedicated history page surface (tabs, header, back)

- Create the route (canonical per decision above):
  - `app/(dashboard)/fleet/vehicles/[vehicleId]/history/page.tsx`
- Page layout expectations:
  - Header: reg number + key status chips (Tax/MOT due + status) and a Back button
  - Tabs: Maintenance | MOT | Documents | Notes

### Phase 2: Component extraction (reduce duplication and keep modal usable during transition)

- Extract presentational sections from the existing dialogs so both the page and the old modals can reuse them:
  - Vehicle summary section (VES/MOT fields)
  - Maintenance audit timeline (maintenance_history)
  - Workshop task timeline items (actions/workshop tasks) **[Feature 1 + 3: must integrate comments + two-tier taxonomy]**
  - MOT history panel (status + tests)
- Keep dialogs temporarily, re-implemented as wrappers around the extracted components, to avoid regressions while changing navigation.

### Phase 3: State management plan

- **Tabs**: URL query state via `nuqs` (`tab`)
- **Expandable UI**
  - MOT expanded test id: local state (not URL)
  - Maintenance history pagination: prefer cursor/limit (not "render everything")
- **Return navigation**
  - `returnTo` param validated by allowlist (`/maintenance`, `/admin/vehicles`, `/fleet?...`)

### Phase 4: Data loading strategy + performance notes

- **Maintenance/Workshop combined timeline**
  - Reuse existing data source: `GET /api/maintenance/history/[vehicleId]` and existing `useMaintenanceHistory(vehicleId)` hook
  - **[Feature 1 integration]**: API must join `workshop_task_comments` and return full comment threads for workshop tasks
  - **[Feature 3 integration]**: API must join both `workshop_task_categories` (top-level) and `workshop_task_subcategories` and return both with UI metadata
  - If history size grows:
    - extend API to support pagination (`cursor`, `limit`)
    - use infinite loading on the history page to avoid rendering huge lists
- **MOT history**
  - Wrap `GET /api/maintenance/mot-history/[vehicleId]` in a React Query hook for caching/retries and consistent loading UX
- **Sync behavior**
  - Replace "auto-sync on open + full reload" with:
    - explicit "Refresh DVLA/MOT data" control
    - background refresh via query invalidation (no `window.location.reload()`)
- **Rendering**
  - Maintain a "Recent" summary for maintenance timeline
  - Avoid rendering hundreds of cards in one paint; paginate

### Phase 5: Deprecate modal flows (or keep as quick preview)

- After the page is stable and entry points are updated:
  - Remove nested dialog behavior (MOT must not be a second dialog)
  - Either remove the dialogs, or convert them into a lightweight preview that links to "Open full history"

---

## Component breakdown (proposed)

- **New route**
  - `app/(dashboard)/fleet/vehicles/[vehicleId]/history/page.tsx`
- **Shared UI components (suggested folder)**
  - `app/(dashboard)/fleet/components/vehicle-history/VehicleHistoryHeader.tsx`
  - `app/(dashboard)/fleet/components/vehicle-history/VehicleHistoryTabs.tsx`
  - `app/(dashboard)/fleet/components/vehicle-history/VehicleDataSummary.tsx`
  - `app/(dashboard)/fleet/components/vehicle-history/MaintenanceAuditTimeline.tsx`
  - `app/(dashboard)/fleet/components/vehicle-history/WorkshopTaskTimeline.tsx` **[Feature 1 + 3: renders comments + two-tier taxonomy]**
  - `app/(dashboard)/fleet/components/vehicle-history/MotHistoryPanel.tsx`
  - `app/(dashboard)/fleet/components/vehicle-history/DocumentsPanel.tsx` (v1: empty state)
  - `app/(dashboard)/fleet/components/vehicle-history/NotesPanel.tsx` (v1: show current notes + link to maintenance audit where `field_name='notes'`)
- **Hooks**
  - Extend `lib/hooks/useMaintenance.ts` or add a dedicated hook file to include an MOT history query hook (React Query) for parity with maintenance history.

---

## Acceptance checklist

### UX audit outcomes (must be true after rollout)

- No nested dialogs for history (MOT is never opened as "dialog on top of dialog").
- History surface supports long timelines without overwhelming scroll (recent summary + pagination/infinite load).
- Opening history does not trigger a full page reload.
- "Maintenance" and "MOT" information are clearly separated (tabs) with predictable navigation.

### Feature 2 navigation consistency (must be true)

- `/maintenance` has a "View history" path that routes to the canonical history page for a vehicle.
- `/admin/vehicles` has a "View history" path that routes to the same canonical history page.
- The history page has a Back button that returns to the caller (`returnTo`) and is validated (no open redirect).
- If Feature 2's `/fleet` consolidation ships:
  - History route is already compatible (`/fleet/vehicles/[vehicleId]/history`) or legacy history route redirects cleanly.

### Data correctness + performance

- Maintenance audit entries and workshop task items render in a consistent timeline view (same semantics as today).
- **[Feature 1]**: Workshop task comments from `workshop_task_comments` table are fully displayed in timeline
- **[Feature 3]**: Workshop tasks display both category and subcategory badges with correct UI styling
- MOT history renders:
  - current status
  - test history
  - defect details
  - "no history yet" and "vehicle not found" states
- React Query caching prevents refetch storms when navigating between vehicles.
- Large histories remain usable (pagination; no rendering hundreds of rows at once).

### Permissions / access

- Users who can access `/maintenance` can access the history page for vehicles they're allowed to see.
- Admins can access the history page via `/admin/vehicles`.
- Documents/Notes tabs do not leak sensitive data (empty state is acceptable until those features exist).
