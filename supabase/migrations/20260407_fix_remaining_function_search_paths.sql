BEGIN;

-- ============================================================================
-- Supabase Advisor remediation: remaining mutable function search_path warnings
-- ============================================================================
-- Match the project's existing hardening pattern by pinning each function to
-- public, pg_temp so lookup order cannot be hijacked by attacker-controlled
-- schemas.
-- ============================================================================

ALTER FUNCTION public.absence_financial_year_start_year(date) SET search_path = public, pg_temp;
ALTER FUNCTION public.absence_is_closed_financial_year(date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_archive_eligible_financial_years() SET search_path = public, pg_temp;
ALTER FUNCTION public.guard_absence_closed_financial_year_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_absence_financial_year_closed(integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_customers_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_inspection_daily_hours_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_plant_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_project_document_types_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_quote_invoices_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_quote_line_items_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_quote_manager_series_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_quotes_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_workshop_attachment_field_responses_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_workshop_attachment_template_versions_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_workshop_attachment_templates_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_absence_conflict() SET search_path = public, pg_temp;

DO $$
DECLARE
  configured_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO configured_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (ARRAY[
      'absence_financial_year_start_year',
      'absence_is_closed_financial_year',
      'get_archive_eligible_financial_years',
      'guard_absence_closed_financial_year_mutation',
      'is_absence_financial_year_closed',
      'update_customers_updated_at',
      'update_inspection_daily_hours_updated_at',
      'update_plant_updated_at',
      'update_project_document_types_updated_at',
      'update_quote_invoices_updated_at',
      'update_quote_line_items_updated_at',
      'update_quote_manager_series_updated_at',
      'update_quotes_updated_at',
      'update_workshop_attachment_field_responses_updated_at',
      'update_workshop_attachment_template_versions_updated_at',
      'update_workshop_attachment_templates_updated_at',
      'validate_absence_conflict'
    ])
    AND EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS setting
      WHERE setting = 'search_path=public, pg_temp'
    );

  IF configured_count <> 17 THEN
    RAISE EXCEPTION
      'Expected 17 functions with fixed search_path, found %',
      configured_count;
  END IF;
END $$;

COMMIT;
