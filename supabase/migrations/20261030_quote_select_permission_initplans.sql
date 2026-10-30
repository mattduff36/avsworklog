-- finalise-phase: predeploy
-- Reviewed Stage07A: constant permission calls become per-statement InitPlans.
-- Owner authorised production application on 30 October 2026. Preserve all permissions.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quotes' AND policyname='quotes_select' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles=ARRAY['public']::name[] AND qual='effective_has_module_permission(''quotes''::text)' AND with_check IS NULL)
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='legacy_quotes' AND policyname='legacy_quotes_select' AND cmd='SELECT' AND permissive='PERMISSIVE' AND roles=ARRAY['authenticated']::name[] AND qual='(effective_has_module_permission(''quotes''::text) OR effective_has_module_permission(''timesheets''::text))' AND with_check IS NULL)
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.effective_has_module_permission(text)'::regprocedure AND provolatile='s' AND prosecdef)
  THEN RAISE EXCEPTION 'Quote RLS preconditions drifted; stop for review'; END IF;
END
$check$;
ALTER POLICY quotes_select ON public.quotes USING ((SELECT public.effective_has_module_permission('quotes'::text)));
ALTER POLICY legacy_quotes_select ON public.legacy_quotes USING ((SELECT public.effective_has_module_permission('quotes'::text)) OR (SELECT public.effective_has_module_permission('timesheets'::text)));

