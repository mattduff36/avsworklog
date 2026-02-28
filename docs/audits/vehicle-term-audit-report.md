# Vehicle Term Global Audit Report

**Date:** 2026-02-28
**Scope:** Full codebase audit of `Vehicle`/`vehicle` occurrences following the inspections table refactor (`vehicle_inspections` → `van_inspections` + `plant_inspections`).

---

## Summary

| Category | Count | Action |
|---|---|---|
| RENAMED to Van/Asset | 35 instances across 11 files | Completed |
| KEPT as Vehicle | ~120+ instances across 30+ files | Intentionally preserved |
| Historical/migrations | Not counted | Ignored (non-runtime) |

---

## Changes Made (MUST_RENAME_TO_VAN)

### `app/(dashboard)/workshop-tasks/page.tsx`
| Line | Before | After | Reason |
|---|---|---|---|
| 1648 | "Track vehicle repairs and workshop work" | "Track van & plant repairs and workshop work" | Page subtitle |
| 1664 | "Vehicle Tasks" tab | "Van Tasks" | Tab label |
| 1701 | "Vehicle Filter" | "Van Filter" | Filter label |
| 1707 | "All Vehicles" | "All Vans" | Select option |
| 1757 | "No vehicle workshop tasks yet" | "No van workshop tasks yet" | Empty state |
| 3048 | "vehicles or plant machinery" | "vans or plant machinery" | Settings desc |
| 3054 | "Vehicle Categories" | "Van Categories" | Settings tab |
| 3090 | `'vehicle'` in ternary | `'van'` | Add dialog desc |
| 3097 | `'Vehicle'` in ternary | `'Van'` | Form label |
| 3108 | `'vehicle'` in placeholder | `'van'` | Select placeholder |
| 3492 | `'Vehicle'` in ternary | `'Van'` | Edit form label |
| 3523 | "Select vehicle" | "Select van" | Edit placeholder |
| 3551 | "Vehicles" in ternary | "Vans" | Select group label |

### `components/workshop-tasks/CreateWorkshopTaskDialog.tsx`
| Line | Before | After | Reason |
|---|---|---|---|
| 315 | "Unknown Vehicle" | "Unknown Asset" | Fallback text |
| 469 | "Add a new vehicle repair..." | "Add a new van or plant repair..." | Dialog description |
| 476 | "Vehicle" label | "Asset" | Form label |
| 496 | "Select vehicle" | "Select van or plant" | Placeholder |

### `components/workshop-tasks/WorkshopTaskModal.tsx`
| Line | Before | After | Reason |
|---|---|---|---|
| 125 | "Unknown Vehicle" | "Unknown Asset" | Fallback text |
| 183 | "Header with vehicle" | "Header with asset" | Comment |

### `components/workshop-tasks/AttachmentManagementPanel.tsx`
| Line | Before | After | Reason |
|---|---|---|---|
| 740 | "Vehicle Tasks" | "Van Tasks" | Checkbox label |

### `components/workshop-tasks/MarkTaskCompleteDialog.tsx`
| Line | Before | After | Reason |
|---|---|---|---|
| 234 | "Update Vehicle Maintenance" | "Update Asset Maintenance" | Dialog heading |
| 237 | "for this vehicle" | "for this asset" | Dialog description |

### `app/(dashboard)/actions/page.tsx`
| Line | Before | After | Reason |
|---|---|---|---|
| 492 | "Vehicle & plant repairs..." | "Van & plant repairs..." | Card description |
| 518,537,556 | "Vehicle" stat labels | "Van" | Workshop stats |
| 580 | "Scheduled vehicle maintenance" | "Scheduled van maintenance" | Maint card desc |
| 606,625 | "Vehicle" maintenance labels | "Van" | Maint stats |
| 827,931 | "Vehicle:" in action list | "Van:" | Inspection action display |

### `app/(dashboard)/van-inspections/page.tsx`
| Line | Before | After | Reason |
|---|---|---|---|
| 164 | "Apply vehicle filter" comment | "Apply van filter" | Comment |
| 437 | "Vehicle Filter" | "Van Filter" | Section comment |
| 440 | "Filter by vehicle:" | "Filter by van:" | Label text |
| 443 | "All vehicles" placeholder | "All vans" | Placeholder |
| 446 | "All Vehicles" | "All Vans" | Select option |
| 470 | "All Vehicles" group label | "All Vans" | Select group |
| 552 | "Unknown Vehicle" | "Unknown Van" | Card fallback |

### `app/(dashboard)/van-inspections/new/page.tsx`
| Line | Before | After | Reason |
|---|---|---|---|
| 1293 | "Vehicle Details Card" comment | "Van Details Card" | Comment |
| 1331 | "Vehicle" label | "Van" | Form label |
| 1370 | "Select a vehicle" | "Select a van" | Placeholder |
| 1376 | "Add New Vehicle" | "Add New Van" | Select option |
| 1399 | "All Vehicles" | "All Vans" | Group label |
| 1499 | "Vehicle and week ending..." | "Van and week ending..." | Info text |
| 1506 | "vehicle and week ending" comment | "van and week ending" | Comment |
| 1897 | "Add Vehicle Dialog" comment | "Add Van Dialog" | Comment |
| 1901 | "Add New Vehicle" dialog | "Add New Van" | Dialog title |
| 1903 | "vehicle registration number" | "van registration number" | Dialog desc |
| 1923 | "Vehicle Category" | "Van Category" | Label |
| 1961 | "Add Vehicle" button | "Add Van" | Button text |
| 2093 | "using this vehicle" | "using this van" | Submit dialog |
| 2098 | "Vehicle inspections" | "Van inspections" | Help text |
| 2101 | "using this vehicle" | "using this van" | Help text |

### `app/api/van-inspections/inform-workshop/route.ts`
| Line | Before | After | Reason |
|---|---|---|---|
| 80 | "Unknown Vehicle" | "Unknown Van" | Fallback |

### `app/api/van-inspections/sync-defect-tasks/route.ts`
| Line | Before | After | Reason |
|---|---|---|---|
| 75 | "Unknown Vehicle" | "Unknown Van" | Fallback |

### `lib/config/forms.ts`
| Line | Before | After | Reason |
|---|---|---|---|
| 106 | "Vehicle repairs & workshop work" | "Van & plant repairs and workshop work" | Config description |

### `types/roles.ts`
| Line | Before | After | Reason |
|---|---|---|---|
| 88 | "Track and manage vehicle maintenance schedules" | "Track and manage van maintenance schedules" | Module desc |
| 90 | "Track vehicle repairs and workshop work" | "Track van & plant repairs and workshop work" | Module desc |

### `app/(dashboard)/fleet/page.tsx`
| Line | Before | After | Reason |
|---|---|---|---|
| 530 | "Vehicle Categories Section" comment | "Van Categories Section" | Comment |
| 650 | "Vehicle Categories" heading | "Van Categories" | Card title |

---

## Intentionally Kept as "Vehicle" (KEEP_AS_VEHICLE)

These are domain-correct uses of "Vehicle" that refer to fleet vehicle entities (the `vehicles` DB table), maintenance workflows, admin management, or DVLA integration — not the inspections rename.

### Fleet/Maintenance Domain (30+ files)
- **`vehicles` table references**: `from('vehicles')`, `vehicle_id`, `Vehicle` type definitions
- **Admin vehicle management**: `AddVehicleDialog`, `DeleteVehicleDialog`, `VehicleCategoryDialog`, `EditMaintenanceDialog` — fleet admin CRUD
- **Vehicle history pages**: `fleet/vehicles/[vehicleId]/history/` — fleet record keeping
- **Maintenance components**: `MaintenanceTable`, `MaintenanceHistoryDialog`, `MotHistoryDialog`, `MaintenanceOverview`, `QuickEditPopover`
- **API routes**: `/api/admin/vehicles/`, `/api/maintenance/history/[vehicleId]/`, `/api/maintenance/mot-history/`, `/api/maintenance/sync-dvla/`, `/api/maintenance/reminders/`
- **DVLA integration**: `DVLASyncDebugPanel`, `dvla-api.ts`
- **Fleet components**: `ExpandingVehicleCard`
- **Timesheets**: "Vehicle Registration (Optional)" — civils timesheet field
- **Reports**: inspection compliance/defects routes use `vehicle_id` for joins
- **PDF generation**: `inspection-pdf.tsx`, `workshop-attachment-pdf.tsx` — reference `vehicle_id` for asset lookup
- **Module pages config**: "Vehicle Management", "Vehicle History" — admin module labels
- **Debug pages**: "Archive Vehicles", "Test Vehicles" — admin tooling

### Variables/Types (all files)
- `Vehicle` type (fleet entity with `reg_number`, `plant_id`, `asset_type`)
- `vehicles` state arrays and variables
- `selectedVehicle`, `recentVehicles`, `otherVehicles` — variable names
- `vehicleFilter`, `vehicleId`, `vehicleReg` — variable names
- `asset_type: 'vehicle'` — enum value in DB schema

### Utility Functions
- `recordRecentVehicleId`, `splitVehiclesByRecent`, `getRecentVehicleIds` — fleet utility
- `serviceTaskCreation.ts` — uses vehicle domain concepts
- `validators.ts`, `email.ts` — fleet validation

---

## Guard Enforcement

The following automated guards now prevent regressions:

1. **`from('vehicle_inspections')` in runtime code** — BLOCKED
2. **`Tables['vehicle_inspections']` in runtime code** — BLOCKED
3. **"Vehicle Inspection(s)" UI text** — BLOCKED (excluding test files)
4. **"Vehicle Tasks" UI label** — BLOCKED (excluding test files)
5. **"Unknown Vehicle" fallback text** — BLOCKED (excluding test files)

Guards run via:
- `node scripts/guards/no-vehicle-inspections.mjs` (CI script)
- `npx vitest run tests/unit/inspections/no-vehicle-inspections-guard.test.ts` (unit tests)

---

## Verification Results

| Check | Result |
|---|---|
| Static guard (5 patterns) | ✅ All passed |
| Unit tests (48 tests) | ✅ All passed |
| Production build | ✅ Success |
| TypeScript check | ⚠️ 1 pre-existing error (unmodified `MaintenanceHistoryDialog.tsx`) |
