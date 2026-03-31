# Tablet Mode Risk and Test Plan (Manual Opt-In, Phase 1)

## Scope

This plan covers risk controls and validation for manual Tablet Mode in:
- `dashboard`
- `workshop-tasks`
- `van-inspections`
- `plant-inspections`
- `hgv-inspections`
- `maintenance`
- `fleet`

It enforces the phase-1 product rule: **manual activation only**.

## Risk Register

## R1 - Desktop Regression from Shared UI Changes
- **Risk:** desktop spacing/targets unintentionally change due to global primitive edits.
- **Impact:** high.
- **Likelihood:** medium.
- **Risky files:**
  - `components/ui/button.tsx`
  - `components/ui/select.tsx`
  - `components/ui/dropdown-menu.tsx`
  - `components/ui/dialog.tsx`
  - `components/layout/DashboardContent.tsx`
  - `components/layout/Navbar.tsx`
- **Mitigation:**
  - no global default edits in phase 1.
  - use shell-gated mode and module-scoped wrappers.
  - add mode-off parity tests for touched pages.
- **Exit criteria:** mode-off baseline remains unchanged across touched modules.

## R2 - Accidental Data Loss from Modal Dismissal
- **Risk:** outside click/Escape/cancel resets in-progress form data.
- **Impact:** high.
- **Likelihood:** high in workshop/fleet dialogs.
- **Risky files:**
  - `components/ui/dialog.tsx` (default behavior)
  - `app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs.tsx`
- **Mitigation:**
  - adopt dirty-close guard pattern from:
    - `app/(dashboard)/maintenance/components/EditMaintenanceDialog.tsx`
    - `app/(dashboard)/maintenance/components/EditPlantRecordDialog.tsx`
- **Exit criteria:** targeted dialogs do not close silently when dirty.

## R3 - Data Loss During Reload Paths
- **Risk:** pull-to-refresh or forced version reload interrupts in-progress work.
- **Impact:** high.
- **Likelihood:** medium.
- **Risky files:**
  - `components/layout/PullToRefresh.tsx`
  - `components/DeploymentVersionChecker.tsx`
- **Mitigation:**
  - detect dirty editing contexts and defer/warn where practical.
  - prioritise high-risk forms first.
- **Exit criteria:** no silent reload loss in covered high-risk flows.

## R4 - Inconsistent Mode Behavior Across Modules
- **Risk:** mode enabled in dashboard but incomplete behavior in other pages.
- **Impact:** medium-high.
- **Likelihood:** medium.
- **Mitigation:**
  - provider at dashboard shell.
  - explicit E2E cross-module continuity test.
- **Exit criteria:** toggle state is consistent across core module navigation.

## R5 - Touch Usability Still Poor After Mode On
- **Risk:** controls remain too small or dense despite mode.
- **Impact:** medium-high.
- **Likelihood:** medium.
- **Mitigation:**
  - apply tablet-specific wrappers and spacing in scoped modules.
  - manual real-device validation in portrait/landscape.
- **Exit criteria:** key workflows are practical touch-only.

## R6 - Feature Scope Drift
- **Risk:** adding auto-detection or broad refactors in phase 1.
- **Impact:** high.
- **Likelihood:** medium.
- **Mitigation:**
  - explicit non-goals and PR checklist gating.
  - reject any auto-switch logic.
- **Exit criteria:** no auto-enable path exists in code.

## Test Strategy

## A. Unit Tests

### A1 - Provider and Persistence
- verify default mode is off.
- verify explicit toggle on/off.
- verify per-user localStorage persistence (`tablet_mode:<user_id>`).
- verify no crash when storage unavailable.

### A2 - Mode-Gated Wrappers
- verify tablet classes apply only when mode is on.
- verify default desktop classes unchanged when mode is off.

## B. Integration / Component Tests

### B1 - Dialog Safety
- for high-risk dialogs:
  - dirty form + outside click does not close.
  - dirty form + escape does not close.
  - explicit discard path closes and resets as designed.

### B2 - Mode Gate Rendering
- shell applies `data-tablet-mode` correctly.
- module components react to gate as expected.

## C. Playwright / E2E Plan

## C1 - Manual Toggle Activation
- route: `/dashboard`
- steps:
  - verify default mode-off state.
  - click `Try Tablet Mode`.
  - verify mode-gate indicator and UI changes.

## C2 - Cross-Module Continuity
- after enabling mode on dashboard, navigate to:
  - `/workshop-tasks`
  - `/van-inspections`
  - `/plant-inspections`
  - `/hgv-inspections`
  - `/maintenance`
  - `/fleet`
- verify mode remains active and key controls are tablet-adjusted.

## C3 - Persistence on Refresh
- enable mode.
- hard refresh.
- verify mode still active.
- disable mode and refresh again.
- verify mode remains off.

## C4 - Mode-Off Desktop Parity
- for each touched module, validate:
  - layout/structure parity to baseline in mode-off.
  - no unexpected spacing/target changes.
  - no new console errors.

## C5 - Data-Loss Behavior
- in covered dialogs/forms:
  - dirty + outside click => no silent close.
  - dirty + route change => prompt/guard behavior.
  - dirty + refresh attempt => expected warning/defer behavior where implemented.

## D. Manual Device Test Matrix

## Devices
- Lenovo Tab K11 Plus 8G
- Smaller Android tablet
- Smaller iPad-class tablet

## Orientations
- portrait
- landscape

## Core Flows
- dashboard toggle on/off
- workshop task create/edit dialog usage
- van daily check workflow
- plant daily check workflow
- hgv daily check workflow
- maintenance and fleet navigation/actions

## Manual Assertions
- touch-only usage (no keyboard/mouse required)
- large enough tap targets
- reduced mis-taps in action rows
- no accidental modal dismiss data loss
- acceptable readability in bright workshop lighting

## Acceptance Gates Before Completion

## Gate 1 - Product Constraint
- No auto-switch logic present.
- Toggle is manual and user-triggered from dashboard.

## Gate 2 - Desktop Safety
- No global default primitive regressions.
- Mode-off parity suite passes on touched pages.

## Gate 3 - Tablet Usability
- Real-device tests pass for core workflows in portrait and landscape.

## Gate 4 - Data Safety
- High-risk dialog dismiss paths protected.
- No silent loss in covered flows from common accidental actions.

## Gate 5 - Regression Health
- Existing module smoke tests remain green:
  - `testsuite/ui/dashboard.spec.ts`
  - `testsuite/ui/workshop-tasks-comments.spec.ts`
  - `testsuite/ui/fleet-navigation.spec.ts`
  - `testsuite/ui/van-inspections.spec.ts`
  - `testsuite/ui/plant-inspections.spec.ts`
  - `testsuite/ui/hgv-inspections.spec.ts`
  - `testsuite/ui/responsiveness.spec.ts` (extended for mode matrix)

## Rollback Plan

- disable/remove tablet provider wiring from `components/layout/DashboardLayoutClient.tsx`.
- remove dashboard toggle action from `app/(dashboard)/dashboard/page.tsx`.
- remove module-scoped wrappers/usages.
- because shared primitive defaults are unchanged, rollback is low-risk and fast.
