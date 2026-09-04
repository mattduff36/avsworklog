# Squires agent router

AVS Worklog (Squires) is the internal operations PWA for A&V Squires Plant Co. Ltd. Live product: [avsworklog.mpdee.uk](https://avsworklog.mpdee.uk).

This file routes agents. It is not a second engineering workflow.

## Current truth (read these)

| Need | Document |
| --- | --- |
| What the product is, Daily Allocation invariants, brand/permissions intent | [`PRODUCT.md`](PRODUCT.md) |
| How the live UI looks and how to build a new page | [`DESIGN.md`](DESIGN.md) |
| Where code belongs, auth/session, data, modules | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| How to work, test, and commit | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| Auth, permissions, RLS, secrets, production data | [`docs/SECURITY.md`](docs/SECURITY.md) |

Token-Efficient Engineering V2.4 is the active engineering workflow (global Skill). Do not duplicate TEE lanes, markers, or finalise procedure here. Project rules override TEE when they are stricter.

## Documentation precedence

1. **Live code and migrations** are current implementation evidence. Inspect them before changing behaviour. If they conflict with a current-truth document, investigate the discrepancy; do not assume either side is automatically correct.
2. **`PRODUCT.md`** is current product/domain authority for confirmed Daily Allocation and platform facts.
3. **`DESIGN.md`** is current visual authority for generic page chrome, layout, styling, and reusable patterns.
4. **`ARCHITECTURE.md` / `docs/DEVELOPMENT.md` / `docs/SECURITY.md`** are current engineering authority.
5. **Current module PRDs and operational guides** (for example `docs/PRD_*.md`, `docs/guides/ADDING_A_NEW_MODULE_WITH_PERMISSIONS.md`, migration guides, Daily Allocation rollout) apply only to that module or process.
6. **Dated reports, session summaries, bug-fix logs, old audits, old status docs, and past plans are historical evidence.** Do not treat them as current standards unless the task explicitly targets that file.

`docs/README.md` is an index, not a standards document. Do not create another summary document for a small task.

## Hard project rules

- Never expose environment values, tokens, cookies, or secrets.
- Never push unless the user writes `push to GitHub`, or explicitly requests `finalise and push` / `fap` / `/fap` / `finalise full and push` / `ffap` / `/ffap` / `finalise:push`.
- Stay on the current branch unless the user says otherwise.
- Do not change production data or schema without explicit permission. Persistence, auth, permissions/RLS, money, and concurrency are CRITICAL under TEE.
- For database/persistence intent, load `.cursor/rules/database-migrations.mdc` and the migration guides before acting.
- Application builds run only when the user authorizes a test build.

## What to load for a task

- **Substantial UI / Tailwind / layout / cards / tabs / filters / mobile:** `DESIGN.md` and `.cursor/rules/ui-design.mdc`. Keep using `.cursor/rules/app-page-shell.mdc` and `.cursor/rules/tabs-styling.mdc` when those files are in scope. Trivial copy, one-property styling, or logic-only TSX may follow the attached UI rule plus the local canonical implementation without loading all of `DESIGN.md`.
- **New routes, providers, services, data/state, cross-module structure:** `ARCHITECTURE.md` and `.cursor/rules/architecture.mdc`.
- **Auth, permissions, APIs, Supabase, RLS, service role, financial or destructive work:** `docs/SECURITY.md` and `.cursor/rules/security-data.mdc`.
- **A named module PRD or runbook:** read that file after the current-truth layer, then inspect live code.

Do not require chat phrases such as “Rule active”.

## Mixed generations

This repository contains several generations of data access, server/client architecture, state management, module workflows, and module-specific interactions. Preserve the current module’s domain behaviour, data-access architecture, workflow, and intentional module-specific interaction patterns. Do not start a broad migration because a neighbouring page looks newer.

For new generic page chrome, layout, styling, and reusable visual patterns, follow `DESIGN.md` and its named canonical references. Do not reproduce a documented legacy or non-canonical visual pattern merely because it already exists in the module. Intentional specialised UI (for example a manager board or kiosk) can remain specialised.

Daily Allocation product invariants stay in `PRODUCT.md`. Do not copy that PRD into architecture notes or invent a second allocation model. Inspect the live board and transactional RPCs before changing schedule behaviour.
