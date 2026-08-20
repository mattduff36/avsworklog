# Development (current)

Working guide for Squires. Commands come from root `package.json`. TEE V2.2 owns lane selection, review gates, and completion markers — do not copy that procedure here.

## Working method

1. Read `AGENTS.md`, then only the current-truth doc that matches the task (`DESIGN.md`, `ARCHITECTURE.md`, `docs/SECURITY.md`, or `PRODUCT.md`).
2. Inspect the live module and one canonical neighbour. Follow that module’s current pattern.
3. Change the smallest cohesive set of files. Do not refactor because a file is long.
4. Update targeted tests when behaviour changes.
5. Commit locally when the coding task is finished unless the user said not to, or the task is planning/review-only. Do not push unless explicitly authorised.
6. Dated reports under `docs/` are historical. Do not add another implementation-summary markdown unless the user asks.

## Code conventions (still true)

- TypeScript throughout. `interface` and `type` are both used; neither is mandatory.
- Functional React components, named exports.
- Directories: lowercase-with-dashes.
- shadcn/Radix/Tailwind for UI. See `DESIGN.md`.
- Server authorization for anything that matters; see `docs/SECURITY.md`.
- `toast` from `sonner` for notifications. Never `alert()` / `confirm()`.
- Zod for new API and privileged inputs. Shared pieces live in `lib/validation/schemas.ts`.
- `logger` from `lib/utils/logger.ts` when structured logs already exist in that module.

## Claims that are no longer true

These appear in `docs/DEVELOPMENT_STANDARDS_AND_TEMPLATES.md` and the former `public/.cursorrules` file (removed because Next.js would serve it). Do not enforce them:

| Old claim | Live reality |
| --- | --- |
| Use React Query for ALL server data | Only some modules wrap data in Query. Others `fetch` or use browser Supabase. Follow the module. |
| Prefer interfaces over types | Mixed. Use whichever matches the file. |
| Always use Server Components; minimise `use client` | Almost every dashboard page is `'use client'`. Do not convert a page to RSC as a drive-by. |
| Mandatory file line limits / refactor before edit | Removed by TEE V2. Patch locally. |
| Use `nuqs` for all URL state | Only inspections, approvals, reports, notifications, and profile (each with a local `NuqsClientAdapter`). |
| Avoid enums; always maps | Existing string unions and maps; do not churn. |
| Start every chat with “Rule active” | Not required. |
| SSH to `mpdee-server` for builds | Not part of the current project workflow. Builds run only when the user authorises a test build. |

`docs/DEVELOPMENT_STANDARDS_AND_TEMPLATES.md` remains historical evidence. This file replaces it as current guidance.

## UI

Read `DESIGN.md`. New pages: `AppPageShell` + `AppPageHeader`. Keep `.cursor/rules/app-page-shell.mdc` and `.cursor/rules/tabs-styling.mdc`.

## Data, forms, errors

- New privileged writes: `app/api` + `lib/server` + a `require*` helper. Do not add a new browser-only mutation path for money, permissions, or Daily Allocation.
- Forms are usually controlled state. `react-hook-form` is only in a few maintenance/fleet dialogs.
- Client errors: toast + optional `ErrorDetailsModal`. Service outage: `ServiceUnavailableState`.
- Permission UX: `usePermissionCheck` / `useModuleAccessLevel`. Fail closed while loading.
- Realtime exists (`lib/hooks/useRealtime.ts`) where a module already subscribes.

## Commands

Dev server is port **4000**.

```bash
npm run dev
npm run typecheck
npm run lint
npm run lint:fast          # oxlint
npm run test:run           # vitest run
npm run test               # vitest watch
npm run test:coverage
npm run testsuite          # Playwright + API smoke (needs setup)
npm run testsuite:setup
npm run testsuite:api
npm run testsuite:ui
npm run db:validate        # after column/table rename or drop
npx tsx scripts/run-<feature>-migration.ts
```

Normal branch migration execution is `npm run finalise`. It discovers forward-only dated files under `supabase/migrations/` and applies them through the protected ledger.

The generic one-file runner is explicit-path, dry-run by default, and limited to predeploy transactional SQL:

```bash
npm run migrate -- supabase/migrations/<file>.sql
npm run migrate -- supabase/migrations/<file>.sql --apply --confirm-target <project-ref>
```

Apply still requires conversational CRITICAL authorization and `POSTGRES_URL_NON_POOLING`. Postdeploy and non-transactional SQL stay on a reviewed feature-specific runner. Load `.cursor/rules/database-migrations.mdc` before running anything against a live database.

Finalise / repair (when the user invokes those commands):

```bash
npm run finalise
npm run finalise:repair
npm run finalise:full
npm run workflow-review
npm run fixerrors
npm run review:preflight
```

`/fap` and `/ffap` are the explicit push-authorising commands. `finalise` / `finalise-full` do not push.

Do not run `npm run build` unless the user authorises a test build.

Local disposable Postgres (never production):

```bash
npm run test:db:local
```

See `docs/guides/LOCAL_DATABASE_TESTING.md`.

## Testing strategy

- **`tests/unit`** — Vitest, Node environment (`vitest.config.ts`). Includes TEE/workflow, permissions, domain logic.
- **`tests/ui`** — component tests.
- **`tests/integration`** — heavier API/workflow tests; some need credentials. `tests/README.md` is outdated in places; trust the files and `package.json`.
- **`testsuite/`** — finalise smoke: API guards, role projects, UI route/permission checks (`testsuite/README.md`).
- New module work needs allowed **and** denied access coverage (see `docs/guides/ADDING_A_NEW_MODULE_WITH_PERMISSIONS.md` and `testsuite/api` / `testsuite/ui`).
- Typecheck application with `npm run typecheck`. Tests use `tsconfig.tests.json` via `npm run typecheck:tests` when needed.

`tsconfig.json` is strict (`noUnusedLocals`, `noUnusedParameters`, `strictNullChecks`) and excludes `tests` / `testsuite`.

Linting is ESLint 9 (`eslint.config.mjs`, including `eslint-plugin-sonarjs`) plus `oxlint` for the fast path. There is no project Prettier command; match the surrounding file. `npm run lint:theme` is a high-risk pattern script, not a visual linter.

For a documentation-only or local UI change, prefer `npm run typecheck` only if TypeScript contracts changed, and `npx vitest run tests/unit/tee-v2-context.test.ts` if `.cursor/rules`, `.cursor/commands`, or `.cursorignore` changed. A full application build is not required for Markdown unless the user asks.

When a behaviour change has a stable test id already in the suite (permission alignment, TEE context, Daily Allocation, inventory chrome), update that test rather than adding a parallel one.

## Git

- Stay on the current branch unless asked to switch.
- Commit message style: `type(scope): summary`.
- Never push unless the user explicitly authorises it (see `AGENTS.md`).
- Never amend a commit you did not just create, and never skip hooks.

## Documentation hygiene

- Update `PRODUCT.md` only when confirmed product behaviour changes.
- Update `DESIGN.md` / `ARCHITECTURE.md` / this file / `docs/SECURITY.md` when the current contract changes.
- Do not promote dated `docs/bug-fixes-*`, session summaries, or old status files to current authority.
- Do not add a new “standards” doc for a small task.

## Refactoring

Extract only when the change exposes a real boundary, the same region keeps breaking, or extraction reduces risk. Otherwise patch in place and leave a follow-up note. Do not start repository-wide pattern migrations from a local task.
