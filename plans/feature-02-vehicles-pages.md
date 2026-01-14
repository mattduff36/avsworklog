# Feature 2: Remove duplication between `/maintenance` and `/admin/vehicles`

PRD alignment: This plan aligns with **Vehicle Maintenance & Service PRD** goals around vehicle management + RBAC: `docs/PRD_VEHICLE_MAINTENANCE_SERVICE.md` (Goals & Success Criteria items 5, 9, and related acceptance criteria).

## Inventory

### What each page shows today

- **`/maintenance`** (`app/(dashboard)/maintenance/page.tsx`)
  - **Purpose today**: Maintenance operations dashboard.
  - **Main UI**:
    - Header “Vehicle Maintenance & Service”
    - Tabs: `Maintenance` and `Settings` (Settings disabled unless manager/admin)
    - `MaintenanceOverview` summary cards
    - `MaintenanceTable` showing maintenance-centric vehicle list
  - **Vehicle-related capabilities embedded today**:
    - Add vehicle via `AddVehicleDialog`
    - Retire (archive) vehicle via `DeleteVehicleDialog`
    - Update vehicle nickname inside `EditMaintenanceDialog`
    - View retired vehicles and permanently delete archives (admin/manager only)

- **`/admin/vehicles`** (`app/(dashboard)/admin/vehicles/page.tsx`)
  - **Purpose today**: Admin-only master data management.
  - **Main UI**:
    - Stats cards (total/active/inactive/categories)
    - Tabs: `Vehicles`, `Categories`, and a link to `/maintenance`
    - Vehicles table: registration, category, status, last inspector/date + actions
    - Category CRUD tables and dialogs
  - **Vehicle-related capabilities**:
    - Add/edit/delete vehicles
    - Add/edit/delete categories

### Roles/permissions (current vs intended)

- **Current UI gating**
  - `/admin/vehicles`: gated by `useAuth().isAdmin` (client-side check).
  - `/maintenance`: gated by `maintenance` module permission for employees; managers/admins always allowed.

- **Current API gating (actual enforcement)**
  - `GET/POST /api/admin/vehicles` and `PUT/DELETE /api/admin/vehicles/[id]`: **admin-only** via `getProfileWithRole()` checks.
  - `/api/maintenance/*`: authenticated; relies on RLS + checks.

- **Intended**
  - **Vehicle master data (add/retire/edit nickname/category/status)**: **Admin + Manager**.
  - Employees with `maintenance` module permission: **read-only maintenance view** (no master-data mutations).

### Entry points and links

- **Navigation config**: `lib/config/navigation.ts`
  - Employee nav includes `/maintenance`.
  - Admin nav includes `/admin/vehicles`.
- **Dashboard tiles**: `app/(dashboard)/dashboard/page.tsx`
  - Admin “Management Tools” includes link to `/admin/vehicles`.
- **Cross-link**:
  - `/admin/vehicles` has a tab trigger linking to `/maintenance`.

### Components used and file paths

- **Maintenance page**
  - Page: `app/(dashboard)/maintenance/page.tsx`
  - Components:
    - `app/(dashboard)/maintenance/components/MaintenanceOverview.tsx`
    - `app/(dashboard)/maintenance/components/MaintenanceTable.tsx`
    - `app/(dashboard)/maintenance/components/EditMaintenanceDialog.tsx`
    - `app/(dashboard)/maintenance/components/AddVehicleDialog.tsx`
    - `app/(dashboard)/maintenance/components/DeleteVehicleDialog.tsx`
    - `app/(dashboard)/maintenance/components/MaintenanceSettings.tsx`
    - `app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx`
  - Data hooks: `lib/hooks/useMaintenance.ts`

- **Admin vehicles page**
  - Page: `app/(dashboard)/admin/vehicles/page.tsx`
  - Uses many `components/ui/*` primitives directly.

- **APIs**
  - Vehicles: `app/api/admin/vehicles/route.ts`, `app/api/admin/vehicles/[id]/route.ts`
  - Categories: `app/api/admin/categories/*` (referenced from UI)
  - Maintenance: `app/api/maintenance/route.ts` (+ subroutes)

## Decision options

### Option A (selected): Merge pages

#### Target end-state

Create a **single “Fleet” home** that contains both:
- **Maintenance operations** (existing `/maintenance` experience)
- **Vehicle master data management** (existing `/admin/vehicles` experience)

…with **permission-aware tabs**:
- Everyone with `maintenance` module permission can access the Maintenance view.
- Only **Admin + Manager** can access “Vehicles” and “Categories” (master data) tabs.

#### New route + redirects

- **New canonical route**: `/fleet`
  - Implemented at `app/(dashboard)/fleet/page.tsx` (new page)
- **Redirects**
  - `/maintenance` → `/fleet?tab=maintenance`
  - `/admin/vehicles` → `/fleet?tab=vehicles`

(We keep old URLs working for bookmarks and existing navigation while consolidating the source of truth.)

#### Permission gating

- `/fleet`
  - Gate overall page with existing maintenance access logic.
  - Gate the “Vehicles/Categories” tabs and all mutation UI with `isAdmin || isManager`.
- Update server-side authorization to match intent:
  - Allow **admin OR manager** for `/api/admin/vehicles/*` (and categories endpoints) or introduce `/api/fleet/*` equivalents.

### Option B: Split responsibilities

- `/maintenance` owns maintenance schedule and a reduced vehicle list (maintenance columns only).
- `/admin/vehicles` remains the canonical “Fleet master data” page.
- `/maintenance` either:
  - Links to `/admin/vehicles` for add/edit/retire, or
  - Embeds a shared component in read-only mode.

## Recommendation

Choose **Option A (Merge)** because it matches the real workflow separation implied in the codebase:
- **Maintenance view** is used by a broader audience (module permission) and is operational.
- **Vehicle master data management** should be limited to **Admin + Manager** to prevent accidental fleet changes while still enabling the people who run fleet operations.

Merging into `/fleet` reduces navigation confusion (“Where do I manage vehicles?”), eliminates duplicated dialogs/validation, and makes RBAC easier to reason about (one place to check).

## Implementation steps (no code)

### 1) Routing changes

- Add new route `app/(dashboard)/fleet/page.tsx`.
- Implement query-param driven tab selection (e.g. `?tab=maintenance|vehicles|categories|settings`).
- Convert legacy routes to redirects:
  - `app/(dashboard)/maintenance/page.tsx` becomes a redirect wrapper.
  - `app/(dashboard)/admin/vehicles/page.tsx` becomes a redirect wrapper.

### 2) Component refactor plan

#### Components to extract

- **`components/vehicles/VehiclesTable.tsx`**
  - Base table component (search, sorting, column definitions, empty/loading states).
- **`components/vehicles/vehicles-admin-panel.tsx`**
  - Vehicles + Categories UI currently embedded in `app/(dashboard)/admin/vehicles/page.tsx`.
- **`components/vehicles/vehicle-upsert-dialog.tsx`**
  - Shared Add/Edit vehicle dialog used by both master data panel and (where applicable) maintenance.
- **`lib/utils/vehicle-registration.ts`**
  - Shared formatting/validation wrapper for registration UX (input normalization + storage formatting).

#### Pages to touch

- `app/(dashboard)/fleet/page.tsx` (new)
- `app/(dashboard)/maintenance/page.tsx` (redirect + remove duplicated UI ownership)
- `app/(dashboard)/admin/vehicles/page.tsx` (redirect)
- `lib/config/navigation.ts` (update nav to point to `/fleet` and remove direct `/admin/vehicles` entry)
- `app/(dashboard)/dashboard/page.tsx` (tiles to point to `/fleet?tab=vehicles` for admins)

### 3) Remove duplicated queries and state

- Standardize vehicle + category data fetching using React Query (single pattern):
  - Create `lib/hooks/useVehicles.ts` (or similar) for:
    - `useVehiclesList()` → `GET /api/admin/vehicles`
    - `useVehicleCategories()` → `GET /api/admin/categories`
    - mutations for add/edit/archive
- Deprecate bespoke fetch/state inside `app/(dashboard)/admin/vehicles/page.tsx` by moving it into extracted components + hooks.
- Ensure `/maintenance` no longer implements its own vehicle CRUD UI; it should defer to the Fleet master tabs for mutations.

### 4) Align permissions end-to-end

- Update vehicles/categories API authorization to match **Admin + Manager**.
- Update UI gating so employees with maintenance permission:
  - See maintenance status tables
  - Do **not** see Add/Retire/Category management UI

### 5) Update navigation links

- Employee nav item “Maintenance” → rename/retarget to “Fleet” or keep label but point to `/fleet?tab=maintenance`.
- Admin nav item “Vehicles” → point to `/fleet?tab=vehicles`.
- Remove in-page link duplication once Fleet tabs exist.

## Regression risks and tests

### Auth regression

- Risk: Managers lose access (or employees accidentally gain access) to master data.
- Tests:
  - Extend `tests/integration/api/admin-vehicles.test.ts` to cover:
    - Admin allowed
    - Manager allowed (new)
    - Employee denied

### Data consistency

- Risk: category requirement mismatches (UI optional vs API required) and archive reason defaults.
- Tests/checks:
  - UI validation for category required in the shared dialog.
  - Shared “archive reason” dialog used wherever “Retire vehicle” is possible.

## Acceptance checklist

- One canonical route exists for fleet work: **`/fleet`**.
- `/maintenance` and `/admin/vehicles` continue to function via redirects.
- Vehicles table and vehicle dialogs have **one implementation** (shared components).
- Vehicle CRUD permissions match policy: **Admin + Manager** only.
- Maintenance view remains accessible by maintenance module permission.
- Existing automated tests updated/added for manager authorization.
- Navigation and dashboard entry points all route to `/fleet`.

