# Architecture (current)

This describes the live Squires system, not an idealised Next.js app. Inspect the module you are changing before introducing a new pattern.

## Stack

- Next.js 15 App Router, React 19, TypeScript (strict)
- Tailwind CSS 4 + shadcn/Radix primitives in `components/ui/`
- Supabase Postgres + Storage + Realtime; **custom application sessions**, not browser Supabase Auth as the session
- TanStack Query where a module already uses it
- Zod for many API/input schemas (`lib/validation/schemas.ts` and local route schemas)
- PWA (`manifest.json`, service worker, standalone safe-area)
- Vitest + Playwright testsuite; Vercel production from `main`

Zustand is not used. `nuqs` is page-local, not a global provider.

## Repository map

| Area | Role |
| --- | --- |
| `app/(auth)/` | Login, change-password; no dashboard chrome |
| `app/(dashboard)/` | Authenticated product UI |
| `app/api/` | Route handlers (auth, CRUD, reports, cron) |
| `components/layout/` | Shell: navbar, sidebar, page shell, PWA, tablet |
| `components/ui/` | Shared primitives |
| `lib/app-auth/`, `lib/server/app-auth/` | Browser and server session |
| `lib/supabase/` | Browser, server, admin, middleware clients |
| `lib/server/` | Domain authorization and privileged logic |
| `lib/client/` | Browser helpers that call APIs |
| `lib/hooks/` | Auth, permissions, module data, realtime |
| `lib/config/` | Navigation, layout, permission hard rules |
| `types/` | Roles, domain types, `types/database.ts` |
| `supabase/migrations/` | Forward-only SQL (300+ files) |
| `scripts/` | Migration runners, finalise, workflow, db:validate |
| `tests/`, `testsuite/` | Vitest/unit/integration and Playwright smoke |

`types/database.ts` is the generated `Database` type. `types/database.generated.ts` is currently an empty stub — do not treat it as the live schema.

## Runtime composition

`app/layout.tsx` is `force-dynamic`, loads Inter, and wraps children in `AppProviders`.

`lib/providers/app-providers.tsx` order:

1. `PwaShellBridge`
2. `ErrorLoggerInit` (client-only)
3. `DeploymentVersionChecker` (client-only)
4. `QueryProvider` (TanStack Query; 60s staleTime; auth-error recovery)
5. `AuthProvider`
6. page tree
7. `DatabaseOutageBlocker`
8. Sonner `Toaster`
9. Vercel `Analytics` only when `NODE_ENV === 'production'` and `VERCEL === '1'`

There is no root `NuqsAdapter`. Pages that use `nuqs` wrap themselves in `NuqsClientAdapter`.

`app/(dashboard)/layout.tsx` renders `DashboardLayoutClient`:

- `TabletModeProvider` + `DashboardTaskBadgeProvider`
- `data-accent` from `getAccentFromRoute`
- `MessageBlockingCheck` (password change → toolbox talks → reminders)
- `Navbar`, `PullToRefresh`, `DashboardContent`, `MobileNavBar` (currently a no-op)
- Tablet-mode info dialog

Root `middleware.ts` delegates to `lib/supabase/middleware.ts` `updateSession`.

## Auth and session

Do not document this as “Supabase Auth handles authentication.”

The browser session is an **httpOnly app-session cookie**:

- Name: `avs_app_session` locally, `__Host-avs_app_session` in production
- Issued by `issueAppSession` in `lib/server/app-auth/session.ts`
- Sources: `password_login`, `session_bootstrap`, `biometric_login`, `kiosk_device`
- Idle / absolute lifetimes and rotation: `lib/server/app-auth/constants.ts` (24h/72h, or 30/90 days if remember-me)
- Cookie payload is a signed JWT (`sid`, `secret`, `exp`, `v`) verified in middleware; the server hashes the secret and compares it to `app_auth_sessions`
- Idle rotation uses `APP_SESSION_ROTATE_AFTER_MINUTES` (60) and `APP_SESSION_ROTATE_BEFORE_IDLE_EXPIRY_MINUTES` (6h) in `lib/server/app-auth/constants.ts`, with compare-and-set on secret rotation

Login, logout, bootstrap, session, data-token, and WebAuthn live under `app/api/auth/`.

For PostgREST/Realtime, the server mints a **short-lived Supabase data token** (`issueSupabaseDataToken`, 1 hour, `role: authenticated`, empty `user_metadata`, `amr.method: app_session`). Browser clients fetch it from `/api/auth/data-token` and pass it as `accessToken`. `auth.autoRefreshToken` and `persistSession` are off.

`createClient()` on the server (`lib/supabase/server.ts`) uses the data token when an app session is valid; otherwise it falls back to `@supabase/ssr` cookie client. `getCurrentAuthenticatedProfile` likewise prefers the app session and **can fall back** to `supabase.auth.getUser()`. Middleware treats the app-session cookie as the only accepted browser auth and clears leftover `sb-*-auth-token` cookies.

Kiosk devices use `session_source: 'kiosk_device'` and are invalid when the kiosk row is revoked.

## Permissions

Four layers — do not collapse them:

1. **Navigation / UI visibility** — `lib/config/navigation.ts` filtered by `getFilteredEmployeeNav` / `getFilteredNavByPermissions`. Optional `minimumAccessLevel` on a link.
2. **Client UX checks** — `usePermissionSnapshot` (`/api/me/permissions`), `usePermissionCheck`, `useModuleAccessLevel`. Admins/superadmins short-circuit to full access in the client snapshot. These redirect or hide UI. They are not a security boundary.
3. **Server authorization** — `getEffectiveRole` (`lib/utils/view-as.ts`) then `getEffectiveModuleAccessLevel` / `canEffectiveRoleUseModuleLevel` (`lib/utils/rbac.ts`) and module helpers (`lib/server/inventory-auth.ts`, `lib/server/daily-allocation/auth.ts`, `lib/server/fleet-maintenance-auth.ts`, …).
4. **RLS** — Postgres policies on `authenticated` (data-token) and, where used, SECURITY DEFINER RPCs. Service role bypasses RLS.

Access is a **0–5 level** per module (`types/roles.ts`), derived from role, team default, module minimum, and optional user override (`lib/server/team-permissions.ts`, `lib/config/permission-access-rules.ts`). Hard minima include approvals ≥ 3, toolbox-talks ≥ 4, admin-settings ≥ 5. Reminders default to `universal` access mode.

View As: cookies `avs_view_as_role_id` / `avs_view_as_team_id`, forwarded as `x-view-as-role-id` / `x-view-as-team-id`. Only an actual super admin may override. While viewing as, user permission overrides are **not** applied (`includeUserOverrides: false`). Effective access must not snap back to the actor’s real Level 5.

New modules: follow `docs/guides/ADDING_A_NEW_MODULE_WITH_PERMISSIONS.md` end-to-end (TypeScript unions, migration, nav, accent, RLS, tests).

## Supabase trust levels

| Client | Trust |
| --- | --- |
| Browser `lib/supabase/client.ts` | User-equivalent. RLS applies. Never a privilege boundary. |
| Server `lib/supabase/server.ts` | Same user data token (or SSR fallback). Still RLS-bound. |
| Admin `lib/supabase/admin.ts` | Service role. **Bypasses RLS.** Server-only, after an explicit authz check. |

`createAdminClient` is widely used for session rows, permission matrices, and privileged writes. That does not make the caller an admin. Check `getEffectiveRole` first.

## API and data boundaries

Preferred direction for **new** privileged or multi-user writes: `app/api/*` → `lib/server/*` → admin or RLS-safe server client, with Zod validation and an explicit `require*` helper.

Current reality is mixed:

- Many pages call `createClient()` in the browser and query tables directly (timesheets, some fleet/maintenance).
- Newer/heavier modules call `fetch('/api/...')` via `lib/client/*` (daily allocation, work shifts, user directory).
- TanStack Query wraps some of those paths (`useAbsence`, `useMaintenance`, `useProjectsManage`, `usePermissionSnapshot`, daily-allocation board).
- Realtime: `lib/hooks/useRealtime.ts` and module-specific invalidation (timesheets, absence).
- URL state: mixed `nuqs` and `useSearchParams`.
- Local state: the default for dialogs and filters.

Follow the module. Do not migrate a page to React Query “because the standards doc said so.”

API input validation is inconsistent: some routes use shared Zod schemas, some inline Zod, some ad-hoc checks. New routes should validate with Zod and fail closed.

## State management

There is no single client store. Auth lives in `AuthProvider`. Permissions live in a React Query snapshot. Module lists are a mix of Query, `useEffect`+`fetch`, and browser Supabase. Do not add Zustand or a global reducer.

## Database, migrations, RLS

- SQL is forward-only under `supabase/migrations/`. **Never edit a shipped migration.** Add a new dated file.
- Runners are `scripts/run-*-migration.ts` using `pg` and `POSTGRES_URL_NON_POOLING` (see `.cursor/rules/database-migrations.mdc` and `docs/guides/HOW_TO_RUN_MIGRATIONS.md`).
- After rename/drop of columns or tables, run `npm run db:validate` (trigger-body vs live columns).
- Recent domains (Daily Allocation v2) enable RLS per table and add `SELECT` policies plus RPC grants. High-invariance writes go through transactional RPCs with locks and authorization inside the database.
- Local DB tests: PGlite for selected DB-backed unit/runtime tests; disposable Docker Postgres via `npm run test:db:local*` (`docs/guides/LOCAL_DATABASE_TESTING.md`). That is not a full local Supabase stack.

## Modules and special surfaces

Employee/operational: timesheets, van/plant/HGV inspections, projects/RAMS, absence, reminders, inventory, daily allocation (employee `/my`).

Management: approvals, actions, reports, workshop-tasks, maintenance, fleet (`admin-vans`), quotes, customers, toolbox talks, training, suggestions, FAQ, errors, admin users/settings.

Special device/PWA surfaces (own auth or chrome constraints):

- Inventory yard kiosk (`app/(dashboard)/inventory/kiosk-control`, `lib/server/inventory-kiosk.ts`, kiosk device sessions)
- Display board (legacy TV path in middleware; device commands via realtime)
- Inspection/photo capture and `app/(dashboard)/pdf-viewer`
- WebAuthn / biometric login (`app/api/auth/webauthn/*`)

Daily Allocation has stronger product/transaction invariants than a normal CRUD module. Read `PRODUCT.md`. Management is Level 4+; employee issued view is Level 2. Mutations belong on transactional RPCs, not ad-hoc table writes.

Representative server entry points: `app/api/me/permissions`, `app/api/auth/session`, `app/api/auth/data-token`, `app/api/daily-allocation/*`, `app/api/inventory/*`, `app/api/quotes/*`. Cron/scheduled routes stay on the allowlist in `lib/supabase/middleware.ts` and require `CRON_SECRET`.

## Code placement

| New work | Put it here |
| --- | --- |
| Module slug and display metadata | `types/roles.ts` |
| Hard minimum levels / access modes | `lib/config/permission-access-rules.ts` |
| Nav links and level thresholds | `lib/config/navigation.ts` |
| Server permission math | `lib/server/team-permissions.ts` |
| Route-level authz | `lib/utils/rbac.ts`, module `lib/server/*-auth.ts` |
| API handlers | `app/api/<domain>/.../route.ts` |
| Dashboard UI | `app/(dashboard)/<module>/` with colocated `components/` |
| Shared chrome | `components/layout/` or `components/ui/` |
| Shared client hooks | `lib/hooks/` |
| Browser API wrappers | `lib/client/` |
| Browser DB access | `lib/supabase/client.ts` only (singleton + data token) |
| Server DB access | `lib/supabase/server.ts` |
| Elevated DB (bypass RLS) | `lib/supabase/admin.ts` — server-only, after authz |
| App session / tokens | `lib/server/app-auth/**`, `lib/app-auth/**` (client) |
| RLS / schema | new file in `supabase/migrations/` plus a runner in `scripts/` |
| Contract tests | `tests/unit/*`, `tests/integration/api/*`, `testsuite/` |
| Module checklist | `docs/guides/ADDING_A_NEW_MODULE_WITH_PERMISSIONS.md` |

Keep functions typed and focused. File length alone is not a reason to refactor.

## Anti-patterns

- Treating Supabase Auth cookies as the current browser session.
- Authorizing from `user_metadata`, JWT claims other than `sub`, or a client `is_manager` flag.
- Using the admin client in a browser bundle.
- Adding a new module without the permission-registration checklist.
- Dual-writing Daily Allocation v1 and v2, or inferring end times onto historical untimed rows.
- Editing old migrations or skipping `db:validate` after a rename/drop.
- Introducing a second page-shell or provider stack.
- “Use React Query / RSC / nuqs everywhere” as a repo-wide rewrite.
