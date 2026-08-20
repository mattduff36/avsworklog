# Security and data (current)

Short rules for high-risk Squires work. Read this before changing auth, permissions, APIs, Supabase, RLS, storage, payroll/quotes money, or production data. Inspect the cited files; do not invent controls that are not there.

TEE treats this category as CRITICAL. Load `.cursor/rules/database-migrations.mdc` before schema/SQL/RLS/backfill work.

## Session and auth

Browser identity is the **app-session cookie**, not a Supabase Auth session.

- Cookie: `avs_app_session` / `__Host-avs_app_session` — `lib/server/app-auth/constants.ts`, `lib/server/app-auth/cookies.ts`
- Issue / validate / rotate / revoke: `lib/server/app-auth/session.ts`
- Middleware gate: `lib/supabase/middleware.ts` (via root `middleware.ts`)
- Login, logout, bootstrap, session, data-token, WebAuthn: `app/api/auth/*`

Middleware rejects unauthenticated non-public routes, clears legacy `sb-*-auth-token` cookies, and allows cron routes only with `Authorization: Bearer $CRON_SECRET`.

PostgREST calls use a server-minted **data token** (`lib/server/app-auth/supabase-token.ts`): `role=authenticated`, empty `user_metadata`, 1 hour TTL. Browser `lib/supabase/client.ts` fetches `/api/auth/data-token`.

`getCurrentAuthenticatedProfile` prefers the app session and can fall back to `supabase.auth.getUser()`. Do not add new features that depend on that fallback. Do not persist Supabase Auth cookies as a second session.

Kiosk sessions (`session_source: 'kiosk_device'`) die when the kiosk device is revoked.

Session signing currently falls back to `SUPABASE_SERVICE_ROLE_KEY` if `APP_SESSION_SECRET` is unset (`getAppSessionSigningSecret`). That is live fallback behaviour, not a pattern to copy. New work should assume `APP_SESSION_SECRET` is required.

## Sensitive PIN

Some modules (`requires_sensitive_pin` on the permission matrix) also require a PIN wall. Client gate: `components/security/SensitiveModuleGate.tsx`. Server gate: `requireSensitiveModuleAccess` in `lib/server/sensitive-module-access.ts` (HTTP 428 when locked). PIN hashing, unlocks, and lockouts live in `lib/server/sensitive-pin.ts`. Never log PIN values, verification codes, or `sensitive_pin_unlocks` rows.

## Server authorization is mandatory

UI hooks (`usePermissionCheck`, `useModuleAccessLevel`, nav filters) are UX. Every protected API route or privileged server action that accesses user/operational data must call a server helper, typically:

- `getEffectiveRole()` — `lib/utils/view-as.ts`
- `getEffectiveModuleAccessLevel` / `canEffectiveRoleUseModuleLevel` — `lib/utils/rbac.ts`
- module `require*` helpers — `lib/server/*-auth.ts`, `lib/server/sensitive-module-access.ts`

Fail closed: missing user → 401; missing level → 403. Public auth endpoints and separately authenticated cron routes remain the documented exceptions.

## Permissions are not user-editable metadata

Effective access is computed from role, team defaults, module minima, and optional user overrides (`lib/server/team-permissions.ts`, `lib/config/permission-access-rules.ts`, `types/roles.ts`).

Do **not** treat as permission truth:

- JWT `user_metadata` / `app_metadata` (data tokens send empty `user_metadata`)
- client-supplied `is_manager`, `role`, or `access_level` fields
- profile columns the user can edit

Register new modules with `docs/guides/ADDING_A_NEW_MODULE_WITH_PERMISSIONS.md`.

## View As

Super-admin only. Cookies `avs_view_as_role_id` and `avs_view_as_team_id` become `x-view-as-*` headers on Supabase fetches.

While viewing as:

- use the **effective** role and team
- do not apply the actor’s personal user-override grants
- do not restore Level 5 because the actor is “really” an admin

`getEffectiveRole` currently also treats a specific hardcoded email as actual super admin. That is live behaviour, not a pattern to copy. Do not add more email allowlists.

## Supabase trust

| Client | File | Rule |
| --- | --- | --- |
| Browser | `lib/supabase/client.ts` | User data token. RLS applies. Never a security boundary. |
| Server user | `lib/supabase/server.ts` | Same. Still RLS-bound. |
| Admin | `lib/supabase/admin.ts` | Service role. Bypasses RLS. Server-only, after authz. |

Never import the admin client into client components. Never send `SUPABASE_SERVICE_ROLE_KEY`, `APP_SESSION_SECRET`, `SUPABASE_JWT_SECRET`, or `POSTGRES_URL*` to the browser.

## RLS

New tables enable RLS in the same migration as the table. Policies must match the product access model (team vs universal, level minima). Daily Allocation and other high-invariance writes use SECURITY DEFINER RPCs with grants — do not bypass them with direct table writes from the browser.

RLS is necessary and not sufficient. Application authorization still runs first.

Do not edit historical migrations to “fix” a policy. Add a new forward migration.

## Service role

Use `createAdminClient()` only for operations that cannot succeed under RLS (session rows, permission matrix, selected privileged writes, some storage deletes). Every call site must already know who the actor is and that they are allowed.

Scripts that use the service role are production-capable. Treat them as CRITICAL.

## Secrets and `.env.local`

Assume `.env.local` exists. Never print it. Never paste connection strings, cookies, or keys into docs, chats, or tickets.

Names you may mention without values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `APP_SESSION_SECRET`, `APP_SESSION_HASH_SECRET`, `POSTGRES_URL_NON_POOLING`, `CRON_SECRET`.

Public keys (`NEXT_PUBLIC_*`) are still not an excuse to log them in full.

## API input validation

Validate body, query, and path IDs. Prefer Zod (`lib/validation/schemas.ts` or a local schema). Reject unknown fields where money, identity, or permission changes are involved.

Do not trust the client for user id, role, team, or access level. Take those from the session / `getEffectiveRole`.

## Migrations and production data

- Forward-only files in `supabase/migrations/`.
- Approved runner: `pg` + `POSTGRES_URL_NON_POOLING` (see `.cursor/rules/database-migrations.mdc`).
- No production schema or data change without explicit user permission and CRITICAL gates.
- `npm run db:validate` after rename/drop.
- Local DB tests stay on loopback disposable instances (`docs/guides/LOCAL_DATABASE_TESTING.md`). Never point them at production.

`fixerrors` and generic finalise repair must not auto-run database cleanup.

## Financial data

Quotes, invoices, purchase orders, financial adjustments, Sage access, and timesheet payroll are sensitive. Use existing `lib/server/quote-*`, `lib/server/timesheet-payroll.ts`, and payroll admin helpers. Do not add browser-direct updates to financial tables.

## Storage and uploads

Buckets in use include `user-avatars`, `rams-documents`, `quote-attachments`, `toolbox-talk-pdfs`, inspection photos, and error-report screenshots. Uploads and deletes must go through authorized routes or RLS-backed client calls that already exist. Prefer signed URLs for private documents (RAMS uses 1 hour). Do not make private buckets public to “fix” a viewer.

## Errors and logs

Do not log cookies, Authorization headers, session secrets, passwords, PINs, or raw data tokens.

Analytics metadata already redacts sensitive keys (`lib/analytics/events.ts`). Automation logs use `redactSensitiveText`. Application `logger.error` still forwards to the error logger — do not put secrets in `additionalData`.

## Tests

For permission or authz changes, prove **allowed** and **denied** paths. `testsuite/` has role projects (employee/manager/admin) and permission tests. Unit tests around `lib/utils/rbac.ts`, `lib/server/team-permissions.ts`, and module `require*` helpers are the fast layer. Sensitive PIN flow is `lib/server/sensitive-pin.ts` plus `components/security/SensitiveModuleGate.tsx`.

A passing happy-path UI check is not enough for a security change.

If you find a probable live defect while following these rules, record it for a separately classified task. Do not silently “tighten” production auth, RLS, or data in a documentation or unrelated UI change.
