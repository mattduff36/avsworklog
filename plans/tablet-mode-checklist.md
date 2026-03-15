# Tablet Mode Execution Checklist (Manual Opt-In, Phase 1)

## Branch and Setup

- [x] Create/switch to `feature/tablet-mode-planning`
- [ ] Confirm clean scope for this work (no unrelated feature edits)

## Guardrails (Must Hold)

- [ ] No automatic mode activation logic added
- [ ] No global default edits to:
  - [ ] `components/ui/button.tsx`
  - [ ] `components/ui/select.tsx`
  - [ ] `components/ui/dropdown-menu.tsx`
  - [ ] `components/ui/dialog.tsx`
- [ ] No baseline shell geometry changes to:
  - [ ] `components/layout/DashboardContent.tsx`
  - [ ] `components/layout/Navbar.tsx`

## Phase 0 - Provider and Mode Gate

- [ ] Add Tablet Mode provider/hook (dashboard shell scope)
- [ ] Wire provider in `components/layout/DashboardLayoutClient.tsx`
- [ ] Add shell gate attribute (`data-tablet-mode`)
- [ ] Add per-user localStorage persistence (`tablet_mode:<user_id>`)
- [ ] Verify mode-off behavior remains unchanged

## Phase 1 - Manual Toggle

- [ ] Add right-side `Try Tablet Mode` button in `app/(dashboard)/dashboard/page.tsx`
- [ ] Add explicit `Exit Tablet Mode` action
- [ ] Ensure toggle affects shell gate immediately
- [ ] Ensure mode persists across refresh/navigation

## Phase 2 - Scoped Tablet Variants (No Global Defaults)

- [ ] Create module-scoped wrappers/variants for high-touch controls
- [ ] Apply wrappers in target modules only
- [ ] Keep desktop default visuals/spacing intact when mode off

## Phase 3 - Workshop + Inspections

### Workshop Tasks
- [ ] Improve touch layout in `app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs.tsx`
- [ ] Add dirty-close guard before reset/cancel

### Inspections
- [ ] Preserve current logic in:
  - [ ] `app/(dashboard)/van-inspections/new/page.tsx`
  - [ ] `app/(dashboard)/plant-inspections/new/page.tsx`
  - [ ] `app/(dashboard)/hgv-inspections/new/page.tsx`
- [ ] Apply tablet-mode density/touch improvements only

## Phase 4 - Maintenance + Fleet

- [ ] Improve tablet usability in:
  - [ ] `app/(dashboard)/maintenance/components/MaintenanceTable.tsx`
  - [ ] `app/(dashboard)/maintenance/page.tsx`
  - [ ] `app/(dashboard)/fleet/page.tsx`
- [ ] Reduce tiny action targets and improve touch spacing

## Phase 5 - Data Safety Hardening

- [ ] Standardize dirty-dismiss safeguards for high-risk dialogs
- [ ] Add unsaved-change guard for targeted high-risk forms
- [ ] Add reload-sensitive safeguards where practical

## Phase 6 - Testing and Hardening

### Unit
- [ ] Add provider persistence/toggle tests
- [ ] Add wrapper mode-gate tests

### E2E
- [ ] Add dashboard toggle flow test
- [ ] Add cross-module persistence test
- [ ] Add refresh persistence test
- [ ] Add mode-off desktop parity tests for touched pages

### Manual Devices
- [ ] Lenovo Tab K11 Plus portrait/landscape
- [ ] Smaller Android tablet portrait/landscape
- [ ] Smaller iPad-class device portrait/landscape
- [ ] Validate touch-only workflows and no accidental data loss

## Deliverables

- [x] `plans/tablet-mode-implementation-plan.md`
- [x] `plans/tablet-mode-checklist.md`
- [ ] `plans/tablet-mode-risk-and-test-plan.md`
