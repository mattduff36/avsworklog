## Supabase Advisor Baseline

Date: `2026-04-07`

This report captures the live Supabase Advisor and schema state before remediation migrations were applied.

## Verified Security Findings

### RLS enabled with no policies

The following tables currently have `relrowsecurity = true` and `policy_count = 0`:

- `public.app_auth_sessions`
- `public.employee_work_shifts`
- `public.work_shift_template_slots`
- `public.work_shift_templates`

Owning migrations:

- `supabase/migrations/20260404_account_switch_app_session_redesign.sql`
- `supabase/migrations/20260323_work_shifts.sql`

### Mutable function search_path warnings

The live database currently reports these functions with empty `proconfig` values:

- `absence_financial_year_start_year(date)`
- `absence_is_closed_financial_year(date)`
- `get_archive_eligible_financial_years()`
- `guard_absence_closed_financial_year_mutation()`
- `is_absence_financial_year_closed(integer)`
- `update_customers_updated_at()`
- `update_inspection_daily_hours_updated_at()`
- `update_plant_updated_at()`
- `update_project_document_types_updated_at()`
- `update_quote_invoices_updated_at()`
- `update_quote_line_items_updated_at()`
- `update_quote_manager_series_updated_at()`
- `update_quotes_updated_at()`
- `update_workshop_attachment_field_responses_updated_at()`
- `update_workshop_attachment_template_versions_updated_at()`
- `update_workshop_attachment_templates_updated_at()`
- `validate_absence_conflict()`

Primary owning migrations:

- `supabase/migrations/20260202_create_plant_table.sql`
- `supabase/migrations/20260204_create_inspection_daily_hours.sql`
- `supabase/migrations/add-project-document-types-and-favourites.sql`
- `supabase/migrations/20260309_customers_quotes_module.sql`
- `supabase/migrations/20260312_absence_fy_archival.sql`
- `supabase/migrations/20260313_absence_fy_apr1_cutover.sql`
- `supabase/migrations/20260323_quotes_workflow_upgrade.sql`
- `supabase/migrations/20260326_absence_year_closure_carryover_flow.sql`
- `supabase/migrations/20260401_absence_processed_status_workflow.sql`
- `supabase/migrations/20260401_workshop_attachments_schema_v2.sql`

Reference migrations that already use the hardening pattern:

- `supabase/migrations/20260121_fix_supabase_linter_security_findings.sql`
- `supabase/migrations/20260325_fix_security_advisor_warnings.sql`

## Verified Performance Hotspots

The current policy catalog shows broad auth/helper-heavy RLS usage:

- `132` policies across `56` tables reference `auth.*` or helper predicates.
- `129` policy expressions still contain `auth.uid()`.
- `5` policy expressions still contain `auth.jwt()`.
- `36` policy expressions already contain wrapped `SELECT auth.uid()` forms.

Highest-density tables from the live policy catalog:

- `actions`
- `inspection_daily_hours`
- `van_inspections`
- `plant_inspections`
- `absences`
- `inspection_items`
- `hgv_inspections`
- `timesheet_entries`
- `rams_documents`
- `messages`

Representative policy families still using row-by-row auth/helper checks:

- self-owned inspection access policies on `van_inspections`, `plant_inspections`, `hgv_inspections`
- child-table ownership checks on `inspection_items` and `inspection_daily_hours`
- absence policies using `is_actor_absence_secondary_editor(auth.uid())` and `can_actor_*_absence_request(auth.uid(), profile_id)`
- manager/workshop/supervisor policies using row-independent helpers such as `effective_is_manager_admin()`, `effective_is_workshop_team()`, `effective_is_supervisor()`, and `effective_has_module_permission(...)`

## Existing Work Already Present In The Live DB

The following stability indexes are already present and should not be re-added:

- `idx_absences_profile_date_desc`
- `idx_absences_status_date_desc`
- `idx_message_recipients_user_pending_inbox_message`
- `idx_rams_assignments_employee_status`
- `idx_user_page_visits_user_path_visited_at_desc`

Owning migration:

- `supabase/migrations/20260407_add_stability_indexes.sql`

## Remediation Sequence

1. Add explicit policies for the four RLS-enabled tables with no policies.
2. Set fixed `search_path` values on the 17 flagged functions.
3. Rewrite the highest-signal RLS hotspot policies to use initPlan-friendly wrappers where safe.
4. Re-run Supabase `security` and `performance` advisors after each batch and compare the remaining findings.
