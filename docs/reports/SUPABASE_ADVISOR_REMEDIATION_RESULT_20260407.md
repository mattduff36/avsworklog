## Supabase Advisor Remediation Result

Date: `2026-04-07`

This report records the remediation batches applied after the baseline captured in `docs/reports/SUPABASE_ADVISOR_BASELINE_20260407.md`.

## Applied Batches

### 1. Explicit RLS policies for no-policy tables

Applied via:

- `supabase/migrations/20260407_add_explicit_work_shift_and_app_session_policies.sql`
- `scripts/run-advisor-explicit-work-shift-and-app-session-policies-migration.ts`

Verified result:

- `app_auth_sessions`: `1` explicit policy
- `employee_work_shifts`: `6` explicit policies
- `work_shift_template_slots`: `4` explicit policies
- `work_shift_templates`: `4` explicit policies

### 2. Function search_path hardening

Applied via:

- `supabase/migrations/20260407_fix_remaining_function_search_paths.sql`
- `scripts/run-advisor-function-search-path-migration.ts`

Verified result:

- `17` previously flagged functions now have `search_path = public, pg_temp`

### 3. Hotspot RLS policy optimization

Applied via:

- `supabase/migrations/20260407_optimize_rls_hotspot_policies.sql`
- `scripts/run-advisor-rls-hotspot-policies-migration.ts`

Covered tables:

- `absences`
- `actions`
- `van_inspections`
- `plant_inspections`
- `hgv_inspections`
- `inspection_daily_hours`
- `inspection_items`
- `messages`

Verified result:

- The hotspot runner confirmed all anchor policies exist.
- The hotspot runner confirmed `0` remaining direct auth/helper patterns for the specific policy families it targeted.

## Advisor Regression Check

### Security advisor

Before remediation, the verified live security backlog included:

- `4` `rls_enabled_no_policy` infos
- `17` `function_search_path_mutable` warnings
- `1` Auth warning for leaked password protection

After remediation, the live security advisor now reports only:

- `auth_leaked_password_protection`

This remaining item is an Auth dashboard setting, not a SQL or migration issue.

### Performance advisor

The post-remediation performance advisor payload is materially smaller than the baseline snapshot:

- Baseline payload size: about `403.7 KB`
- Post-remediation payload size: about `371.4 KB`

That indicates the hotspot policy pass reduced advisor output, but the current tooling session did not produce a reliable full JSON diff by advisor family.

## Index Decision

One still-plausible advisor candidate is the `absence_allowance_carryovers_generated_by_fkey` foreign key.

Current live state:

- `public.absence_allowance_carryovers` has only `20` rows
- current indexes cover `id`, `(profile_id, financial_year_start_year)`, `profile_id`, and `financial_year_start_year`
- there is no dedicated index on `generated_by`

Decision:

- Do **not** add a new index migration yet.
- The table is currently tiny, so the likely benefit is low.
- Revisit this only if:
  - advisor output still flags the same FK after the next broader pass, or
  - the table grows materially, or
  - query performance evidence shows joins or deletes around `generated_by` becoming expensive.

## Remaining Follow-up

- Enable leaked password protection in Supabase Auth settings.
- Re-check the performance advisor again after future RLS or query-shape changes, especially if more inspection, absence, or messaging policies are added.
