---
name: split-asset-modals-hgv-settings
overview: Split the existing Add New Asset flow into type-specific modals (Van, Plant, HGV), wire HGV creation and fields, and extend /maintenance Settings so all required HGV maintenance periods are configurable with sensible defaults while removing category card collapse behavior.
todos:
  - id: split-add-asset-flow
    content: Decompose AddVehicleDialog into type picker + AddVanDialog/AddPlantDialog/AddHgvDialog and rewire table triggers.
    status: completed
  - id: hgv-form-and-api
    content: Implement HGV required fields and submit via /api/admin/hgvs with validation + shared helper extraction.
    status: completed
  - id: maintenance-categories-migration
    content: Create migration to add missing HGV categories and default periods (Taco Calibration 24 months), preserving existing configured values.
    status: completed
  - id: settings-ui-update
    content: Remove expand/collapse from Maintenance Categories card and keep table/actions always visible.
    status: completed
  - id: compatibility-mapping
    content: Add/adjust category-label mappings in overview/history/office-action surfaces to avoid naming regressions.
    status: completed
  - id: once-ui-styling
    content: Apply Once UI component approach with site color tokens in new modal surfaces and validate visual consistency.
    status: completed
  - id: verify-and-polish
    content: Run lint/type checks and execute targeted manual verification of Add Asset and Settings behaviors.
    status: completed
isProject: false
---

# Split Add Asset Into 3 Modals + HGV Maintenance Settings

## Scope and defaults used

- Keep one entry action (`Add Asset`) and show an asset-type picker first, then open the relevant modal.
- Preserve existing backend category naming where it already exists (for compatibility), and map user-facing labels in UI.
- Apply Once UI styling/components in the modal layer with site color tokens; where Once UI has no direct equivalent, use existing primitives with Once-style classes.

## 1) Replace monolithic add dialog with orchestrated 3-modal flow

- Refactor current modal from `[app/(dashboard)/maintenance/components/AddVehicleDialog.tsx](app/(dashboard)`/maintenance/components/AddVehicleDialog.tsx) into:
  - `AddAssetTypeDialog` (picker: Van / Plant / HGV)
  - `AddVanDialog`
  - `AddPlantDialog`
  - `AddHgvDialog`
- Keep parent triggers in `[app/(dashboard)/maintenance/components/MaintenanceTable.tsx](app/(dashboard)`/maintenance/components/MaintenanceTable.tsx) and `[app/(dashboard)/maintenance/components/PlantTable.tsx](app/(dashboard)`/maintenance/components/PlantTable.tsx), but route all "Add" clicks through the type picker + specific dialog sequence.
- Ensure query invalidation and callbacks stay identical (`['maintenance']`, `onSuccess`) to avoid stale data regressions.

## 2) Implement HGV-specific create modal and wire API correctly

- Create HGV form in `AddHgvDialog` with required fields:
  - Registration, Nickname, Mileage
  - Tax Due, MOT Due, 6 Weekly Inspection Due, Service Due, First Aid Kit Due, Fire Extinguisher Due, Taco Calibration Due
- Submit to HGV route (`/api/admin/hgvs`) instead of `/api/admin/vans`.
- Reuse formatting/validation patterns from existing registration and date input logic, but move into shared helpers to prevent duplication.
- Confirm data mapping to maintenance columns used elsewhere (from `[types/maintenance.ts](types/maintenance.ts)` and existing maintenance update contracts).

## 3) Add/align maintenance categories + default periods for HGV

- Extend category seed/backfill via a new migration in `[supabase/migrations](supabase/migrations)` that:
  - Adds missing categories required by HGV table if absent.
  - Sets sensible initial period defaults (preserving existing values where already configured).
  - Sets Taco Calibration default period to 24 months.
- Ensure all new categories are configurable in Settings and correctly scoped in `applies_to` (include HGV in applicability path used by this codebase).
- After migration changes that rename/drop schema objects (if any), run `npm run db:validate` per workspace rule.

## 4) Make Settings tab always-expanded and category-editable

- Update `[app/(dashboard)/maintenance/components/MaintenanceSettings.tsx](app/(dashboard)`/maintenance/components/MaintenanceSettings.tsx):
  - Remove expand/collapse state and chevron UI.
  - Render categories table content always visible.
- Keep add/edit/delete/category recipient actions unchanged.
- Ensure period values for newly added HGV categories are visible/editable through existing dialogs/hooks:
  - `[app/(dashboard)/maintenance/components/CategoryDialog.tsx](app/(dashboard)`/maintenance/components/CategoryDialog.tsx)
  - `[lib/hooks/useMaintenance.ts](lib/hooks/useMaintenance.ts)`

## 5) Keep overview/history behavior compatible

- Audit hardcoded category-name mappings in:
  - `[app/(dashboard)/maintenance/components/MaintenanceOverview.tsx](app/(dashboard)`/maintenance/components/MaintenanceOverview.tsx)
  - `[app/(dashboard)/maintenance/components/MaintenanceHistoryDialog.tsx](app/(dashboard)`/maintenance/components/MaintenanceHistoryDialog.tsx)
  - `[app/(dashboard)/maintenance/components/OfficeActionDialog.tsx](app/(dashboard)`/maintenance/components/OfficeActionDialog.tsx)
- Add mapping aliases where needed so new HGV categories display correctly without breaking existing Tax/MOT/Service workflows.

## 6) Once UI integration + visual consistency

- Introduce Once-style component wrappers/theme tokens under a local UI adapter layer (e.g., `components/ui/once-*`), then consume them in the new modal components first.
- Apply existing brand palette tokens (`bg-maintenance`, `bg-maintenance-dark`, current text/border tokens) to ensure visual consistency with the site.
- Keep interaction patterns (loading, toast feedback, error messaging) consistent with current UX.

## 7) Verification checklist

- UI:
  - Add Asset → picker → correct modal opens.
  - Each modal only shows relevant fields.
  - HGV table reflects newly created records and required due fields.
- Settings:
  - Categories card is no longer collapsible.
  - New/missing HGV categories exist and periods are editable.
- Data/API:
  - HGV create hits `/api/admin/hgvs`.
  - Existing van/plant create flows remain unchanged.
- Quality:
  - Run lints/type checks for touched files and fix regressions.

