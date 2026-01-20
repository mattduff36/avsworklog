---
name: Feature04_History_UI
overview: ""
todos: []
---

# Feature 4: Review Maintenance History + MOT History UI (Modal vs Page)

## PRD linkage + Feature 2 alignment

- **Base PRD**: [docs/PRD_VEHICLE_MAINTENANCE_SERVICE.md](docs/PRD_VEHICLE_MAINTENANCE_SERVICE.md)
  - Key requirement pressure points: **audit trail**, **mandatory comments**, **desktop-optimized**, and explicit note that **`/admin/maintenance-demo` should be removed** (it is referenced but should not be the user flow).
- **Feature 2 navigation surfaces to align**: **`/maintenance`** (maintenance module workflow) and **`/admin/vehicles`** (admin fleet management).
- **Feature 4 goal**: keep a **single, consistent “vehicle history” experience** reachable from both pages.

---

## UX audit

### Current UI surfaces

- **Maintenance history UI**: `Dialog` at [app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx](app/\\\\\(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx)
- **MOT history UI**: `Dialog` at [app/(dashboard)/maintenance/components/MotHistoryDialog.tsx](app/\\\\\(dashboard)/maintenance/components/MotHistoryDialog.tsx)
- **Entry from `/maintenance`**: clicking a vehicle row opens history via [app/(dashboard)/maintenance/components/MaintenanceTable.tsx](app/\\\\\(dashboard)/maintenance/components/MaintenanceTable.tsx)
- **Entry from `/admin/vehicles`**: **no direct “history” entry today**; there is still a link to the removed `/admin/maintenance-demo` in [app/(dashboard)/admin/vehicles/page.tsx](app/\\\\\(dashboard)/admin/vehicles/page.tsx)

### Data shown: Maintenance History dialog

- **Header/actions**
  - Title: “Maintenance History - {vehicleReg}”
  - Actions: **MOT** (opens MOT dialog), **Edit** (closes history then opens edit)
- **Auto-sync behavior (side effect)**
  - On open, checks DVLA/MOT “staleness” and may sync; on success it calls `window.location.reload()` (heavy UX side effect; breaks modal mental model)
- **Vehicle data (VES + MOT fields) section** (when available)
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
- **Combined activity timeline** (sorted newest-first)
  - **Maintenance audit entries** (from `maintenance_history`):
    - Updated by (name)
    - Field updated (mapped label)
    - Old → New values (formatted by type: date/mileage/boolean)
    - Mandatory comment
    - Relative time (“x minutes ago”, etc)
  - **Workshop task history items** (from `actions`-backed workshop tasks):
    - User (name)
    - Task type (inspection defect fix vs workshop task)
    - Category (if present)
    - Status (Pending / In Progress / Completed)
    - Started/completed timestamps (relative)
    - Task details: workshop comments / description
    - Progress note (logged_comment)
    - Completed note (actioned_comment)
- **Progressive disclosure controls**
  - “Recent Updates” (top 3)
  - “Show More” expansion + “Show More (N remaining)” pagination-in-place

### Data shown: MOT History dialog

- **Header**
  - Title: “MOT History - {vehicleReg}”
- **Loading/error states**
  - “Vehicle not found” (test vehicle / invalid reg messaging)
  - “No MOT history yet” (e.g., vehicle too new)
  - Generic error w/ “Try Again”
- **Current status summary card**
  - Expiry date
  - Status (Valid/Expired/etc)
  - Days remaining
  - Last test date
  - Special “No MOT History” variant:
    - First MOT due date (from existing due date if present; else from GOV.UK data; else calculated +3y from first used)
- **Test history list**
  - For each test:
    - Result + completed date
    - Expiry date (if present)
    - Mileage + unit
    - Test station name + postcode (if present)
    - MOT test number
    - Defects summary badges by type (Dangerous/Major/Minor/Advisory)
    - Expand/collapse defects list (each defect shows type, lateral, text)

### Interaction problems (scroll, density, discoverability)

- **Modal stacking**: Maintenance history opens MOT history as a second dialog. This creates:
  - confusing focus/escape-key behavior
  - unclear “where am I” context
  - higher risk of scroll-jank and lost reading position
- **Scroll + density**:
  - Both dialogs are `max-h` with `overflow-y-auto` and contain large card lists.
  - Content is “high-density” (badges, multi-line notes, multiple grids), but there is no persistent structure (no left-nav, no anchors, no search).
- **Hidden complexity**:
  - Users must discover “Show More”, then repeatedly “Show More (N remaining)” to reach older entries.
  - MOT defects are buried behind per-test expanders.
- **Side effects on open**:
  - Auto-sync on open + `window.location.reload()` is disruptive and breaks the expectation that a history view is read-only.

### Mobile issues

- **Full-screen modal behavior**: dialogs are effectively full height on mobile; long content becomes “app-within-app”.
- **Nested dialog is worse on mobile**: MOT dialog on top of Maintenance history multiplies back/close confusion.
- **Discoverability**: expanding older history and defects competes with limited viewport; users lose their place easily.

### Entry points (Feature 2 alignment)

- **From `/maintenance`** (maintenance workflow):
  - Current: row click opens Maintenance History dialog; “MOT” opens MOT dialog.
- **From `/admin/vehicles`** (admin workflow):
  - Current: no direct history; still contains a link to `/admin/maintenance-demo` (which is documented as deleted). 
  - Desired: provide the *same* history surface as `/maintenance`, without requiring admins to “switch mental models”.

---

## Options

### Option A: Keep modal, refactor layout

- **What changes**:
  - Keep dialogs but restructure into internal tabs within the dialog: “Maintenance”, “MOT”, “Notes/Vehicle data”.
  - Remove nested modal; MOT becomes a tab.
  - Replace auto-sync+reload with explicit “Refresh DVLA/MOT data” and React Query invalidation.
- **Pros**:
  - Lowest routing churn; minimal navigation changes.
  - Keeps users “in context” of the list.
- **Cons**:
  - Still suffers from “dialog as mini-app” for large historical views.
  - Deep linking/sharing/history/back-button remain weak.

### Option B: Convert to drawer/side panel

- **What changes**:
  - Use a `Sheet` (drawer) or desktop side panel: list on the left, history on the right.
  - On mobile, drawer becomes full-screen (still better than nested dialogs).
  - Internal tabs for Maintenance/MOT.
- **Pros**:
  - Better for desktop (split attention) and reduces modal feel.
  - Maintains “return to list” without route change.
- **Cons**:
  - Still not a true deep-link; back-button can be awkward unless URL state is added.
  - `/admin/vehicles` alignment still requires a consistent mechanism.

### Option C: Dedicated vehicle history page with tabs (Maintenance, MOT, Documents, Notes)

- **What changes**:
  - Introduce a dedicated route that both Feature 2 entry points navigate to.
  - Tabs provide the information architecture instead of stacking dialogs.
- **Pros**:
  - Best scalability for growing history complexity.
  - Clean deep-linking, browser back/forward, shareability.
  - Makes cross-entry alignment (Feature 2) straightforward.
- **Cons**:
  - Requires routing decisions and some new shared components.
  - Needs careful permission gating (maintenance-module users vs admin users).

---

## Recommendation

**Recommend Option C: Dedicated vehicle history page with tabs.**

Rationale:

- Current UI is already behaving like a mini-application (nested dialogs, heavy scroll, progressive disclosure, background sync). This is a strong signal the modal pattern is no longer the right container.
- Option C provides a single, consistent destination from both **Feature 2 pages** (`/maintenance` and `/admin/vehicles`) and avoids duplicating “history UI logic” per module.

---

## Routing / URLs (page-based)

### Proposed canonical route

- **Primary**: `/maintenance/vehicles/[vehicleId]/history`
  - Lives under the maintenance module URL space, matching the audience and permission model.
  - Admins can still access via link from `/admin/vehicles`.

### Tab state (use query params)

- `?tab=maintenance|mot|documents|notes` (default `maintenance`)
  - Use `nuqs` to manage `tab` state.

### “Back to where I came from”

- Add an optional `?returnTo=/maintenance` or `?returnTo=/admin/vehicles`.
  - Validate `returnTo` is a safe internal path (allowlist these two paths) before rendering a Back button.

### Navigation flow (mermaid)

```mermaid
flowchart TD
maintenanceList[/maintenance/] -->|ViewHistory(vehicleId)| historyPage[/maintenance/vehicles/:vehicleId/history?tab=maintenance&returnTo=/maintenance/]
adminVehicles[/admin/vehicles/] -->|ViewHistory(vehicleId)| historyPage
historyPage -->|Back| maintenanceList
historyPage -->|Back| adminVehicles
```

---

## Implementation steps (no code)

### Phase 0: Remove dead navigation and clarify Feature 2 entry points

- Replace the stale `/admin/maintenance-demo` link in [app/(dashboard)/admin/vehicles/page.tsx](app/\\\\\(dashboard)/admin/vehicles/page.tsx) with a “Maintenance & Service” link to `/maintenance` and/or the new history destination.
- Add a clear “View History” action per vehicle row in `/admin/vehicles` (button/menu).

### Phase 1: Create the dedicated history page surface

- Add a new page route (RSC shell + minimal client subcomponents as needed):
  - `app/(dashboard)/maintenance/vehicles/[vehicleId]/history/page.tsx`
- Page layout:
  - Header with reg number + key status chips (Tax/MOT due, status)
  - Tabs: Maintenance | MOT | Documents | Notes
  - Consistent “Back” action based on `returnTo` (validated)

### Phase 2: Extract reusable “history sections” from the dialogs

- Refactor the dialog code into reusable presentational components (so the new page reuses logic):
  - `VehicleDataSummary` (VES/MOT fields)
  - `MaintenanceAuditTimeline` (maintenance_history entries)
  - `WorkshopTaskTimeline` (workshop task history items)
  - `MotHistoryPanel` (current status + test list)
- Keep the existing dialogs temporarily by reusing these extracted components (avoids regression while migrating entry points).

### Phase 3: State management plan (Feature 2 consistency)

- **Tabs**: `nuqs` query state for `tab`.
- **Expansion states**:
  - MOT expanded test id: local component state (not URL)
  - Maintenance “show more”: prefer cursor/limit (see Data strategy) rather than large in-memory lists
- **Return navigation**:
  - `returnTo` param controlled by callers; allowlist only `/maintenance` and `/admin/vehicles`.

### Phase 4: Data loading strategy + performance

- **Maintenance history**:
  - Continue using React Query via `useMaintenanceHistory(vehicleId)` (already exists), but make it usable from the new page.
  - Consider adding pagination support to `GET /api/maintenance/history/[vehicleId]` (cursor + limit) once history volume grows.
- **MOT history**:
  - Introduce a React Query hook (e.g., `useMotHistory(vehicleId)`) wrapping `GET /api/maintenance/mot-history/[vehicleId]` for caching, retries, and consistent loading UX.
- **DVLA/MOT sync behavior**:
  - Replace auto-sync-on-open with:
    - explicit “Refresh data” affordance
    - background refresh with React Query invalidation (no `window.location.reload()`)
- **Rendering performance**:
  - Keep “Recent” summary for Maintenance audit.
  - For large lists, prefer pagination/infinite load and avoid rendering hundreds of cards at once.

### Phase 5: Deprecate modals (or keep as quick-view)

- Once page is stable:
  - Either remove the dialogs entirely, or keep them as a lightweight quick-preview that links to “Open full history page”.
  - Ensure there is no nested dialog behavior.

---

## Component breakdown (target files)

- **New route**
  - `app/(dashboard)/maintenance/vehicles/[vehicleId]/history/page.tsx`
- **Shared UI components (new folder suggested)**
  - `app/(dashboard)/maintenance/components/vehicle-history/VehicleHistoryHeader.tsx`
  - `app/(dashboard)/maintenance/components/vehicle-history/VehicleHistoryTabs.tsx`
  - `app/(dashboard)/maintenance/components/vehicle-history/VehicleDataSummary.tsx`
  - `app/(dashboard)/maintenance/components/vehicle-history/MaintenanceAuditTimeline.tsx`
  - `app/(dashboard)/maintenance/components/vehicle-history/WorkshopTaskTimeline.tsx`
  - `app/(dashboard)/maintenance/components/vehicle-history/MotHistoryPanel.tsx`
  - `app/(dashboard)/maintenance/components/vehicle-history/DocumentsPanel.tsx` (initially “empty state”, wired later)
  - `app/(dashboard)/maintenance/components/vehicle-history/NotesPanel.tsx` (initially: show current notes + link into maintenance audit entries where `field_name='notes'`)
- **Hook additions (for consistency)**
  - Extend `lib/hooks/useMaintenance.ts` with MOT history query hook.

---

## Acceptance checklist

- **UX / Interaction**
  - No nested dialogs for history.
  - Tabs clearly separate Maintenance vs MOT vs Notes/Documents.
  - Page supports long history without overwhelming scroll (recent summary + pagination).
  - No page reloads triggered by opening history.

- **Feature 2 navigation consistency**
  - `/maintenance` provides a “View history” path that routes to the same canonical history page.
  - `/admin/vehicles` provides a “View history” path that routes to the same canonical history page.
  - History page offers a correct Back action to the caller page via validated `returnTo`.

- **