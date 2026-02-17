# Codebase Cleanup — Remaining Tasks

**Created**: 17 Feb 2026  
**Baseline**: 1,189 ESLint problems (475 errors, 714 warnings) after session fixes  
**Trigger**: Run `cleancodebase` in Cursor chat to re-audit at any time

---

## What was fixed this session

| Item | Before | After | Reduction |
|------|--------|-------|-----------|
| `prefer-const` errors | 11 | 0 | -11 |
| `react-hooks/exhaustive-deps` | 41 | 0 | -41 |
| Stale `.eslintrc.cjs` | present | deleted | — |
| Lighthouse readyPattern | broken | fixed | — |
| `@jest/globals` import | 1 file | migrated to vitest | — |
| Unused deps (zustand, jest-dom, user-event, msw) | 4 packages | removed | — |
| npm vulnerabilities | 4 moderate + 1 low | 1 low | -4 |
| **Total ESLint problems** | **1,240** | **1,189** | **-51** |

---

## Remaining work — by rule

### 1. `@typescript-eslint/no-explicit-any` — 451 errors

The single largest category. These are `any` types that should be replaced with proper TypeScript types.

#### Priority tiers

| Tier | Scope | Est. files | Est. `any` count | Impact |
|------|-------|-----------|------------------|--------|
| **A — Production code** | `app/` pages + components, `components/`, `lib/`, `types/` | ~80 files | ~200 | Highest — runtime type safety |
| **B — API routes** | `app/api/` | ~50 files | ~60 | High — server-side correctness |
| **C — Scripts** | `scripts/` (migrations, testing, seeds) | ~80 files | ~150 | Low — one-off utilities, rarely modified |
| **D — Test files** | `tests/` | ~30 files | ~40 | Low — test robustness |

#### Recommended approach

1. **Tier A first**: Work through `lib/` → `components/` → `app/` pages. Most `any` here are in `catch` blocks (`error: any`), Supabase responses, and event handlers. Common replacements:
   - `catch (error: any)` → `catch (error: unknown)` then narrow with `error instanceof Error`
   - `data: any` from Supabase → use generated `Database` types or define interfaces
   - `Record<string, any>` → define a proper interface

2. **Tier B next**: API routes often have `any` in request body parsing and error handlers. Use Zod schemas (already in the project) to type request bodies.

3. **Tiers C & D defer**: Scripts and tests benefit less from strict typing. Address these opportunistically or in a dedicated cleanup sprint.

#### Batch strategy

To avoid overwhelming diffs, fix `any` in batches of 5-10 files at a time, grouped by feature area:

- **Batch 1**: `lib/utils/` (11 files — error-logger, api-error-handler, permissions, etc.)
- **Batch 2**: `lib/hooks/` + `lib/contexts/` (5 files)
- **Batch 3**: `lib/pdf/` (5 files — inspection-pdf, timesheet-pdf, etc.)
- **Batch 4**: `lib/services/` + `lib/supabase/` (5 files)
- **Batch 5**: `components/fleet/` + `components/forms/` (4 files)
- **Batch 6**: `components/messages/` (5 files)
- **Batch 7**: `components/workshop-tasks/` (8 files)
- **Batch 8**: `components/layout/` + `components/admin/` + `components/rams/` + `components/timesheets/` (7 files)
- **Batch 9**: `app/(dashboard)/maintenance/components/` (14 files)
- **Batch 10**: `app/(dashboard)/` pages — fleet, inspections, plant-inspections (8 files)
- **Batch 11**: `app/(dashboard)/` pages — rams, timesheets, workshop-tasks, dashboard, approvals (10 files)
- **Batch 12**: `app/api/` routes (50+ files — bulk fix catch blocks)
- **Batch 13**: `types/` (4 files)
- **Batch 14-16**: `scripts/` (80+ files — low priority, optional)
- **Batch 17-18**: `tests/` (30+ files — low priority, optional)

---

### 2. `@typescript-eslint/no-unused-vars` — 265 warnings

Unused variables and imports. Many are straightforward removals.

#### Common patterns

- **Unused imports**: `Link`, `XCircle`, etc. imported but never used in JSX → delete the import
- **Unused destructured vars**: `const { data, error } = ...` where `data` is unused → use `const { error } = ...`
- **Unused function params**: `(error) => { ... }` where error isn't used → prefix with `_error`
- **Dead variables**: Variables assigned but never read → remove the assignment

#### Approach

Many of these can be fixed semi-automatically:
1. Run `npx eslint --fix` (handles some auto-fixable cases)
2. For the rest, batch by file — delete unused imports, prefix unused params with `_`
3. Group with `no-explicit-any` fixes when touching the same files

---

### 3. `sonarjs/no-duplicate-string` — 314 warnings

Repeated string literals (3+ occurrences). Most common:
- CSS class strings (e.g. `"text-sm"`, `"font-medium"`)
- Status strings (e.g. `"active"`, `"completed"`, `"pending"`)
- Test fixture strings

#### Approach

- **Status/enum strings**: Extract to a constants file (e.g. `lib/constants/statuses.ts`)
- **CSS classes**: Consider extracting common Tailwind class combinations into `cn()` helper variables at the top of the file, but only where the duplication is meaningful (not every `"text-sm"`)
- **Test strings**: Low priority — suppress with `// eslint-disable-next-line` or create test fixture constants
- Consider adding `sonarjs/no-duplicate-string` ignoreStrings config for very short strings

---

### 4. `sonarjs/cognitive-complexity` — 118 warnings

Functions exceeding complexity threshold of 15. Top offenders:

| File | Complexity | Function |
|------|-----------|----------|
| `workshop-tasks/page.tsx` | 64 | Main page component |
| `admin/users/page.tsx` | 32 | Main page component |
| `approvals/page.tsx` | 31 | Main page component |
| `fleet/page.tsx` | ~25+ | Main page component |

#### Approach

- **Extract sub-components**: Break large page components into smaller, focused components
- **Extract logic helpers**: Move complex conditional logic into pure helper functions
- **Extract custom hooks**: Move data-fetching + state logic into `useXxx` hooks
- Work on these as part of feature work — don't do a dedicated "reduce complexity" sprint unless the file is being modified anyway

---

### 5. Minor issues

| Rule | Count | Priority | Action |
|------|-------|----------|--------|
| `@next/next/no-assign-module-variable` | 7 | Low | All in test mocks — refactor mock patterns |
| `sonarjs/no-identical-functions` | 4 | Low | Extract shared test helpers |
| `@next/swc` version mismatch warning | 1 | Low | Run `npm install` or pin matching versions |
| Lighthouse 500 on local | 1 | Medium | Investigate Supabase middleware crash in headless mode |
| Linkinator `polyfills.js` 404 | 2 | Low | Dev-mode artefact — suppress in config |

---

## How to use this plan

1. **Quick clean**: Type `cleancodebase` → choose tier 1 (Quick) → fix what comes up
2. **Batch work**: Pick a batch from the table above, fix it, commit, move on
3. **Opportunistic**: When touching a file for feature work, also fix its `any`/unused-vars issues
4. **Full audit**: Type `cleancodebase` → choose tier 3 (Full) periodically to track progress

---

## Target state

| Metric | Current | Target | Notes |
|--------|---------|--------|-------|
| ESLint errors | 475 | 0 | All `any` replaced, all `prefer-const` fixed |
| ESLint warnings | 714 | <100 | Reduce duplicate-string noise, fix unused-vars |
| `no-explicit-any` | 451 | 0 (in app/lib/components) | Scripts/tests can be deferred |
| `exhaustive-deps` | 0 | 0 | Maintained |
| npm vulnerabilities | 1 low | 0 | Next.js upgrade when stable |
| Build | Clean | Clean | Maintained |
