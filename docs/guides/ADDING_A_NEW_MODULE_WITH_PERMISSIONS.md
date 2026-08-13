# Adding a New Module With Permissions

Use this checklist for every product module that appears in the permission matrix. A module is not complete when its page is visible: the shared metadata, effective access levels, APIs, database policies, operational tools, and tests must all agree.

## 1. Define the access contract first

Write down the module slug and every user surface before writing code.

- Use one lowercase, hyphenated `ModuleName`, for example `daily-allocation`.
- Use that exact slug in TypeScript, `permission_modules.module_name`, team/user permissions, route gates, audit metadata, and release descriptors.
- Use an underscore only where an existing external schema requires it, such as the `daily_allocation` notification preference key.
- Assign the minimum level for each surface:
  - Level 0: no access.
  - Level 1: Contractor.
  - Level 2: Employee.
  - Level 3: Supervisor.
  - Level 4: Manager.
  - Level 5: Admin.
- Decide whether the module is `team` access or the exceptional `universal` access mode.
- Decide whether it requires a full-access role or a sensitive PIN.
- Document self-service and management surfaces separately. One enabled module can have different thresholds; Daily Allocation uses Level 2 for `/daily-allocation/my` and Level 4 for its board and job sheets.

Admin and super-admin access resolves to Level 5. Do not add ad-hoc role-name bypasses to pages or APIs. View As must use the effective role/team snapshot and must not silently regain the actual administrator's Level 5 access.

## 2. Register the TypeScript metadata

Update `types/roles.ts` in one change:

- Add the slug to `ModuleName`.
- Add it exactly once to `STANDARD_MODULES` or `MANAGEMENT_MODULES`.
- Add it to `ALL_MODULES`.
- Add display, short-name, description, and CSS-variable entries.
- Add it to `SensitiveAccessModuleName` only through the existing `ModuleName` union unless it is a non-matrix sensitive surface such as Debug.

The generic module-registration contract checks these collections for drift. A TypeScript `Record<ModuleName, ...>` catches omissions at compile time, while the runtime test catches duplicates, category overlap, and permission-guide omissions.

## 3. Add the permission-module migration

Permission metadata is persistent state, so follow `docs/guides/MIGRATIONS_GUIDE.md`, `docs/guides/HOW_TO_RUN_MIGRATIONS.md`, and `.cursor/rules/database-migrations.mdc`.

- Inspect the live/local schema before writing SQL.
- Insert or upsert `permission_modules` with:
  - `module_name`
  - `minimum_role_id`
  - `requires_sensitive_pin`
  - `access_mode`
  - `sort_order`
- `enforced_minimum_access_level` and `requires_full_access_role` are derived rules, not `permission_modules` columns. If the module needs a hard minimum or a full-role-only rule, update and test `module_enforced_minimum_access_level(module_name)` or `module_requires_full_access_role(module_name)` in the migration.
- Create team defaults deliberately. Do not enable every team as a side effect unless the approved rollout explicitly requires it.
- Preserve text team IDs. `org_teams.id`, `profiles.team_id`, and `team_module_permissions.team_id` are text. Profile IDs and `user_module_permissions.user_id` are UUIDs.
- Put compatible schema additions in predeploy migrations. Put enforcement that depends on deployed application code in postdeploy migrations.
- Make migrations idempotent where practical and add a migration-ledger entry when required by the migration runner.
- Capture a before-image before changing existing permission rows when rollback must restore exact values.
- Provide a rollback that disables or restores permissions safely; avoid destructive table drops for normal module rollback.

Never assign production users or teams automatically unless that assignment is explicitly approved. A module can be deployed with zero positive non-admin grants and enabled manually after verification.

## 4. Implement effective access consistently

The effective permission is calculated from the role, team default, module minimum, and optional user override.

- Use `getEffectiveModuleAccessLevel` and `canEffectiveRoleUseModuleLevel` in server code.
- Use `usePermissionSnapshot`, `usePermissionCheck`, and `useModuleAccessLevel` in client code.
- Use the optional `minimumAccessLevel` on navigation items when a link requires more than basic module access.
- Keep modules without an explicit navigation threshold backward compatible: enabled module access is sufficient.
- Fail closed while the permission snapshot is loading.
- Do not trust a payload field such as `is_manager` as a client bypass for a known level requirement.

Client checks improve navigation and user experience. They are not security boundaries.

## 5. Wire every user-facing registry

Check all applicable surfaces:

- `lib/config/navigation.ts` for employee, manager, and admin links with correct thresholds.
- `components/layout/Navbar.tsx` and `components/layout/SidebarNav.tsx` through the shared filtering functions.
- `app/(dashboard)/dashboard/page.tsx` for management tiles.
- `lib/config/forms.ts` for dashboard quick actions or self-service forms.
- `lib/config/module-pages.ts` for error-reporting page classification.
- `lib/theme/getAccentFromRoute.ts`, `lib/utils/module-brand-presentation.ts`, and `app/globals.css` for route accents, brand surfaces, and CSS variables.
- `types/notifications.ts` for module-bound notification preferences. Evaluate the permission-level rule even when the category is otherwise available to all roles.
- `lib/config/release-module-descriptors.ts` for route, API, text, and commit-scope classification.
- `scripts/audit-permissions.ts`; it must consume canonical `ALL_MODULES` and audit the current team/user level model, not the retired role-permission model.
- `lib/config/permissions-secondary-audit.json` for the Admin Settings permission guide. Describe actual role behavior and rollout defaults rather than intended future grants.

## 6. Gate pages before data fetching

Each page must check the level needed by that surface before issuing its first request.

- Self-service pages normally use their employee/supervisor threshold.
- Management boards, cross-user views, and exports normally use Level 4 or the explicitly approved threshold.
- Admin configuration normally uses Level 5 and may also require the sensitive PIN helper.
- Show a clear access message for a user who has the module but lacks the surface level.
- Keep loading and denied states distinct so denied users do not see an endless loading shell.

## 7. Enforce APIs and database access

Every route and mutation needs server authorization before reading or writing protected data.

- Authenticate first.
- Resolve the effective role/team, including View As behavior where supported.
- Require the exact module level for the operation.
- Scope reads and writes to the effective user/team/reporting-line boundary.
- Validate requested user and team IDs with their real database types.
- Return 401 for unauthenticated, 403 for unauthorized, and a safe 500 for unexpected database failures.
- Return 501 only for positively identified missing permission relations or columns. PostgreSQL operator/type errors such as `42883` are application/database bugs, not an unconfigured matrix.
- Log detailed server errors, but do not expose raw SQL or database messages to clients.

RLS and security-definer functions remain authoritative if a client or route check is bypassed. Add policies/functions using effective permission helpers, lock their `search_path`, grant execution narrowly, and add contract tests for policy ordering and scope.

## 8. Test the complete contract

At minimum, add:

- Registration tests proving `ALL_MODULES` aligns with display, short-name, description, color, category, and secondary-audit metadata.
- Navigation tests for Level 0, the self-service threshold, the management threshold, admin bypass, View As/effective snapshots, and dropdown children.
- Page/component tests proving denied levels make no request.
- API tests for unauthenticated, insufficient, sufficient, and admin access.
- RLS/migration contract tests for helper definitions, grants, policies, rollout ordering, and rollback.
- Notification tests at one level below and at the required level.
- Release-descriptor path and commit-scope tests.
- Audit-script tests proving canonical module usage and current matrix tables.
- Transaction tests with non-UUID team IDs, UUID user IDs, commit/audit behavior, and rollback after a later failure.

Use mocks or isolated fixtures for Level 0/2/4 scenarios. Do not create production grants to make E2E tests pass.

## 9. Roll out and verify

1. Run targeted unit, component, API, migration-contract, typecheck, and lint checks.
2. Do not run a production build unless it is separately authorized.
3. Apply predeploy migrations through the approved migration workflow.
4. Deploy compatible code.
5. Apply postdeploy enforcement only after its prerequisites pass.
6. Verify the module metadata and zero/expected grants with read-only queries.
7. Assign approved teams/users manually when the rollout calls for manual activation.
8. Test as the effective Level 0, self-service, management, and admin personas.
9. Run `scripts/audit-permissions.ts` and review orphan/invalid rows.
10. Confirm rollback instructions before announcing completion.

## Pull-request checklist

- [ ] Access contract and thresholds are written down.
- [ ] `types/roles.ts` metadata is complete and unique.
- [ ] Permission migration, ordering, before-image, and rollback are reviewed.
- [ ] Navigation, dashboard/forms, module pages, theme, notifications, release descriptor, audit tool, and permission guide are wired.
- [ ] Pages gate before fetching.
- [ ] APIs and RLS enforce the same thresholds.
- [ ] View As uses effective permissions.
- [ ] Error classification does not hide operator/type failures as missing schema.
- [ ] Registration, level, API, RLS, notification, release, audit, transaction, and rollback tests pass.
- [ ] Production activation and rollback owners are named.
