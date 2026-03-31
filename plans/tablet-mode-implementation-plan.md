# Tablet Mode Implementation Plan (Manual Opt-In, Phase 1)

## 1. Executive Summary

Tablet Mode will be an explicit, user-triggered UI mode for workshop users that improves touch usability and reduces accidental data loss while preserving current desktop behavior by default. Phase 1 activation is only through a visible `Try Tablet Mode` button in the dashboard header (`app/(dashboard)/dashboard/page.tsx`). The highest-priority surfaces are `workshop-tasks`, all inspection flows (`van`, `plant`, `hgv`), `maintenance`, and `fleet`. Primary risks are desktop regressions from global UI changes and work loss from dismissible dialogs or reload paths.

## 2. Codebase Findings

### Dashboard Header and Toggle Location
- Dashboard welcome/header block is implemented directly in `app/(dashboard)/dashboard/page.tsx`.
- Shared shell composition is `app/(dashboard)/layout.tsx` -> `components/layout/DashboardLayoutClient.tsx` -> `components/layout/DashboardContent.tsx`.
- A secondary toggle location is possible in existing top-right controls in `components/layout/Navbar.tsx`.

### Layout State Storage Patterns
- Safe local persistence patterns already exist:
  - `lib/utils/recentVehicles.ts` (safe localStorage get/set wrappers).
  - `lib/utils/view-as-cookie.ts` (cookie + localStorage pattern).
- Existing app tab state is URL-driven in:
  - `app/(dashboard)/workshop-tasks/page.tsx`
  - `app/(dashboard)/maintenance/page.tsx`
  - `app/(dashboard)/fleet/page.tsx`

### Shared Components Most Likely to Need Tablet Variants
- Candidate touch-size bottlenecks:
  - `components/ui/button.tsx` (default height and icon sizing).
  - `components/ui/select.tsx` (compact trigger and items).
  - `components/ui/dropdown-menu.tsx` (compact menu rows).
- Input primitives already partly mobile-friendly:
  - `components/ui/input.tsx`
  - `components/ui/textarea.tsx`

### Modal Dismissal and Data-Loss Risk
- Base dialog behavior is dismissible unless overridden (`components/ui/dialog.tsx`).
- Good dirty-dismiss protections already exist in:
  - `app/(dashboard)/maintenance/components/EditMaintenanceDialog.tsx`
  - `app/(dashboard)/maintenance/components/EditPlantRecordDialog.tsx`
- Risky reset-on-close behavior exists in:
  - `app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs.tsx`

### Least Touch-Friendly Areas
- Dense workshop task dialogs: `app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs.tsx`.
- Dense maintenance and fleet controls/tables:
  - `app/(dashboard)/maintenance/components/MaintenanceTable.tsx`
  - `app/(dashboard)/fleet/page.tsx`
- Inspection new pages are better optimized (`h-12`, sticky mobile submit bars), but desktop/table density still appears in detail/edit routes.

### Dense Layout Dependencies
- Table-heavy experiences:
  - `app/(dashboard)/maintenance/components/MaintenanceTable.tsx`
  - `app/(dashboard)/van-inspections/[id]/page.tsx`
  - `app/(dashboard)/plant-inspections/[id]/page.tsx`
  - `app/(dashboard)/hgv-inspections/[id]/page.tsx`
- Existing reusable pattern: desktop table + card fallback (already used in maintenance).

### Existing Patterns to Reuse Safely
- Card-first mobile interaction from inspection pages:
  - `app/(dashboard)/van-inspections/new/page.tsx`
  - `app/(dashboard)/plant-inspections/new/page.tsx`
  - `app/(dashboard)/hgv-inspections/new/page.tsx`
- Existing sticky action bars in inspection forms.
- Existing dirty-close protection approach from maintenance dialogs.

## 3. Recommended Architecture

### Source of Truth
- Add a client-side Tablet Mode provider at shell level in `components/layout/DashboardLayoutClient.tsx`.
- Expose hook API:
  - `tabletModeEnabled`
  - `enableTabletMode()`
  - `disableTabletMode()`
  - `toggleTabletMode()`

### Persistence
- Persist per user, per browser via localStorage key: `tablet_mode:<user_id>`.
- Persist across refresh and navigation.
- No backend schema changes in phase 1.

### Application Strategy
- Set one shell gate attribute: `data-tablet-mode="on"` when enabled.
- Tablet styles/variants are additive and mode-gated only.
- Desktop mode remains unchanged by default.

### Safest Variant Pattern
- Use module-scoped wrappers (for example `TabletAwareButton`, `TabletAwareSelectTrigger`) or module-level conditional classes.
- Do not modify shared primitive defaults in phase 1.
- Keep rollback easy: remove provider + wrappers and desktop remains intact.

### Explicit Desktop Regression Guardrails
- Do not change defaults in:
  - `components/ui/button.tsx`
  - `components/ui/select.tsx`
  - `components/ui/dropdown-menu.tsx`
  - `components/ui/dialog.tsx`
- Do not alter baseline shell geometry in:
  - `components/layout/DashboardContent.tsx`
  - `components/layout/Navbar.tsx`

## 4. UX Plan for Tablet Mode

### Global Rules (mode on only)
- Minimum primary target sizes around 44px.
- Increase spacing in toolbars and action rows.
- Reduce icon-only actions in critical task flows.
- Keep desktop layout untouched when mode is off.

### Dashboard
- Add right-aligned `Try Tablet Mode` in `app/(dashboard)/dashboard/page.tsx`.
- Show explicit `Exit Tablet Mode` while mode is enabled.

### Workshop Tasks
- Convert task create/edit dialogs to touch-friendly, larger layout in:
  - `app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs.tsx`
- Add sticky action section and larger select/checkbox targets.

### Inspections
- Reuse card-first interaction pattern from existing new pages.
- In tablet mode, prefer card layout where desktop tables are hard to use.
- Preserve existing sticky footer submit actions on tablet.

### Maintenance and Fleet
- Emphasize card/expanded row actions in tablet mode:
  - `app/(dashboard)/maintenance/components/MaintenanceTable.tsx`
  - `app/(dashboard)/fleet/page.tsx`
- Increase top-bar control tap targets (search/filter/sort actions).

### Inputs/Selectors
- Prefer larger select triggers/items and simple pickers.
- Keep date/time entry native where already used, with larger control sizing.

### Orientation
- Support portrait and landscape with mode-gated layout rules.
- No orientation-based auto mode switching.

## 5. Data Safety / No-Loss-of-Work Plan

### Risks Identified
- Default dialogs can close via outside click/Escape.
- No broad route-change unsaved-work guard pattern currently applied.
- Hard reload mechanisms can interrupt in-progress work:
  - `components/layout/PullToRefresh.tsx`
  - `components/DeploymentVersionChecker.tsx`

### Safeguards
1. **Dialog close protection standard**
   - Reuse maintenance dirty-guard pattern.
   - Apply first to workshop/fleet high-risk dialogs.
2. **Unsaved-change navigation prompt**
   - Add shared guard hook for high-risk forms.
   - Use project-standard dialog prompts instead of `window.confirm` where possible.
3. **Targeted draft/recovery**
   - Extend draft-safe behavior only where architecture already supports it cleanly.
   - Avoid broad autosave in phase 1.
4. **Reload-sensitive handling**
   - Defer/guard reload interactions when high-risk forms are dirty (where feasible).

## 6. Phased Delivery Plan

### Phase 0: Audit and Scaffolding
- Goal: shell provider + mode gate with no UI behavior change.
- Likely files: `components/layout/DashboardLayoutClient.tsx`, new provider/hook files.
- Risk: style leak.
- Acceptance: mode off = current desktop behavior.

### Phase 1: Manual Toggle and Shell Wiring
- Goal: dashboard toggle + persistence + explicit off state.
- Likely files:
  - `app/(dashboard)/dashboard/page.tsx`
  - `components/layout/DashboardLayoutClient.tsx`
  - optional `components/layout/Navbar.tsx`
- Risk: header layout shift.
- Acceptance: manual toggle works, persists, desktop unchanged.

### Phase 2: Shared Tablet Wrappers (Scoped)
- Goal: touch-size variants via wrappers and module-local classes.
- Likely files: new wrapper components + touched modules only.
- Risk: accidental global default edits.
- Acceptance: mode-on UX improves, mode-off parity holds.

### Phase 3: Workshop Tasks and Inspections
- Goal: touch-friendly form/dialog improvements + modal safety.
- Likely files:
  - `app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs.tsx`
  - `app/(dashboard)/van-inspections/new/page.tsx`
  - `app/(dashboard)/plant-inspections/new/page.tsx`
  - `app/(dashboard)/hgv-inspections/new/page.tsx`
- Risk: validation/status regressions.
- Acceptance: touch-only flow is practical and no accidental dismiss data loss in targeted dialogs.

### Phase 4: Maintenance and Fleet
- Goal: reduce dense-table friction in tablet mode.
- Likely files:
  - `app/(dashboard)/maintenance/components/MaintenanceTable.tsx`
  - `app/(dashboard)/maintenance/page.tsx`
  - `app/(dashboard)/fleet/page.tsx`
- Risk: information density tradeoff.
- Acceptance: key tasks remain fast with touch-only usage.

### Phase 5: Draft Protection and Recovery
- Goal: consistent unsaved-work safety in highest-risk flows.
- Risk: over-prompting.
- Acceptance: no silent losses from close/navigation/reload in covered flows.

### Phase 6: Testing and Hardening
- Goal: mode-on/off confidence and desktop parity.
- Likely files: `testsuite/ui/*`, targeted unit tests in `tests/unit/*`.
- Acceptance: stable pass for toggle, persistence, and regression checks.

## 7. Detailed Implementation Checklist

### Dashboard Toggle
- Add `Try Tablet Mode` action to dashboard header.
- Add `Exit Tablet Mode` action.
- Keep existing desktop visual hierarchy unchanged when mode off.

### State Management
- Add tablet mode provider and hook.
- Add per-user localStorage persistence.
- Add shell-level mode gate attribute.

### Shared Layout Primitives
- Add mode-gated wrapper variants.
- Avoid global primitive default edits.

### Modal Safety
- Implement and apply dirty-dismiss guard pattern to high-risk dialogs.

### Forms and Inputs
- Increase target sizes and spacing for mode-on only.
- Preserve existing validation and API behavior.

### Dropdowns/Selectors
- Increase trigger/item tap area in mode-on.
- Reduce precision-only controls in core flows.

### Inspections
- Keep current logic, improve interaction density only.
- Prioritise card-first usability in mode-on.

### Workshop Tasks
- Improve create/edit dialog touch behavior.
- Add unsaved close protection.

### Maintenance
- Improve card-first action flow in mode-on.
- Increase control/action hit areas.

### Fleet
- Apply same touch-density strategy in mode-on.
- Protect settings/category dialogs from accidental dismiss.

### Testing
- Add state/persistence unit tests.
- Extend E2E for mode-on/off matrix and persistence.
- Add explicit mode-off desktop parity checks on touched pages.

### Docs
- Generate:
  - `plans/tablet-mode-implementation-plan.md`
  - `plans/tablet-mode-checklist.md`
  - `plans/tablet-mode-risk-and-test-plan.md`

## 8. Testing Strategy

### Unit Tests
- Provider behavior: default false, toggle, persistence by user key.
- Wrapper behavior: tablet classes only in mode-on.

### Playwright / E2E
- Toggle from dashboard and verify mode gate is active.
- Navigate across core modules with mode retained.
- Reload and verify persistence.
- Verify mode-off desktop parity on all touched pages.

### Manual Device Test Cases
- Devices: Lenovo Tab K11 Plus, smaller Android tablet, smaller iPad class.
- Portrait and landscape on all critical modules.
- Touch-only interactions with no keyboard/mouse.
- Confirm no accidental data loss from modal dismiss, route change, refresh/reload.

## 9. Explicit Non-Goals (Phase 1)

- No automatic switching (screen size, UA, touch, pointer, orientation).
- No broad desktop redesign of unrelated pages.
- No global rewrite of shared primitive defaults.
- No high-risk architecture churn beyond scoped mode provider and wrappers.
- No broad autosave implementation across all forms.

## 10. Final Recommendation

- Implement manual Tablet Mode using shell-gated mode state + module-scoped wrappers.
- Safest first build step: dashboard toggle + provider/persistence only.
- First 5 component areas to tackle:
  1. `app/(dashboard)/dashboard/page.tsx`
  2. `components/layout/DashboardLayoutClient.tsx`
  3. `app/(dashboard)/workshop-tasks/components/WorkshopTaskFormDialogs.tsx`
  4. `app/(dashboard)/maintenance/components/MaintenanceTable.tsx`
  5. `app/(dashboard)/fleet/page.tsx`
