-- Integration handoff: copy verbatim to supabase/migrations/20261116_hgv_same_day_updates.sql
-- ONLY on the feature branch after the compatibility foundation and production app are verified.
-- finalise-phase: predeploy
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.save_hgv_inspection_compat(uuid,boolean,uuid,uuid,date,uuid,text,integer,text,text,jsonb,uuid,text,uuid,timestamptz,text,integer,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Deploy HGV compatibility foundation and application first';
  END IF;
END; $$;
DROP INDEX IF EXISTS public.idx_unique_hgv_inspection_user_date;
CREATE INDEX IF NOT EXISTS hgv_inspections_user_date ON public.hgv_inspections(hgv_id,user_id,inspection_date);
REVOKE ALL ON FUNCTION public.save_hgv_inspection(uuid,boolean,uuid,uuid,date,uuid,uuid,text,integer,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
