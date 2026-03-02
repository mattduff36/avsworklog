# AGENTS.md

## Cursor Cloud specific instructions

### Overview

AVS Worklog is a Next.js 15 (App Router) + React 19 + TypeScript PWA for managing employee timesheets, vehicle inspections, and fleet operations. The backend is a **hosted Supabase** instance (no local database). See `README.md` for full feature list and project structure.

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Next.js dev server | `npm run dev` | 4000 | Main app (frontend + API routes) |
| Supabase (external) | N/A | N/A | Hosted BaaS; requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` |

### Key commands

All commands are defined in `package.json`. Highlights:

- **Dev server**: `npm run dev` (port 4000)
- **Build**: `npm run build`
- **Lint (ESLint)**: `npm run lint`
- **Lint (OxLint, fast)**: `npm run lint:fast`
- **Type check**: `npm run typecheck`
- **Unit/integration tests**: `npm run test:run` (Vitest)
- **E2E tests**: `npx playwright test` (requires `npx playwright install --with-deps` first)
- **DB validation**: `npm run db:validate` (requires `POSTGRES_URL_NON_POOLING`)

### Non-obvious caveats

- **No local database**: There is no Docker/docker-compose. All data goes through hosted Supabase. Without real Supabase credentials in `.env.local`, the app renders the login page but auth/data operations will fail with "Failed to fetch."
- **`.env.local` is required**: Copy from `.env.example`. At minimum set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Database migrations**: Always follow `docs/guides/HOW_TO_RUN_MIGRATIONS.md`. Use the `pg` library pattern, never Supabase client RPC. Run `npm run db:validate` after any migration that renames/drops columns or tables.
- **ESLint warnings are pre-existing**: The codebase has ~497 ESLint errors and ~810 warnings (mostly `@typescript-eslint/no-explicit-any` and SonarJS rules). TypeScript `--noEmit` also has pre-existing errors in test files. These are not regressions.
- **Build config**: `next.config.ts` sets `ignoreDuringBuilds: true` for both ESLint and TypeScript, so `npm run build` will succeed despite lint/type errors.
- **Unit tests**: Many integration tests require a real Supabase connection and will fail with placeholder credentials. Pure unit tests (e.g., utility functions, component logic) pass without credentials.
- **Playwright E2E**: Requires `npx playwright install --with-deps` before first run. CI uses Node LTS.
- **Package manager**: npm (not pnpm/yarn). Use `npm ci` for deterministic installs.
