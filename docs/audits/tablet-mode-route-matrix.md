# Tablet Mode Route Matrix (794x1250)

## Target
- Viewport: `794x1250`
- Mode: tablet mode ON
- Roles: employee, manager, admin
- Environment: `http://localhost:4000`

## Shared checks (every route)
- Base layout: no clipped content, no horizontal overflow, no overlap with top nav.
- Sidebar/backdrop layering: modal overlay always above background navigation.
- Action controls: buttons align, wrap cleanly, maintain touch size.
- Tabs/filters: triggers remain readable, no crushed labels, no hidden primary actions.
- Dialog/drawer/popover state: close button and footer actions remain visible.

## Employee routes
- `/dashboard` (tile grid, compact nav behavior)
- `/timesheets` (list/table state, filter controls)
- `/timesheets/new` (form flow, sticky/bottom actions)
- `/timesheets/[id]` (detail read/edit state)
- `/van-inspections` (list/cards)
- `/van-inspections/new` (long form + fixed submit bar)
- `/van-inspections/[id]` (detail + actions)
- `/plant-inspections` (list/cards)
- `/plant-inspections/new` (long form + media/signature)
- `/plant-inspections/[id]` (detail + actions)
- `/hgv-inspections` (list/cards)
- `/hgv-inspections/new` (long form + fixed submit bar)
- `/hgv-inspections/[id]` (detail + actions)
- `/notifications` (list + read states)
- `/help` (tabs/faq accordion)

## Manager routes (in addition to employee)
- `/workshop-tasks` overview:
  - pending section expanded
  - in-progress section expanded
  - on-hold section expanded
  - completed section expanded
  - open task modal
  - open comments drawer
  - open create task dialog
- `/maintenance`:
  - overview tab
  - settings tab
  - table + card fallbacks
- `/fleet`:
  - primary tabs
  - dialogs in settings/category flows
- `/fleet/vans/[vanId]/history`
- `/fleet/plant/[plantId]/history`
- `/fleet/hgvs/[hgvId]/history`
- `/approvals` (tabbed/table views)
- `/actions` (pending cards + action buttons)
- `/toolbox-talks` (compose + recipient controls)
- `/projects` (list)
- `/projects/[id]` (details)
- `/projects/manage`
- `/projects/settings`
- `/absence` (calendar + request dialog)
- `/absence/manage`
- `/absence/archive-report`

## Admin-only checks
- `/dashboard` (admin role nav state)
- `/workshop-tasks` settings/admin dialogs
- `/fleet` category dialogs and admin actions
- `/projects/settings` elevated options visibility

## Dynamic route capture policy
- For routes containing `[id]`, use first available row/card link from the corresponding list page.
- If no data exists for a role, capture the empty-state screenshot and note route as blocked-by-data.

## Screenshot naming convention
- Before fixes: `tablet-before-<role>-<route-key>-<state>.png`
- After fixes: `tablet-after-<role>-<route-key>-<state>.png`
