# Fixerrors follow-up: timesheet diagnostics and Plant defect loading

Snapshot: `c0d7a2c2-8b3b-463a-8ef1-7675c27ddde8`
Deployment: `71e91f2b497fa100b98ef5f2d8ccf6e33c7df386`
Architecture gate: `approve_with_conditions`

## Classification

- Lane: CRITICAL / TEE-LIGHT
- Why: the repair touches the timesheet submit contract and fail-closed inspection behavior, but requires no schema, migration, or production-data mutation.
- Rollback: revert the code and tests in this change.

## Implementation

1. Extract the existing strict timesheet submit Zod schema into a client-safe validation module used by both client and server.
2. Validate before `fetch` and send only `parsed.data`. Preserve annual-leave rows with `did_not_work=true` and a positive `daily_total`; do not coerce invalid values or weaken server validation.
3. Keep authorization server-side. Distinguish malformed JSON, schema rejection, missing target, and target lookup failure with safe reason codes; never log request payloads or signatures.
4. Remove the Civils page's duplicate `console.error` pair and rely on one sanitized error record.
5. Track locked-defect loading as `idle | loading | ready | failed`, clear stale defect state on a new load, warn for transient network failures, and block registered-plant submission unless the check is ready. Hired plant remains unaffected.
6. Exercise the Plant job-code picker with the real Radix dialog. Change dialog code only if the warning reproduces.

## Required checks

- `TS-SUBMIT-SHARED-001`: shared strict client/server validation; invalid client payload never fetches.
- `TS-SUBMIT-DNW-001`: annual-leave daily total remains valid; actual work/subsistence on a Did Not Work row remains invalid.
- `TS-SUBMIT-DIAG-001`: safe distinct malformed/schema/target/lookup diagnostics.
- `TS-SUBMIT-AUTH-001`: existing owner, scoped authoriser, denied cross-user, and View As paths remain green.
- `TS-SUBMIT-LOG-001`: one sanitized Civils submit log.
- `PI-LOCK-NET-001`: Safari `Load failed` is warning-level, clears stale data, and records failed state.
- `PI-LOCK-GATE-001`: registered-plant submit blocks until ready; hired plant is unaffected.
- `JOB-DIALOG-A11Y-001`: actual Radix picker has accessible name `Choose job code` and no missing-title warning.
- Targeted Vitest, TypeScript typecheck, and lint on changed files.

## Boundaries and unresolved historical evidence

- No schema, migration, RLS, authorization, or production-data changes.
- Do not log payloads, signatures, user-entered values, or raw validation inputs.
- Do not globally suppress network or Radix errors.
- `TS-UNKNOWN-PAYLOAD`: the exact historical browser payload was not captured, so do not claim its specific invalid field was fixed.
- `RADIX-UNREPRODUCED`: if the real-primitive test passes, keep the historical warning report-only and do not add duplicate titles.
