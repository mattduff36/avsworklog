# Tablet Audit Defect Log (Before Fixes)

## Confirmed from baseline screenshots

1. **Sidebar appears above modal dark overlay**
   - Reproduced in:
     - `docs/audits/tablet-audit/before/tablet-before-manager-workshop-task-modal.png`
     - `docs/audits/tablet-audit/before/tablet-before-manager-workshop-create-task-dialog.png`
     - `docs/audits/tablet-audit/before/tablet-before-admin-workshop-task-modal.png`
   - Symptom: left sidebar/nav remains visually above the darkened modal backdrop.
   - Root cause: global dialog overlays/content forced to low z-index while sidebar/popovers are higher.

2. **Workshop pending-task action rows are cramped at tablet width**
   - Reproduced in:
     - `docs/audits/tablet-audit/before/tablet-before-manager-workshop-tasks-base.png`
   - Symptom: mixed button dimensions and early desktop layout split at `md` cause compressed action groups in pending/in-progress/on-hold/completed cards.

3. **Dialog footer/button pattern inconsistent under tablet mode**
   - Reproduced in workshop dialog states.
   - Symptom: action groups in dialog/card contexts do not always wrap predictably.

## Broader risk areas queued for fix pass

- Global modal layering policy affecting all pages using Radix dialog/popover/select.
- Shared dialog footer behavior used by multiple modals.
- High-density action cards in workshop module (all status sections + task modal).
