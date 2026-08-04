-- Rollback for 20260804_absence_historic_delete_guard.sql
-- Drops only the historic-delete guard objects. Does not touch closed-FY guards.

DROP TRIGGER IF EXISTS trg_guard_absence_historic_delete ON public.absences;

DROP FUNCTION IF EXISTS public.delete_latest_generated_financial_year_absences(boolean);
DROP FUNCTION IF EXISTS public.delete_absences_for_financial_year_undo(date, date, boolean, text);
DROP FUNCTION IF EXISTS public.delete_absences_for_bulk_batch(uuid);
DROP FUNCTION IF EXISTS public.can_actor_run_absence_global_delete();
DROP FUNCTION IF EXISTS public.guard_absence_historic_delete();
