-- Block direct entry/job-code mutations while a timesheet remains approved so
-- the current payroll snapshot cannot become silently stale. UPDATE checks both
-- OLD and NEW parents so rows cannot be re-parented out of an approved sheet.

CREATE OR REPLACE FUNCTION public.reject_approved_timesheet_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO parent_status
    FROM public.timesheets
    WHERE id = NEW.timesheet_id
    FOR SHARE;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entries are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent_status
    FROM public.timesheets
    WHERE id = OLD.timesheet_id
    FOR SHARE;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entries are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO parent_status
  FROM public.timesheets
  WHERE id = OLD.timesheet_id
  FOR SHARE;
  IF parent_status = 'approved' THEN
    RAISE EXCEPTION 'Approved timesheet entries are immutable; mark the timesheet as adjusted before changing entries';
  END IF;

  IF NEW.timesheet_id IS DISTINCT FROM OLD.timesheet_id THEN
    SELECT status INTO parent_status
    FROM public.timesheets
    WHERE id = NEW.timesheet_id
    FOR SHARE;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entries are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_approved_timesheet_entry_mutation ON public.timesheet_entries;
CREATE TRIGGER reject_approved_timesheet_entry_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.reject_approved_timesheet_entry_mutation();

CREATE OR REPLACE FUNCTION public.reject_approved_timesheet_entry_job_code_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT timesheet.status INTO parent_status
    FROM public.timesheet_entries entry
    JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
    WHERE entry.id = NEW.timesheet_entry_id
    FOR SHARE OF timesheet;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entry job codes are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT timesheet.status INTO parent_status
    FROM public.timesheet_entries entry
    JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
    WHERE entry.id = OLD.timesheet_entry_id
    FOR SHARE OF timesheet;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entry job codes are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
    RETURN OLD;
  END IF;

  SELECT timesheet.status INTO parent_status
  FROM public.timesheet_entries entry
  JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
  WHERE entry.id = OLD.timesheet_entry_id
  FOR SHARE OF timesheet;
  IF parent_status = 'approved' THEN
    RAISE EXCEPTION 'Approved timesheet entry job codes are immutable; mark the timesheet as adjusted before changing entries';
  END IF;

  IF NEW.timesheet_entry_id IS DISTINCT FROM OLD.timesheet_entry_id THEN
    SELECT timesheet.status INTO parent_status
    FROM public.timesheet_entries entry
    JOIN public.timesheets timesheet ON timesheet.id = entry.timesheet_id
    WHERE entry.id = NEW.timesheet_entry_id
    FOR SHARE OF timesheet;
    IF parent_status = 'approved' THEN
      RAISE EXCEPTION 'Approved timesheet entry job codes are immutable; mark the timesheet as adjusted before changing entries';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_approved_timesheet_entry_job_code_mutation ON public.timesheet_entry_job_codes;
CREATE TRIGGER reject_approved_timesheet_entry_job_code_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.timesheet_entry_job_codes
  FOR EACH ROW EXECUTE FUNCTION public.reject_approved_timesheet_entry_job_code_mutation();
